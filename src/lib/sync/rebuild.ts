/**
 * Keep 活动轨迹与分段的原地重建。
 *
 * Reason: 修好 pointsToGPX 的时间戳换算之后,已经入库的坏数据不会自己变好 —— 同步遇到
 * 已存在的活动会直接跳过(service.ts 的 shouldFetchDetail)。又不能删了重导:活动 ID 会变,
 * 而 PR 的复盘、批注、主观反馈都挂在这个 ID 上。所以按原 ID 重新拉 Keep 详情,只替换
 * gpx_data / route_coordinates / splits / best_pace,其余字段(标题、天气、心率等)不动。
 *
 * 默认 dryRun:只在内存里算出新分段并报告前后对比,不写库。显式传 dryRun:false 才写。
 */
import { eq, inArray, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db/activities-client'
import { activities, splits } from '@/lib/db/activities-schema'
import { getRuntimeSettings } from '@/lib/runtime-config'

import { KeepAdapter } from './adapters/keep'
import { extractRouteCoordinatesJSON, parseGPX } from './parser'
import { planSplits } from './processor'

interface SplitSummary {
  splits: number
  /** 各分段时长之和(秒)。受时间戳问题影响的活动这里是 0。 */
  splitSeconds: number
  bestPace: number | null
}

export interface RebuildItem {
  id: string
  title: string
  startTime: string
  before: SplitSummary
  after?: SplitSummary & { mode: string }
  error?: string
}

export interface RebuildResult {
  dryRun: boolean
  targets: number
  rebuilt: number
  failed: number
  items: RebuildItem[]
}

export async function rebuildKeepTracks(options: {
  activityIds?: string[]
  dryRun?: boolean
}): Promise<RebuildResult> {
  const dryRun = options.dryRun !== false
  const db = await getDb()

  const aggregates = await db
    .select({
      activityId: splits.activityId,
      count: sql<number>`count(*)`,
      seconds: sql<number>`coalesce(sum(${splits.duration}), 0)`,
    })
    .from(splits)
    .groupBy(splits.activityId)
  const splitStats = new Map(aggregates.map(a => [a.activityId, { count: Number(a.count), seconds: Number(a.seconds) }]))

  const candidates = await db
    .select({
      id: activities.id,
      title: activities.title,
      source: activities.source,
      sourceId: activities.sourceId,
      startTime: activities.startTime,
      distance: activities.distance,
      duration: activities.duration,
      averagePace: activities.averagePace,
      bestPace: activities.bestPace,
      hasGpx: sql<number>`${activities.gpxData} is not null`,
    })
    .from(activities)
    .where(options.activityIds?.length ? inArray(activities.id, options.activityIds) : eq(activities.source, 'keep'))

  // 指定了 ID 就只修这些(仍要求是 Keep 来源);否则挑「有轨迹但分段总时长为 0」的那批。
  const targets = candidates.filter(row => {
    if (row.source !== 'keep') return false
    if (options.activityIds?.length) return true
    const stats = splitStats.get(row.id)
    return Number(row.hasGpx) === 1 && stats != null && stats.count > 0 && stats.seconds === 0
  })

  const result: RebuildResult = { dryRun, targets: targets.length, rebuilt: 0, failed: 0, items: [] }
  if (targets.length === 0) return result

  const settings = await getRuntimeSettings({ force: true })
  if (!settings.KEEP_MOBILE || !settings.KEEP_PASSWORD) {
    throw new Error('No credentials found for keep (需在设置里填 KEEP_MOBILE / KEEP_PASSWORD)')
  }
  const adapter = new KeepAdapter(settings.KEEP_MOBILE, settings.KEEP_PASSWORD)

  for (const row of targets) {
    const stats = splitStats.get(row.id)
    const item: RebuildItem = {
      id: row.id,
      title: row.title,
      startTime: row.startTime.toISOString(),
      before: { splits: stats?.count ?? 0, splitSeconds: stats?.seconds ?? 0, bestPace: row.bestPace },
    }
    try {
      const detail = await adapter.getActivityDetail(row.sourceId, undefined, row.title)
      if (!detail.gpxData) throw new Error('Keep 详情里没有可解码的轨迹')

      const points = parseGPX(detail.gpxData).tracks[0]?.points ?? null
      const distance = row.distance ?? 0
      const duration = row.duration ?? 0
      const plan = planSplits(row.id, points, distance, duration, row.averagePace ?? 0)
      item.after = {
        mode: plan.mode,
        splits: plan.records.length,
        splitSeconds: plan.records.reduce((sum, r) => sum + (r.duration ?? 0), 0),
        bestPace: plan.bestPace ?? null,
      }

      if (!dryRun) {
        const routeCoordinates = extractRouteCoordinatesJSON(detail.gpxData)
        // 删旧分段、写新分段、更新活动放在一个事务里:中途失败不会留下「旧的删了新的没写」的半截状态。
        await db.transaction(async tx => {
          await tx.delete(splits).where(eq(splits.activityId, row.id))
          if (plan.records.length > 0) await tx.insert(splits).values(plan.records)
          await tx
            .update(activities)
            .set({ gpxData: detail.gpxData, routeCoordinates, bestPace: plan.bestPace ?? null, updatedAt: new Date() })
            .where(eq(activities.id, row.id))
        })
      }
      result.rebuilt++
    } catch (error) {
      item.error = (error as Error).message
      result.failed++
    }
    result.items.push(item)
  }
  return result
}
