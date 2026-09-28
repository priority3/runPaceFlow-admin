import { and, eq, gte, lte } from 'drizzle-orm'

import { getDb } from '@/lib/db/activities-client'
import { activities, splits } from '@/lib/db/activities-schema'
import { calculatePace } from '@/lib/pace/calculator'
import { generateId } from '@/lib/utils'
import { fetchWeatherForActivity } from '@/lib/weather/open-meteo'

import type { RawActivity } from './adapters/base'
import {
  calculateDistance,
  calculateElevationGain,
  calculateTrackDistance,
  extractRouteCoordinatesJSON,
  parseGPX,
} from './parser'
import { extractCoordinatesFromGPX, matchRaceForActivity } from './race-matcher'

/**
 * 数据处理器
 * 将原始活动数据转换并存储到数据库
 */

/**
 * 跨源重复判定的容差。
 *
 * Reason: 同一次运动常被两个 App 各记一份(手表→Keep + 手表→Strava),两边的
 * source/sourceId 完全不同,(source, sourceId) 这把唯一键拦不住。库里已实测存在
 * 这样的双记(例如 2026-06-20 那次 5.24km 骑行,Keep 与 Strava 各一条)。
 * 判据用「开始时间接近 + 距离接近 + 同类型」:两个 App 的计时起点常差几十秒,
 * GPS 算距也有零点几个百分点的出入,所以两边都要留容差。
 */
const CROSS_SOURCE_TIME_TOLERANCE_SEC = 300
const CROSS_SOURCE_DISTANCE_TOLERANCE = 0.03 // 相对差 3%

/**
 * 找出「同一次运动、但来自另一个数据源」的已存在活动。
 * 命中则说明这条是重复,应跳过入库(保留先入库的那条,避免动已被引用的 id)。
 */
async function findCrossSourceDuplicate(rawActivity: RawActivity) {
  const db = await getDb()
  const startSec = Math.floor(rawActivity.startTime.getTime() / 1000)
  const lo = new Date((startSec - CROSS_SOURCE_TIME_TOLERANCE_SEC) * 1000)
  const hi = new Date((startSec + CROSS_SOURCE_TIME_TOLERANCE_SEC) * 1000)

  const nearby = await db
    .select()
    .from(activities)
    .where(and(gte(activities.startTime, lo), lte(activities.startTime, hi)))

  for (const row of nearby) {
    if (row.source === rawActivity.source) continue // 同源由 (source,sourceId) 唯一键负责
    if (row.type !== rawActivity.type) continue
    const a = row.distance ?? 0
    const b = rawActivity.distance ?? 0
    if (a <= 0 || b <= 0) continue
    if (Math.abs(a - b) / Math.max(a, b) <= CROSS_SOURCE_DISTANCE_TOLERANCE) return row
  }
  return null
}

/**
 * 同步单个活动到数据库
 * @param rawActivity 原始活动数据
 * @returns 活动 ID
 */
