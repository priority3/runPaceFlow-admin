/**
 * Keep 同步适配器(消费级登录,免开发者审批)。
 *
 * 端点与解码逻辑参考开源项目 yihong0618/running_page 的 keep_sync:
 * - 登录:手机号 + 密码 → token
 * - 列表:分页拉 running 日志 id
 * - 详情:按 id 取摘要(距离/时长/心率/卡路里)+ 加密的 geoPoints/heartRates
 *
 * 设计取舍:摘要字段是可靠核心(距离/时长/配速/心率),足够生成活动与 PR 跑后复盘;
 * GPS 轨迹解码是「尽力而为」——从 Apple 健康导入 Keep 的跑步可能没有可解码的轨迹,
 * 解不出时降级为无轨迹活动,不影响摘要。
 */
import { createDecipheriv } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

import type { RawActivity, SyncAdapter } from './base'

const LOGIN_API = 'https://api.gotokeep.com/v1.1/users/login'
const LIST_API = 'https://api.gotokeep.com/pd/v3/stats/detail'
const LOG_API_BASE = 'https://api.gotokeep.com/pd/v3'

/**
 * Keep 的接口按运动类型分区,列表与详情**各用一套标识**,必须成对给对:
 *   列表:GET /pd/v3/stats/detail?type=<listType>
 *   详情:GET /pd/v3/<logPath>/<id>          ← 类型在**路径**里,不是 query
 * 拿骑行 id 去打 /runninglog 会返回 errorCode 404803「获取训练数据请求错误的接口」。
 * id 尾缀同样编码了类型(_rn / _cy),用于只拿到 id 的场景(downloadGPX)回推。
 *
 * Reason: Keep 对**认不出的 type 值不报错**,而是静默退化成「全部运动」——
 * 实测 riding / bike / biking / walking / all / 空串都返回同一份混合列表
 * (stats.type 为 training)。所以这张表只能填实测确认过的值:猜错不会 4xx,
 * 只会把别的运动悄悄混进来,污染入库类型。
 * 已实测:running(_rn) / cycling(_cy) / hiking(_hk) 有效;后两者按需再加。
 */
const KEEP_SPORTS = [
  { listType: 'running', logPath: 'runninglog', idSuffix: '_rn', type: 'running', label: '跑步' },
  { listType: 'cycling', logPath: 'cyclinglog', idSuffix: '_cy', type: 'cycling', label: '骑行' },
] as const

type KeepSport = (typeof KEEP_SPORTS)[number]

/** 只有 id 时按尾缀回推运动类型;认不出则当跑步(历史行为)。 */
function sportFromId(id: string): KeepSport {
  return KEEP_SPORTS.find(s => id.endsWith(s.idSuffix)) ?? KEEP_SPORTS[0]
}
const UA =
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0'

// Keep geoPoints 的 AES-128-CBC 密钥/IV(base64,解出为 16 字节 ASCII),来自 running_page。
const KEEP_AES_KEY = Buffer.from('NTZmZTU5OzgyZzpkODczYw==', 'base64')
const KEEP_AES_IV = Buffer.from('MjM0Njg5MjQzMjkyMDMwMA==', 'base64')

const MAX_LIST_PAGES = 20

interface KeepPoint {
  latitude?: number
  longitude?: number
  altitude?: number
  timestamp?: number
  unixTimestamp?: number
}

export class KeepAdapter implements SyncAdapter {
  name = 'keep'
  private mobile: string
  private password: string
  private token: string | null = null

  constructor(mobile: string, password: string) {
    this.mobile = mobile
    this.password = password
  }

