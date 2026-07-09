/**
 * 一次性回填:Keep 历史活动的 GPS 轨迹。
 *
 * 背景:keep 适配器的 decode 曾因「Node gunzip 不忽略 AES padding」全部解码失败,
 * 50 条跑步以无轨迹摘要入库(gpx_data/route_coordinates 为空、is_indoor 误标)。
 * 适配器已修复(src/lib/sync/adapters/keep.ts);本脚本重拉这些活动的详情,补:
 *   gpx_data / route_coordinates / is_indoor / max_heart_rate / elevation_gain
 *   + 用真实轨迹重建 splits(替换无轨迹时生成的平均分段)并更新 best_pace。
 *
 * 运行(heyun 容器内,node_modules 可解析):
 *   docker cp scripts/backfill-keep-tracks.mjs runpaceflow-admin:/app/
 *   docker exec runpaceflow-admin node /app/backfill-keep-tracks.mjs [--dry-run]
 */
import { createClient } from '@libsql/client'
import { createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const DRY_RUN = process.argv.includes('--dry-run')
const SHARED_DB = process.env.BACKFILL_SHARED_DB || 'file:/app/shared/shared.db'
const CONFIG_DB = process.env.BACKFILL_CONFIG_DB || 'file:/app/data/admin.db'
const DETAIL_DELAY_MS = 800 // Keep 详情接口限速保护

// ── 设置读取(与 src/lib/crypto.ts 的 enc:v1 格式一致) ──
function decryptSetting(value, secret) {
  if (!value.startsWith('enc:v1:')) return value
  const [, , ivRaw, tagRaw, dataRaw] = value.split(':')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    createHash('sha256').update(secret).digest(),
    Buffer.from(ivRaw, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]).toString('utf8')
}

async function loadKeepCredentials() {
  const cfg = createClient({ url: CONFIG_DB })
  const { rows } = await cfg.execute(
    "SELECT key, value FROM app_settings WHERE key IN ('KEEP_MOBILE','KEEP_PASSWORD')",
  )
  const secret = process.env.SETTINGS_ENCRYPTION_KEY || process.env.ADMIN_SESSION_SECRET || ''
  const settings = Object.fromEntries(rows.map(row => [row.key, decryptSetting(String(row.value), secret)]))
  if (!settings.KEEP_MOBILE || !settings.KEEP_PASSWORD) throw new Error('KEEP_MOBILE / KEEP_PASSWORD 未配置')
  return settings
}

// ── Keep API(与 src/lib/sync/adapters/keep.ts 修复版一致) ──
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0'
const KEEP_AES_KEY = Buffer.from('NTZmZTU5OzgyZzpkODczYw==', 'base64')
const KEEP_AES_IV = Buffer.from('MjM0Njg5MjQzMjkyMDMwMA==', 'base64')

async function keepLogin(mobile, password) {
  const res = await fetch('https://api.gotokeep.com/v1.1/users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', 'User-Agent': UA },
    body: new URLSearchParams({ mobile, password }).toString(),
  })
  const json = await res.json()
  const token = json?.data?.token
  if (!token) throw new Error(`Keep 登录失败: HTTP ${res.status}`)
  return token
}

