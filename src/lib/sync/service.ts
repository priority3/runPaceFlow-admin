import { desc, eq } from 'drizzle-orm'

import { getDb } from '@/lib/db/activities-client'
import { activities, syncLogs, userProfile } from '@/lib/db/activities-schema'
import { getRuntimeSettings } from '@/lib/runtime-config'
import { generateId } from '@/lib/utils'

import type { SyncAdapter } from './adapters/base'
import { KeepAdapter } from './adapters/keep'
import { mirrorActivitiesToMainSite } from './mirror'
import { StravaAdapter } from './adapters/strava'
import { syncActivities } from './processor'
import { cleanupRaceMatcher, initRaceMatcher } from './race-matcher'

/**
 * 同步服务
 * 负责协调数据源的同步流程
 */

// Reason: nike 适配器与 garmin stub 已删(前者零调用且库内无 nike 行,后者只 throw not-implemented);
// 与 pr-agent 的 ingest/service.ts 保持一致的两值集合。
export type SyncSource = 'strava' | 'keep'

/**
 * 同步选项
 */
export interface SyncOptions {
  /** 数据源 */
  source: SyncSource
  /** 开始日期 */
  startDate?: Date
  /** 结束日期 */
  endDate?: Date
  /** 限制数量 */
  limit?: number
  /** 全量同步:忽略增量游标,从头拉 limit 条(默认 false = 增量) */
  fullSync?: boolean
}

/**
 * 同步结果
 */
export interface SyncResult {
  /** 是否成功 */
  success: boolean
  /** 同步的活动数量 */
  activitiesCount: number
  /** 本轮同步涉及的活动 ID */
  activityIds: string[]
  /** 错误信息 */
  errorMessage?: string
  /** 同步日志 ID */
  logId: string
}

/**
 * 创建适配器实例
 * @param source 数据源
 * @param profile 用户配置
 * @returns 适配器实例
 */
function createAdapter(
  source: SyncSource,
  profile: {
    stravaAccessToken?: string | null
  },
  settings: Record<string, string>,
): SyncAdapter {
  switch (source) {
    case 'strava': {
      const clientId = settings.STRAVA_CLIENT_ID
      const clientSecret = settings.STRAVA_CLIENT_SECRET
      const refreshToken = settings.STRAVA_REFRESH_TOKEN || profile.stravaAccessToken
      if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('No OAuth credentials found for strava')
      }
      return new StravaAdapter(clientId, clientSecret, refreshToken)
    }
    case 'keep': {
      const mobile = settings.KEEP_MOBILE
      const password = settings.KEEP_PASSWORD
      if (!mobile || !password) {
        throw new Error('No credentials found for keep (需在设置里填 KEEP_MOBILE / KEEP_PASSWORD)')
      }
      return new KeepAdapter(mobile, password)
    }
    default: {
      throw new Error(`Unknown sync source: ${source}`)
    }
  }
}

/**
 * 执行数据同步
 * @param options 同步选项
 * @returns 同步结果
 */