export async function syncActivity(rawActivity: RawActivity): Promise<string> {
  try {
    const db = await getDb()

    // 检查活动是否已存在
    const existing = await db
      .select()
      .from(activities)
      .where(and(eq(activities.source, rawActivity.source), eq(activities.sourceId, rawActivity.id)))
      .limit(1)

    if (existing.length > 0) {
      console.info(`Activity ${rawActivity.id} already exists, skipping...`)
      return existing[0].id
    }

    // 跨源判重:同一次运动被两个 App 各记一份时,只保留先入库的那条
    const crossDup = await findCrossSourceDuplicate(rawActivity)
    if (crossDup) {
      console.info(
        `[sync] 跨源重复,跳过 ${rawActivity.source}/${rawActivity.id} —— ` +
          `已有 ${crossDup.source} 的同一次${rawActivity.type}(${(rawActivity.distance / 1000).toFixed(2)}km @ ${rawActivity.startTime.toISOString()})`,
      )
      return crossDup.id
    }

    // 解析 GPX 数据
    let gpxData = null
    let parsedGPX = null
    if (rawActivity.gpxData) {
      try {
        parsedGPX = parseGPX(rawActivity.gpxData)
        gpxData = rawActivity.gpxData
      } catch (error) {
        console.warn(`Failed to parse GPX for activity ${rawActivity.id}:`, error)
      }
    }

    // 计算活动的基础数据
    const distance = rawActivity.distance || 0
    const duration = rawActivity.duration || 0
    const averagePace =
      rawActivity.averagePace || (distance > 0 ? calculatePace(distance, duration) : 0)

    // 匹配跑步赛事名称（半马以上距离）
    let raceName: string | null = null
    if (rawActivity.type === 'running' && distance >= 20500) {
      const coords = extractCoordinatesFromGPX(gpxData)
      raceName = await matchRaceForActivity(rawActivity.startTime, distance, coords)
      if (raceName) {
        console.info(`Matched race: ${raceName} for activity ${rawActivity.id}`)
      }
    }

    // 获取天气数据（仅室外活动）
    let weatherData: string | null = null
    if (!rawActivity.isIndoor) {
      try {
        const coords = extractCoordinatesFromGPX(gpxData)
        if (coords) {
          const weather = await fetchWeatherForActivity(
            coords.lat,
            coords.lng,
            rawActivity.startTime,
          )
          if (weather) {
            weatherData = JSON.stringify(weather)
            console.info(
              `Weather for activity ${rawActivity.id}: ${weather.temperature}°C, ${weather.description}`,
            )
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch weather for activity ${rawActivity.id}:`, error)
      }
    }

    // 创建活动记录
    const activityId = generateId('act')
    const endTime = new Date(rawActivity.startTime.getTime() + duration * 1000)

    // 预计算降采样坐标用于地图快速加载
    const routeCoordinates = gpxData ? extractRouteCoordinatesJSON(gpxData) : null

    await db.insert(activities).values({
      id: activityId,
      title: raceName ?? rawActivity.title,
      type: rawActivity.type,
      source: rawActivity.source,
      sourceId: rawActivity.id,
      startTime: rawActivity.startTime,
      endTime,
      duration,
      distance,
      averagePace,
      bestPace: rawActivity.bestPace, // 瞬时最快配速（来自 Strava max_speed）
      elevationGain: rawActivity.elevationGain,
      averageHeartRate: rawActivity.averageHeartRate,
      maxHeartRate: rawActivity.maxHeartRate,
      calories: rawActivity.calories,
      gpxData,
      routeCoordinates,
      isIndoor: rawActivity.isIndoor ?? false,
      raceName,
      weatherData,
    })

    // 生成分段数据
    const plan = planSplits(activityId, parsedGPX?.tracks[0]?.points ?? null, distance, duration, averagePace)
    if (plan.records.length > 0) {
      await db.insert(splits).values(plan.records)
      console.info(`Generated ${plan.records.length} ${plan.mode} splits for activity ${activityId}`)
    }
    if (plan.bestPace != null) {
      await db.update(activities).set({ bestPace: plan.bestPace }).where(eq(activities.id, activityId))
      console.info(`Updated bestPace for activity ${activityId}: ${plan.bestPace.toFixed(1)} sec/km`)
    }

    console.info(`Successfully synced activity ${activityId} (source: ${rawActivity.source})`)
    return activityId
  } catch (error) {
    console.error(`Failed to sync activity ${rawActivity.id}:`, error)
    throw error
  }
}

/**
 * 批量同步活动
 * @param rawActivities 原始活动数组
 * @returns 同步的活动 ID 数组
 */
export async function syncActivities(rawActivities: RawActivity[]): Promise<string[]> {
  const activityIds: string[] = []

  for (const rawActivity of rawActivities) {
    try {
      const id = await syncActivity(rawActivity)
      activityIds.push(id)
    } catch (error) {
      console.error(`Failed to sync activity ${rawActivity.id}, continuing...`, error)
    }
  }

  return activityIds
}

type TrackPoint = { lat: number; lon: number; time?: Date; ele?: number; hr?: number }
type SplitRecord = typeof splits.$inferInsert

/** 分段计划:纯计算,不落库。写库留给调用方,这样才能放进事务(见 rebuild.ts)。 */
export interface SplitPlan {
  mode: 'gpx' | 'average' | 'none'
  records: SplitRecord[]
  /** 仅按轨迹计算时给出:配速数值最小的分段。 */
  bestPace?: number
}

/** 首尾两点都有时间、且跨度大于 0,才能按点计算每公里时长。 */
function hasUsableTimes(points: TrackPoint[]): boolean {
  const first = points[0]?.time?.getTime()
  const last = points.at(-1)?.time?.getTime()
  return first != null && last != null && Number.isFinite(first) && Number.isFinite(last) && last > first
}

/**
 * 决定一条活动的分段:有带时间的轨迹就按点切公里,否则按总距离/总时长平均。
 *
 * Reason: 以前只要解析出 GPX 就按点算,不管点有没有时间 —— Keep 轨迹时间戳错误时
 * (所有点挤在同一瞬间),每公里时长全是 0、配速是 0.002 这种无意义的数,bestPace 也跟着坏。
 * 没有可用时间时退回平均分段,至少给出的是真实的平均值。
 */
export function planSplits(
  activityId: string,
  points: TrackPoint[] | null,
  distance: number,
  duration: number,
  averagePace: number,
): SplitPlan {
  if (points && points.length >= 2 && hasUsableTimes(points)) {
    const records = buildGpxSplits(activityId, points)
    const paces = records.map(r => r.pace).filter((pace): pace is number => pace != null && pace > 0)
    return { mode: 'gpx', records, bestPace: paces.length > 0 ? Math.min(...paces) : undefined }
  }
  if (distance > 0 && duration > 0) {
    return { mode: 'average', records: buildAverageSplits(activityId, distance, duration, averagePace) }
  }
  return { mode: 'none', records: [] }
}

/**
 * 根据 GPX 轨迹点生成分段数据
 * @param activityId 活动 ID
 * @param points GPX 轨迹点
 */
function buildGpxSplits(activityId: string, points: TrackPoint[]): SplitRecord[] {
  const splitRecords: SplitRecord[] = []

  let kmCount = 0
  let kmStartIndex = 0
  let totalDistance = 0

  for (let i = 1; i < points.length; i++) {
    const segmentDistance = calculateDistance(points[i - 1], points[i])
    totalDistance += segmentDistance

    // 每累计 1000 米创建一个分段
    if (totalDistance >= (kmCount + 1) * 1000) {
      const splitPoints = points.slice(kmStartIndex, i + 1)

      // 计算分段时长
      const startTime = splitPoints[0].time
      const endTime = splitPoints.at(-1)?.time
      const splitDuration =
        startTime && endTime ? (endTime.getTime() - startTime.getTime()) / 1000 : 0

      // 计算分段距离
      const splitDistance = calculateTrackDistance(splitPoints)

      // 计算配速
      const splitPace = splitDistance > 0 ? calculatePace(splitDistance, splitDuration) : 0

      // 计算海拔上升
      const splitElevationGain = calculateElevationGain(splitPoints)

      // 计算平均心率
      const heartRates = splitPoints.map((p) => p.hr).filter((hr) => hr != null)
      const avgHeartRate =
        heartRates.length > 0
          ? Math.round(heartRates.reduce((sum, hr) => sum + hr, 0) / heartRates.length)
          : undefined

      splitRecords.push({
        id: generateId('split'),
        activityId,
        kilometer: kmCount + 1,
        duration: Math.round(splitDuration),
        pace: splitPace,
        distance: splitDistance,
        elevationGain: splitElevationGain > 0 ? splitElevationGain : undefined,
        averageHeartRate: avgHeartRate,
      })

      kmCount++
      kmStartIndex = i
    }
  }

  return splitRecords
}

/**
 * 生成平均分段数据（无可用轨迹时间时使用）
 * @param activityId 活动 ID
 * @param totalDistance 总距离（米）
 * @param totalDuration 总时长（秒）
 * @param averagePace 平均配速（秒/公里）
 */
function buildAverageSplits(
  activityId: string,
  totalDistance: number,
  totalDuration: number,
  averagePace: number,
): SplitRecord[] {
  const kmCount = Math.floor(totalDistance / 1000)
  if (kmCount === 0) return []

  const splitRecords: SplitRecord[] = []
  const avgSplitDuration = Math.round(totalDuration / (totalDistance / 1000))

  for (let i = 1; i <= kmCount; i++) {
    splitRecords.push({
      id: generateId('split'),
      activityId,
      kilometer: i,
      duration: avgSplitDuration,
      pace: averagePace,
      distance: 1000,
    })
  }
  return splitRecords
}

/**
 * 回填缺失天气数据的统计结果
 */
export interface BackfillWeatherResult {
  total: number
  success: number
  failed: number
  skipped: number
}

/**
 * 为缺少天气数据的室外活动批量获取天气
 *
 * 查询 weather_data 为空、非室内、且有 GPX 数据的活动，
 * 逐条获取历史天气并更新数据库。
 *
 * @param delayMs 请求间隔（毫秒），避免 Open-Meteo 限流
 */
export async function backfillMissingWeather(delayMs = 1000): Promise<BackfillWeatherResult> {
  const db = await getDb()
  const allActivities = await db.select().from(activities).all()

  const eligible = allActivities.filter(
    (a) => a.weatherData === null && a.isIndoor === false && a.gpxData !== null,
  )

  if (eligible.length === 0) {
    return { total: 0, success: 0, failed: 0, skipped: 0 }
  }

  console.info(`\n🌤️  Backfilling weather for ${eligible.length} activities...`)

  let success = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < eligible.length; i++) {
    const activity = eligible[i]

    const coords = extractCoordinatesFromGPX(activity.gpxData)
    if (!coords) {
      skipped++
      continue
    }

    try {
      const weather = await fetchWeatherForActivity(coords.lat, coords.lng, activity.startTime)

      if (weather) {
        await db
          .update(activities)
          .set({ weatherData: JSON.stringify(weather) })
          .where(eq(activities.id, activity.id))
        success++
        console.info(
          `  [${i + 1}/${eligible.length}] ${activity.title}: ${weather.description} ${weather.temperature}°C`,
        )
      } else {
        failed++
      }
    } catch {
      failed++
    }

    // Reason: Delay between requests to respect Open-Meteo rate limits
    if (i < eligible.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  console.info(`🌤️  Weather backfill done: ${success} ok, ${failed} failed, ${skipped} skipped`)
  return { total: eligible.length, success, failed, skipped }
}

/**
 * 删除活动
 * @param activityId 活动 ID
 */
export async function deleteActivity(activityId: string): Promise<void> {
  const db = await getDb()
  await db.delete(activities).where(eq(activities.id, activityId))
  console.info(`Deleted activity ${activityId}`)
}