/** base64 → (geo: AES-128-CBC 解密 + 去 PKCS7 padding) → gunzip → JSON */
function decode(text, isGeo) {
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

/** 真轨迹判定:≥3 个有效点且坐标非恒定(挡跑步机占位假点)。 */
function isRealTrack(points) {
  const valid = points.filter(p => p.latitude != null && p.longitude != null)
  if (valid.length < 3) return false
  const first = valid[0]
  return valid.some(p => p.latitude !== first.latitude || p.longitude !== first.longitude)
}

/** KeepPoint → { lat, lon, ele?, time }(时间逻辑同 pointsToGPX) */
function toTrackPoints(points, startMs) {
  const out = []
  for (const p of points) {
    if (p.latitude == null || p.longitude == null) continue
    const time = p.unixTimestamp != null && p.unixTimestamp > 0
      ? new Date(p.unixTimestamp)
      : p.timestamp != null
        ? new Date(startMs + (p.timestamp < 1e6 ? p.timestamp * 1000 : p.timestamp))
        : new Date(startMs)
    out.push({ lat: p.latitude, lon: p.longitude, ele: p.altitude ?? undefined, time })
  }
  return out
}

function pointsToGPX(trackPoints, name) {
  const trkpts = trackPoints.map(p => {
    const ele = p.ele != null ? `<ele>${p.ele}</ele>` : ''
    return `<trkpt lat="${p.lat}" lon="${p.lon}">${ele}<time>${p.time.toISOString()}</time></trkpt>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="runPaceFlow-keep" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${name.replace(/[<>&]/g, '')}</name><trkseg>
${trkpts.join('\n')}
</trkseg></trk></gpx>`
}

/** 降采样坐标 JSON(镜像 parser.extractRouteCoordinatesJSON:5 位小数、≤500 点均匀采样) */
function routeCoordinatesJSON(trackPoints, maxPoints = 500) {
  const coords = trackPoints.map(p => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5])
  if (!coords.length) return null
  const down = coords.length > maxPoints
    ? coords.filter((_, i) => i % Math.ceil(coords.length / maxPoints) === 0)
    : coords
  return JSON.stringify(down)
}

// ── 距离/海拔/分段(镜像 parser.ts + processor.generateSplits) ──
function haversine(a, b) {
  const R = 6371e3
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

function elevationGain(points) {
  // 只累加「相邻两点都有海拔」的段:缺失值(→0)参与差值会算出几千米的假爬升
  let gain = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].ele
    const curr = points[i].ele
    if (prev == null || curr == null) continue
    const diff = curr - prev
    if (diff > 0) gain += diff
  }
  return gain
}

function generateSplitRecords(activityId, points) {
  const records = []
  let kmCount = 0
  let kmStartIndex = 0
  let totalDistance = 0
  for (let i = 1; i < points.length; i++) {
    totalDistance += haversine(points[i - 1], points[i])
    if (totalDistance >= (kmCount + 1) * 1000) {
      const seg = points.slice(kmStartIndex, i + 1)
      const durationSec = (seg[seg.length - 1].time.getTime() - seg[0].time.getTime()) / 1000
      let segDistance = 0
      for (let j = 1; j < seg.length; j++) segDistance += haversine(seg[j - 1], seg[j])
      const pace = segDistance > 0 ? durationSec / (segDistance / 1000) : 0
      const gain = elevationGain(seg)
      records.push({
        id: `split_${randomBytes(16).toString('base64url').slice(0, 21)}`,
        activityId,
        kilometer: kmCount + 1,
        duration: Math.round(durationSec),
        pace,
        distance: segDistance,
        elevationGain: gain > 0 ? gain : null,
      })
      kmCount++
      kmStartIndex = i
    }
  }
  return records
}

// ── 主流程 ──
const creds = await loadKeepCredentials()
const token = await keepLogin(creds.KEEP_MOBILE, creds.KEEP_PASSWORD)
const headers = { Authorization: `Bearer ${token}`, 'User-Agent': UA }
const db = createClient({ url: SHARED_DB })

const { rows: targets } = await db.execute(
  "SELECT id, source_id, title, start_time, distance, is_indoor FROM activities WHERE source = 'keep' AND gpx_data IS NULL ORDER BY start_time DESC",
)
console.log(`待回填活动: ${targets.length} 条${DRY_RUN ? '(dry-run,不写库)' : ''}`)

let restored = 0
let indoor = 0
let failed = 0
for (const [index, row] of targets.entries()) {
  const label = `[${index + 1}/${targets.length}] ${row.title} (${row.id})`
  try {
    const res = await fetch(`https://api.gotokeep.com/pd/v3/runninglog/${row.source_id}`, { headers })
    if (!res.ok) throw new Error(`详情 HTTP ${res.status}`)
    const json = await res.json()
    const d = json?.data ?? json
    const isTreadmill = d?.subtype === 'treadmill'
    const geo = typeof d?.geoPoints === 'string' && d.geoPoints.length ? decode(d.geoPoints, true) : null

    // 逐点心率 → max_heart_rate(缺失时补)
    let maxHr = null
    const hrRaw = d?.heartRate?.heartRates
    if (typeof hrRaw === 'string' && hrRaw.length) {
      try {
        const bpms = decode(hrRaw, false).map(p => p?.beatsPerMinute).filter(n => Number.isFinite(n))
        if (bpms.length) maxHr = Math.max(...bpms)
      } catch { /* 心率解不出不影响轨迹 */ }
    }

    if (isTreadmill || !Array.isArray(geo) || !isRealTrack(geo)) {
      // 室内/无真轨迹:纠正 is_indoor 标记即可
      indoor++
      console.log(`${label} → 室内/无轨迹${isTreadmill ? '(treadmill)' : ''}`)
      if (!DRY_RUN) {
        await db.execute({
          sql: 'UPDATE activities SET is_indoor = 1, max_heart_rate = coalesce(max_heart_rate, ?), updated_at = unixepoch() WHERE id = ?',
          args: [maxHr, row.id],
        })
      }
      continue
    }

    const startMs = Number(row.start_time) * 1000
    const trackPoints = toTrackPoints(geo, startMs)
    const gpx = pointsToGPX(trackPoints, String(row.title ?? 'Keep 跑步'))
    const routeJson = routeCoordinatesJSON(trackPoints)
    const rawGain = Math.round(elevationGain(trackPoints) * 10) / 10
    // 合理性门槛:爬升超过距离的 20% 基本是 GPS/气压海拔噪声(老的手表导入常见),不写入
    const gain = rawGain > 0 && rawGain <= Number(row.distance) * 0.2 ? rawGain : null
    const splitRecords = generateSplitRecords(row.id, trackPoints)
    // 活动级爬升不可信 → 同源的分段爬升一并置空
    if (gain === null) for (const r of splitRecords) r.elevationGain = null
    const validPaces = splitRecords.map(r => r.pace).filter(p => p > 0)
    const bestPace = validPaces.length ? Math.min(...validPaces) : null

    console.log(
      `${label} → ${trackPoints.length} 点, gpx ${(gpx.length / 1024).toFixed(0)}KB, splits ${splitRecords.length}, 爬升 ${gain ?? `不可信(${rawGain})`}m${maxHr ? `, maxHR ${maxHr}` : ''}`,
    )
    if (!DRY_RUN) {
      await db.execute({
        sql: `UPDATE activities SET gpx_data = ?, route_coordinates = ?, is_indoor = 0,
              elevation_gain = coalesce(elevation_gain, ?), max_heart_rate = coalesce(max_heart_rate, ?),
              best_pace = coalesce(?, best_pace), updated_at = unixepoch() WHERE id = ?`,
        args: [gpx, routeJson, gain, maxHr, bestPace, row.id],
      })
      if (splitRecords.length) {
        // 真轨迹分段替换入库时的平均分段
        await db.execute({ sql: 'DELETE FROM splits WHERE activity_id = ?', args: [row.id] })
        for (const r of splitRecords) {
          await db.execute({
            sql: 'INSERT INTO splits (id, activity_id, kilometer, duration, pace, distance, elevation_gain) VALUES (?,?,?,?,?,?,?)',
            args: [r.id, r.activityId, r.kilometer, r.duration, r.pace, r.distance, r.elevationGain],
          })
        }
      }
    }
    restored++
  } catch (error) {
    failed++
    console.warn(`${label} → 失败: ${error.message}`)
  }
  if (index < targets.length - 1) await new Promise(resolve => setTimeout(resolve, DETAIL_DELAY_MS))
}

console.log(`\n完成: 轨迹回填 ${restored}, 室内/无轨迹 ${indoor}, 失败 ${failed}`)