  private async login(): Promise<string> {
    if (this.token) return this.token
    const res = await fetch(LOGIN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'User-Agent': UA,
      },
      body: new URLSearchParams({ mobile: this.mobile, password: this.password }).toString(),
    })
    if (!res.ok) throw new Error(`Keep 登录失败: HTTP ${res.status}`)
    const json = (await res.json()) as { data?: { token?: string }; text?: string }
    const token = json?.data?.token
    if (!token) throw new Error('Keep 登录失败:未返回 token(手机号或密码错误?)')
    this.token = token
    return token
  }

  private authHeaders(token: string) {
    return { Authorization: `Bearer ${token}`, 'User-Agent': UA }
  }

  async authenticate(): Promise<boolean> {
    try {
      await this.login()
      return true
    } catch {
      return false
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.authenticate()
  }

  /**
   * 分页拉取某个运动的日志条目(新→旧);增量时到游标更旧的页就停。
   *
   * Reason: 除了 id 还要把 stats.name 一并带出来 —— **活动名只存在于列表**,
   * 详情接口的返回体里根本没有 name 字段(实测 30 个字段里无 name),
   * 所以标题只能从这里透传下去,否则每条都会退化成兜底的「Keep 跑步/骑行」。
   */
  private async listLogEntries(
    token: string,
    sport: KeepSport,
    after?: number,
  ): Promise<Array<{ id: string; name?: string }>> {
    const entries: Array<{ id: string; name?: string }> = []
    let lastDate = 0
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const url = `${LIST_API}?dateUnit=all&type=${sport.listType}&lastDate=${lastDate}`
      const res = await fetch(url, { headers: this.authHeaders(token) })
      if (!res.ok) break
      const json = (await res.json()) as {
        data?: {
          records?: Array<{ logs?: Array<{ stats?: { id?: string; name?: string; isDoubtful?: boolean } }> }>
          lastTimestamp?: number
        }
      }
      const records = json?.data?.records ?? []
      for (const rec of records) {
        for (const log of rec.logs ?? []) {
          const stats = log?.stats
          if (stats?.id && !stats.isDoubtful) {
            entries.push({ id: stats.id, name: typeof stats.name === 'string' ? stats.name : undefined })
          }
        }
      }
      lastDate = json?.data?.lastTimestamp ?? 0
      if (!lastDate) break
      // 增量:本页最旧一条已早于游标,后续页都更旧 → 停。
      if (after && Math.floor(lastDate / 1000) < after) break
    }
    return entries
  }

  async getActivities(options?: {
    startDate?: Date
    endDate?: Date
    after?: number
    afterByType?: Record<string, number>
    limit?: number
    shouldFetchDetail?: (sourceId: string) => boolean | Promise<boolean>
  }): Promise<RawActivity[]> {
    const token = await this.login()
    const limit = options?.limit ?? 50
    const collected: RawActivity[] = []

    for (const sport of KEEP_SPORTS) {
      // Reason: 游标必须**按运动类型各算一个**。库里 keep 名下长期只有跑步,若共用
      // source 级游标,新接入的骑行一旦入库就把游标推到最新骑行时间,从此时间上更早
      // 但尚未入库的跑步永远拉不回来(反之亦然)。afterByType 缺失时回落到 source 级
      // 游标,保持老行为。
      // afterByType 一旦给出就是**权威且完备**的:某类型不在其中,意味着库里还没有
      // 这个类型的任何活动 ⇒ 该类型应走全量。绝不能回落到 options.after ——
      // 那是所有类型的游标下界,会把新接入类型(如首次开启的骑行)的全部历史挡在门外。
      const after = options?.afterByType ? options.afterByType[sport.type] : options?.after
      const entries = await this.listLogEntries(token, sport, after)
      // 配额按类型独立:否则先跑的 running 会吃掉全部 limit,骑行一条都进不来。
      let taken = 0
      for (const { id, name } of entries) {
        if (taken >= limit) break
        // 拉详情前去重:库里已有直接跳过(省请求)。
        if (options?.shouldFetchDetail && !(await options.shouldFetchDetail(id))) continue
        try {
          const activity = await this.getActivityDetail(id, sport, name)
          if (after && Math.floor(activity.startTime.getTime() / 1000) < after) continue
          collected.push(activity)
          taken++
        } catch (error) {
          console.warn(`[keep] 拉取${sport.label} ${id} 失败:`, (error as Error).message)
        }
      }
      if (taken > 0) console.info(`[keep] ${sport.label}: 取回 ${taken} 条`)
    }

    // 新→旧,让 limit 截断时优先保留最近的活动
    collected.sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
    return collected.slice(0, limit)
  }

  /**
   * @param listName 列表里的 stats.name(如「户外骑行」「晨跑」)。详情接口不返回 name,
   *                 所以标题只能由调用方从列表透传进来;缺省时回落到按运动类型的兜底名。
   */
  async getActivityDetail(id: string, sport?: KeepSport, listName?: string): Promise<RawActivity> {
    const s = sport ?? sportFromId(id)
    const token = await this.login()
    const res = await fetch(`${LOG_API_BASE}/${s.logPath}/${id}`, {
      headers: this.authHeaders(token),
    })
    if (!res.ok) throw new Error(`Keep 活动详情失败: HTTP ${res.status}`)
    const json = (await res.json()) as { data?: Record<string, unknown> }
    const d = (json?.data ?? json) as Record<string, unknown>

    const num = (v: unknown): number | undefined => {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    const startMs = num(d.startTime) ?? num(d.doneDate) ?? 0
    const endMs = num(d.endTime) ?? 0
    const duration = num(d.duration) ?? (endMs && startMs ? Math.round((endMs - startMs) / 1000) : 0)
    const distance = num(d.distance) ?? 0 // Keep 距离单位为米
    const hr = (d.heartRate ?? {}) as Record<string, unknown>
    const averageHeartRate = num(hr.averageHeartRate)
    const calories = num(d.calorie)
    const hasGeo = typeof d.geoPoints === 'string' && (d.geoPoints as string).length > 0
    // Keep 给跑步机记录也塞 geoPoints:2 个恒定的占位假点(天安门坐标)。
    // 只有解出「≥3 个、坐标非恒定」的点才算真轨迹;室内判定优先看 subtype。
    const isTreadmill = d.subtype === 'treadmill'

    // 活动名取自列表的 stats.name(详情接口不返回 name);缺省再按运动类型兜底。
    const title = listName?.trim() || `Keep ${s.label}`

    // 尽力而为解码轨迹 + 逐点心率;失败则降级为无轨迹摘要。
    let gpxData: string | undefined
    let maxHeartRate: number | undefined
    try {
      const hrSeries = typeof hr.heartRates === 'string' ? this.decode(hr.heartRates as string, false) : null
      if (Array.isArray(hrSeries) && hrSeries.length) {
        const bpms = hrSeries
          .map(p => num((p as Record<string, unknown>).beatsPerMinute))
          .filter((n): n is number => n != null)
        if (bpms.length) maxHeartRate = Math.max(...bpms)
      }
      if (hasGeo && !isTreadmill) {
        const points = this.decode(d.geoPoints as string, true)
        if (Array.isArray(points) && isRealTrack(points as KeepPoint[])) {
          gpxData = pointsToGPX(points as KeepPoint[], startMs, endMs, title)
        }
      }
    } catch (error) {
      console.warn(`[keep] 活动 ${id} 轨迹/心率解码失败(降级为摘要):`, (error as Error).message)
    }

    return {
      id,
      title,
      type: s.type,
      // Reason: 「无轨迹 ⇒ 室内」这条只对跑步成立(跑步机是主要的无 GPS 场景)。
      // 骑行若沿用,一次轨迹解码失败就会把户外骑行错标成室内,所以只认 subtype。
      isIndoor: isTreadmill || (s.type === 'running' && !gpxData),
      startTime: new Date(startMs),
      duration,
      distance,
      gpxData,
      averageHeartRate,
      maxHeartRate,
      calories,
      source: 'keep',
    }
  }

  /**
   * probe 诊断:Keep 的原始列表条目 + 原始轨迹点样本。只读,不写库,不做任何过滤。
   *
   * Reason: 有两类问题只能从原始返回判断,而库里只存了加工后的结果 ——
   *   1) 列表:listLogEntries 会静默丢掉 isDoubtful 的条目,没有日志。Keep 里明明有、
   *      同步却拉不到的记录,要看原始列表才知道是被过滤了还是压根不在列表里。
   *   2) 轨迹时间戳:pointsToGPX 按「秒或毫秒」猜单位。库里只有生成后的 GPX,原始点已丢,
   *      要确认 timestamp / unixTimestamp 的真实含义,只能重新拉一次看原值。
   * 点对象整体返回、不挑字段,免得再对字段名做一次猜测。
   */
  async probeDiagnostics(opts: { entriesPerSport?: number; samplesPerSport?: number } = {}) {
    const entriesPerSport = opts.entriesPerSport ?? 8
    const samplesPerSport = opts.samplesPerSport ?? 3
    const token = await this.login()
    const result: Array<Record<string, unknown>> = []

    for (const sport of KEEP_SPORTS) {
      const res = await fetch(`${LIST_API}?dateUnit=all&type=${sport.listType}&lastDate=0`, {
        headers: this.authHeaders(token),
      })
      if (!res.ok) {
        result.push({ type: sport.type, error: `列表 HTTP ${res.status}` })
        continue
      }
      const json = (await res.json()) as {
        data?: { records?: Array<{ logs?: Array<{ stats?: Record<string, unknown> }> }> }
      }
      const entries: Array<Record<string, unknown>> = []
      let statsKeys: string[] = []
      for (const rec of json?.data?.records ?? []) {
        for (const log of rec.logs ?? []) {
          const st = log?.stats ?? {}
          if (!statsKeys.length) statsKeys = Object.keys(st)
          entries.push({
            id: st.id,
            name: st.name,
            isDoubtful: st.isDoubtful ?? null,
            startTime: st.startTime ?? null,
            endTime: st.endTime ?? null,
            doneDate: st.doneDate ?? null,
          })
        }
      }

      const samples: Array<Record<string, unknown>> = []
      for (const entry of entries.slice(0, samplesPerSport)) {
        try {
          const detail = await fetch(`${LOG_API_BASE}/${sport.logPath}/${entry.id}`, {
            headers: this.authHeaders(token),
          })
          if (!detail.ok) {
            samples.push({ id: entry.id, error: `详情 HTTP ${detail.status}` })
            continue
          }
          const dj = (await detail.json()) as { data?: Record<string, unknown> }
          const d = (dj?.data ?? dj) as Record<string, unknown>
          const points =
            typeof d.geoPoints === 'string' && d.geoPoints.length > 0
              ? (this.decode(d.geoPoints, true) as unknown[])
              : []
          samples.push({
            id: entry.id,
            startTime: d.startTime,
            endTime: d.endTime,
            duration: d.duration,
            subtype: d.subtype ?? null,
            pointCount: points.length,
            first: points.slice(0, 2),
            last: points.at(-1) ?? null,
          })
        } catch (error) {
          samples.push({ id: entry.id, error: (error as Error).message })
        }
      }

      result.push({
        type: sport.type,
        listType: sport.listType,
        totalEntries: entries.length,
        doubtfulEntries: entries.filter(e => e.isDoubtful).length,
        statsKeys,
        entries: entries.slice(0, entriesPerSport),
        samples,
      })
    }
    return result
  }

  async downloadGPX(activityId: string): Promise<string> {
    const activity = await this.getActivityDetail(activityId)
    return activity.gpxData ?? ''
  }

  /**
   * base64 → (geo 再做 AES-128-CBC 解密) → gzip 解压 → JSON。
   *
   * Reason: Python zlib 会忽略 gzip 流之后的尾随字节,但 Node 的 gunzipSync 会把
   * AES 的 PKCS7 padding 当作"下一个 gzip 成员"解析,抛 incorrect header check——
   * 这曾让所有 Keep 跑步的轨迹静默降级为无 GPS。因此解密后必须先裁掉 padding。
   */
  private decode(text: string, isGeo: boolean): unknown {
    let buf = Buffer.from(text, 'base64')
    if (isGeo) {
      const decipher = createDecipheriv('aes-128-cbc', KEEP_AES_KEY, KEEP_AES_IV)
      decipher.setAutoPadding(false)
      buf = Buffer.concat([decipher.update(buf), decipher.final()])
      const pad = buf[buf.length - 1]
      if (pad >= 1 && pad <= 16 && buf.length > pad) buf = buf.subarray(0, buf.length - pad)
    }
    return JSON.parse(gunzipSync(buf).toString('utf8'))
  }
}

