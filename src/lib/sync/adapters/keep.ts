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

  /** 分页拉取某个运动的日志 id(新→旧);增量时到游标更旧的页就停。 */
  private async listLogIds(token: string, sport: KeepSport, after?: number): Promise<string[]> {
    const ids: string[] = []
    let lastDate = 0
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const url = `${LIST_API}?dateUnit=all&type=${sport.listType}&lastDate=${lastDate}`
      const res = await fetch(url, { headers: this.authHeaders(token) })
      if (!res.ok) break
      const json = (await res.json()) as {
        data?: { records?: Array<{ logs?: Array<{ stats?: { id?: string; isDoubtful?: boolean } }> }>; lastTimestamp?: number }
      }
      const records = json?.data?.records ?? []
      for (const rec of records) {
        for (const log of rec.logs ?? []) {
          const stats = log?.stats
          if (stats?.id && !stats.isDoubtful) ids.push(stats.id)
        }
      }
      lastDate = json?.data?.lastTimestamp ?? 0
      if (!lastDate) break
      // 增量:本页最旧一条已早于游标,后续页都更旧 → 停。
      if (after && Math.floor(lastDate / 1000) < after) break
    }
    return ids
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
      const ids = await this.listLogIds(token, sport, after)
      // 配额按类型独立:否则先跑的 running 会吃掉全部 limit,骑行一条都进不来。
      let taken = 0
      for (const id of ids) {
        if (taken >= limit) break
        // 拉详情前去重:库里已有直接跳过(省请求)。
        if (options?.shouldFetchDetail && !(await options.shouldFetchDetail(id))) continue
        try {
          const activity = await this.getActivityDetail(id, sport)
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

  async getActivityDetail(id: string, sport?: KeepSport): Promise<RawActivity> {
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
          gpxData = pointsToGPX(points as KeepPoint[], startMs, typeof d.name === 'string' ? d.name : `Keep ${s.label}`)
        }
      }
    } catch (error) {
      console.warn(`[keep] 活动 ${id} 轨迹/心率解码失败(降级为摘要):`, (error as Error).message)
    }

    return {
      id,
      title: typeof d.name === 'string' && d.name ? d.name : `Keep ${s.label}`,
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

/** Keep 解码后的轨迹点 → 标准 GPX(坐标为 GCJ-02,仅用于测距/分段,不做地图叠加)。 */
function pointsToGPX(points: KeepPoint[], startMs: number, name: string): string | undefined {
  const trkpts: string[] = []
  for (const p of points) {
    if (p.latitude == null || p.longitude == null) continue
    // timestamp 多为距起点的偏移(秒或毫秒);优先用 unixTimestamp。
    const t = p.unixTimestamp != null
      ? new Date(p.unixTimestamp).toISOString()
      : p.timestamp != null
        ? new Date(startMs + (p.timestamp < 1e6 ? p.timestamp * 1000 : p.timestamp)).toISOString()
        : new Date(startMs).toISOString()
    const ele = p.altitude != null ? `<ele>${p.altitude}</ele>` : ''
    trkpts.push(`<trkpt lat="${p.latitude}" lon="${p.longitude}">${ele}<time>${t}</time></trkpt>`)
  }
  if (!trkpts.length) return undefined
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="runPaceFlow-keep" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${name.replace(/[<>&]/g, '')}</name><trkseg>
${trkpts.join('\n')}
</trkseg></trk></gpx>`
}