export async function performSync(options: SyncOptions): Promise<SyncResult> {
  const { source, startDate, endDate, limit, fullSync } = options
  const db = await getDb()
  const settings = await getRuntimeSettings({ force: true })

  // 创建同步日志
  const logId = generateId('log')
  const startedAt = new Date()

  await db.insert(syncLogs).values({
    id: logId,
    source,
    status: 'running',
    startedAt,
  })

  try {
    // 初始化赛事匹配器（启动 Playwright 浏览器）
    await initRaceMatcher()

    // 获取用户配置
    const profile = await getUserProfile()

    // 创建适配器
    const adapter = createAdapter(source, profile, settings)

    // 健康检查
    const isHealthy = await adapter.healthCheck()
    if (!isHealthy) {
      throw new Error(`${source} service is not available`)
    }

    // Reason: 真增量同步 —— 查库内该 source 最新活动的 startTime 作为 after 游标,
    // 只拉游标之后的新活动。库空(首次)或 fullSync 时不传游标,退化为全量拉 limit 条。
    //
    // 游标按 (source, type) 分别算:一个源可能同时供多种运动(Keep 既有跑步又有骑行),
    // 它们各自的最新时间不同。若只用 source 级的单一 max(startTime),较新的那类会把游标
    // 推过较旧那类尚未入库的活动 —— 例如 keep 名下跑步停在 04-22、骑行有 09-01,
    // 单一游标会变成 09-01,从此 04-22 之后的跑步永远拉不回来。afterByType 解决这个;
    // after 仍保留,供尚未支持分类型游标的适配器(Strava)使用。
    let after: number | undefined
    let afterByType: Record<string, number> | undefined
    if (!fullSync && !startDate) {
      const latestPerType = await db
        .select({ type: activities.type, startTime: activities.startTime })
        .from(activities)
        .where(eq(activities.source, source))
        .orderBy(desc(activities.startTime))

      const seen = new Map<string, number>()
      for (const row of latestPerType) {
        if (!row.startTime || !row.type) continue
        // 已按 startTime 降序,每个 type 首次出现即为其最新
        if (!seen.has(row.type)) seen.set(row.type, Math.floor(row.startTime.getTime() / 1000) + 1)
      }

      if (seen.size > 0) {
        afterByType = Object.fromEntries(seen)
        // +1 秒避免把最新那条自己又拉回来(seen 里已含 +1)
        after = Math.min(...seen.values())
        const desc0 = [...seen.entries()]
          .map(([t, v]) => `${t}=${new Date(v * 1000).toISOString()}`)
          .join(' ')
        console.info(`[sync] 增量游标 ${desc0}`)
      } else {
        console.info(`[sync] 库内无 ${source} 活动,执行首次全量同步`)
      }
    }

    // 获取活动列表（传入 after 游标 + 拉详情前去重回调,最大化省请求）
    console.info(`Fetching activities from ${source}...`)
    const rawActivities = await adapter.getActivities({
      startDate,
      endDate,
      limit,
      after,
      afterByType,
      // 拉详情前按 sourceId 查重:库里已有就跳过,避免浪费详情/streams 请求
      shouldFetchDetail: async (sourceId: string) => {
        const existing = await db
          .select({ id: activities.id })
          .from(activities)
          .where(eq(activities.sourceId, sourceId))
          .limit(1)
        return existing.length === 0
      },
    })

    console.info(`Found ${rawActivities.length} activities from ${source}`)

    // 同步活动到数据库
    const activityIds = await syncActivities(rawActivities)

    // 更新同步日志
    await db
      .update(syncLogs)
      .set({
        status: 'success',
        activitiesCount: activityIds.length,
        completedAt: new Date(),
      })
      .where(eq(syncLogs.id, logId))

    // 更新用户的最后同步时间
    await updateLastSyncTime(source)

    // 清理赛事匹配器资源
    await cleanupRaceMatcher()

    // 活动镜像到主站库(fire-and-forget):shared.db 已落库,镜像慢/挂都不该拖累
    // 同步结果;新活动为 0 也要跑——自愈式游标会顺手补齐历史缺口。见 mirror.ts。
    void mirrorActivitiesToMainSite().catch(error =>
      console.warn('[sync] 活动镜像调度失败:', (error as Error).message),
    )

    return {
      success: true,
      activitiesCount: activityIds.length,
      activityIds,
      logId,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Sync failed for ${source}:`, errorMessage)

    // 清理赛事匹配器资源（即使失败也要清理）
    await cleanupRaceMatcher()

    // 更新同步日志为失败状态
    await db
      .update(syncLogs)
      .set({
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(syncLogs.id, logId))

    return {
      success: false,
      activitiesCount: 0,
      activityIds: [],
      errorMessage,
      logId,
    }
  }
}

/**
 * 获取用户配置
 */
async function getUserProfile() {
  const db = await getDb()
  const profiles = await db.select().from(userProfile).limit(1)

  if (profiles.length === 0) {
    // 创建默认用户配置
    const defaultProfileData = {
      id: generateId('user'),
      name: 'Runner',
    }
    await db.insert(userProfile).values(defaultProfileData)

    // 重新获取完整的配置数据
    const newProfiles = await db.select().from(userProfile).limit(1)
    return newProfiles[0]
  }

  return profiles[0]
}

/**
 * 更新最后同步时间
 */
async function updateLastSyncTime(source: SyncSource): Promise<void> {
  const db = await getDb()
  const profiles = await db.select().from(userProfile).limit(1)

  if (profiles.length > 0) {
    await db
      .update(userProfile)
      .set({
        lastSyncAt: new Date(),
        syncSource: source,
      })
      .where(eq(userProfile.id, profiles[0].id))
  }
}

/**
 * 获取同步历史
 * @param limit 限制数量
 * @returns 同步日志列表
 */
export async function getSyncHistory(limit = 10) {
  const db = await getDb()
  return await db.select().from(syncLogs).orderBy(syncLogs.startedAt).limit(limit)
}