/** 真轨迹判定:≥3 个有效点且坐标非恒定(挡掉跑步机的占位假点)。 */
function isRealTrack(points: KeepPoint[]): boolean {
  const valid = points.filter(p => p.latitude != null && p.longitude != null)
  if (valid.length < 3) return false
  const first = valid[0]
  return valid.some(p => p.latitude !== first.latitude || p.longitude !== first.longitude)
}

/** 超过这个值(分秒,= 100 小时)的 timestamp 视为绝对时间而非距起点的偏移。 */
const DECISECOND_ABSOLUTE_THRESHOLD = 3_600_000

/**
 * 逐点时间(epoch 毫秒)。以 timestamp 为准:距起点的偏移,单位分秒(0.1 秒)。
 *
 * Reason: 09-28 用 probe diagnostics 拿 Keep 原始点实测(跑步、骑行共 4 条样本):
 *   - unixTimestamp 在整条记录里几乎不变(09-02 骑行 4497 个点只跨 27 毫秒),是记录保存时刻,
 *     不是逐点时间。旧实现优先用它,所有点挤在同一瞬间,每公里时长全成了 0 ——
 *     迁移到 admin 之后同步的 Keep 活动(骑行 9 条中 7 条、跑步 2 条)都中招。
 *   - timestamp = currentTotalDuration × 10;末点 ×0.1s 与 endTime − startTime 的误差都在
 *     几秒内。与参考实现 running_page 的结论一致;它提到的新格式(超过 100 小时即为绝对时间)
 *     一并兼容。
 * 首点常缺 timestamp,按 0 处理;中途缺失沿用上一个点。
 * 换算出的首尾跨度必须与 Keep 汇总的起止时间吻合,否则返回 null ——
 * 宁可不给时间(分段会退回按总时长平均),也不给错误的时间。
 */
