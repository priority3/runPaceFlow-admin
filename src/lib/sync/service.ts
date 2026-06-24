import { desc, eq } from 'drizzle-orm'

import { getDb } from '@/lib/db/activities-client'
import { activities, syncLogs, userProfile } from '@/lib/db/activities-schema'
import { getRuntimeSettings } from '@/lib/runtime-config'
import { generateId } from '@/lib/utils'

import type { SyncAdapter } from './adapters/base'
import { NikeAdapter } from './adapters/nike'
import { StravaAdapter } from './adapters/strava'
import { syncActivities } from './processor'
import { cleanupRaceMatcher, initRaceMatcher } from './race-matcher'

/**
 * 同步服务
 * 负责协调数据源的同步流程
 */

export type SyncSource = 'nike' | 'strava' | 'garmin'

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
    nikeAccessToken?: string | null
    stravaAccessToken?: string | null
    garminSecretString?: string | null
  },
  settings: Record<string, string>,
): SyncAdapter {
  switch (source) {
    case 'nike': {
      const accessToken = profile.nikeAccessToken || settings.NIKE_ACCESS_TOKEN
      const refreshToken = settings.NIKE_REFRESH_TOKEN
      const token = refreshToken || accessToken
      if (!token) {
        throw new Error('No token found for nike')
      }
      return new NikeAdapter(token, refreshToken || undefined)
    }
    case 'strava': {
      const clientId = settings.STRAVA_CLIENT_ID
      const clientSecret = settings.STRAVA_CLIENT_SECRET
      const refreshToken = settings.STRAVA_REFRESH_TOKEN || profile.stravaAccessToken
      if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('No OAuth credentials found for strava')
      }
      return new StravaAdapter(clientId, clientSecret, refreshToken)
    }
    case 'garmin': {
      const accessToken = profile.garminSecretString || process.env.GARMIN_SECRET_STRING
      if (!accessToken) {
        throw new Error('No secret string found for garmin')
      }
      throw new Error('Garmin adapter not implemented yet')
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
    let after: number | undefined
    if (!fullSync && !startDate) {
      const latest = await db
        .select({ startTime: activities.startTime })
        .from(activities)
        .where(eq(activities.source, source))
        .orderBy(desc(activities.startTime))
        .limit(1)
      if (latest.length > 0 && latest[0].startTime) {
        // +1 秒避免把最新那条自己又拉回来
        after = Math.floor(latest[0].startTime.getTime() / 1000) + 1
        console.info(`[sync] 增量游标 after=${after} (${latest[0].startTime.toISOString()})`)
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

    return {
      success: true,
      activitiesCount: activityIds.length,
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

/**
 * 测试数据源连接
 * @param source 数据源
 * @returns 是否连接成功
 */
export async function testConnection(source: SyncSource): Promise<boolean> {
  try {
    const profile = await getUserProfile()
    const settings = await getRuntimeSettings({ force: true })
    const adapter = createAdapter(source, profile, settings)
    return await adapter.authenticate({})
  } catch (error) {
    console.error(`Connection test failed for ${source}:`, error)
    return false
  }
}