function pointTimesMs(points: KeepPoint[], startMs: number, endMs: number): number[] | null {
  const raw = points.map(p => (typeof p.timestamp === 'number' && Number.isFinite(p.timestamp) ? p.timestamp : null))
  const absolute = raw.some(v => v != null && v > DECISECOND_ABSOLUTE_THRESHOLD)
  // 绝对模式下,不像绝对时间的值(如首点的 0)当作缺失。
  const usable = (v: number | null): v is number => v != null && (!absolute || v > DECISECOND_ABSOLUTE_THRESHOLD)
  const first = raw.find(usable)
  if (first == null) return null

  let current = absolute ? first : 0
  const times = raw.map(v => {
    if (usable(v)) current = v
    return (absolute ? 0 : startMs) + current * 100
  })

  if (endMs > startMs) {
    const span = times[times.length - 1] - times[0]
    const expected = endMs - startMs
    if (Math.abs(span - expected) > Math.max(60_000, expected * 0.1)) {
      console.warn(`[keep] 轨迹时间跨度 ${Math.round(span / 1000)}s 与记录时长 ${Math.round(expected / 1000)}s 不符,不写逐点时间`)
      return null
    }
  }
  return times
}

/** Keep 解码后的轨迹点 → 标准 GPX(坐标为 GCJ-02,仅用于测距/分段,不做地图叠加)。 */
function pointsToGPX(points: KeepPoint[], startMs: number, endMs: number, name: string): string | undefined {
  const valid = points.filter(p => p.latitude != null && p.longitude != null)
  const times = pointTimesMs(valid, startMs, endMs)
  const trkpts: string[] = []
  valid.forEach((p, i) => {
    const t = times ? `<time>${new Date(times[i]).toISOString()}</time>` : ''
    const ele = p.altitude != null ? `<ele>${p.altitude}</ele>` : ''
    trkpts.push(`<trkpt lat="${p.latitude}" lon="${p.longitude}">${ele}${t}</trkpt>`)
  })
  if (!trkpts.length) return undefined
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="runPaceFlow-keep" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${name.replace(/[<>&]/g, '')}</name><trkseg>
${trkpts.join('\n')}
</trkseg></trk></gpx>`
}
