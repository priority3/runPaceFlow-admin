/**
 * 活动镜像(双写):同步落库 shared.db 后,把 activities/splits 增量镜像到主站库(Turso)。
 *
 * 背景:admin 接管 Keep 同步后只写 shared.db,主站 Turso 里的活动自那时起停更
 * (主站一直展示旧数据)。本模块让主站复活,同时让 GPS/活动数据天然获得一份
 * 异地「活副本」——这是备份策略的一半:shared.db 其余数据(记忆/对话/健康等)
 * 走 B2 冷快照,体积最大且本就公开展示的活动数据靠本镜像常驻异地。
 *
 * 设计:
 * - shared.db 是唯一真相源,主站库是单向只读镜像(从不反向读回)
 * - 自愈式增量:每次跑取主站库 max(start_time) 作游标,把 shared.db 里更新的
 *   活动全部补齐——首次运行自动回填停更期间的整个缺口;漏跑一次下轮补上
 * - 失败不抛错:活动此刻已安全落在 shared.db,镜像失败不该把同步判失败
 *   (与 requestPrReviewBatch 同款容错哲学);只落日志,依赖下轮自愈
 * - 两边表结构同源同构(主站 schema 与本仓 activities-schema 逐列一致),
 *   写入显式列名,任何一边将来加列都不炸
 * - 主站库未配置(settings.DATABASE_URL 为空)时整体跳过——绝不回退到活动库
 *   连接链,否则会把 shared.db 镜像给自己
 */
import { asc, eq, gt } from 'drizzle-orm'

import { createClient, type Client, type InStatement } from '@libsql/client'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { activities, splits } from '@/lib/db/activities-schema'
import { getRuntimeSettings } from '@/lib/runtime-config'

export interface MirrorResult {
  /** false = 未配置主站库或上一轮还在跑,本轮什么都没做。 */
  ran: boolean
  mirrored: number
  remaining: number
  errorMessage?: string
}

/** 单轮镜像上限。GPX 单条可达 MB 级,首次回填分多轮吃完,避免一次占线太久。 */
const MIRROR_BATCH_LIMIT = 100

let mainSiteCache: { client: Client; signature: string } | undefined
let inFlight = false

/** 主站库连接(settings 导出的 DATABASE_URL,与 ai.ts 的 insights 同一读端)。未配置返回 null。 */
async function getMainSiteClient(): Promise<Client | null> {
  const settings = await getRuntimeSettings()
  const url = settings.DATABASE_URL
  if (!url) return null
  const authToken = settings.DATABASE_AUTH_TOKEN || undefined
  const signature = `${url}\n${authToken ?? ''}`
  if (!mainSiteCache || mainSiteCache.signature !== signature) {
    mainSiteCache = { client: createClient({ url, authToken }), signature }
  }
  return mainSiteCache.client
}

/** 主站库当前镜像游标:最新活动的 start_time(epoch 秒);空库为 0。 */
async function getMirrorCursor(mainSite: Client): Promise<number> {
  const result = await mainSite.execute('SELECT CAST(max(start_time) AS INTEGER) AS cursor FROM activities')
  const cursor = result.rows[0]?.cursor
  return typeof cursor === 'number' ? cursor : Number(cursor ?? 0) || 0
}

/** 一条活动 + 其分段 → 主站库 upsert 语句组(batch 内同事务,活动与分段要么都到要么都不到)。 */
function buildUpsertStatements(
  activity: typeof activities.$inferSelect,
  activitySplits: Array<typeof splits.$inferSelect>,
): InStatement[] {
  const epoch = (value: Date | null) => (value ? Math.floor(value.getTime() / 1000) : null)
  const statements: InStatement[] = [
    {
      sql: `INSERT INTO activities (
              id, title, type, source, source_id, start_time, end_time, duration,
              distance, average_pace, best_pace, elevation_gain, average_heart_rate,
              max_heart_rate, calories, gpx_data, route_coordinates, is_indoor,
              race_name, weather_data
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              title=excluded.title, type=excluded.type, source=excluded.source,
              source_id=excluded.source_id, start_time=excluded.start_time,
              end_time=excluded.end_time, duration=excluded.duration,
              distance=excluded.distance, average_pace=excluded.average_pace,
              best_pace=excluded.best_pace, elevation_gain=excluded.elevation_gain,
              average_heart_rate=excluded.average_heart_rate,
              max_heart_rate=excluded.max_heart_rate, calories=excluded.calories,
              gpx_data=excluded.gpx_data, route_coordinates=excluded.route_coordinates,
              is_indoor=excluded.is_indoor, race_name=excluded.race_name,
              weather_data=excluded.weather_data, updated_at=unixepoch()`,
      args: [
        activity.id,
        activity.title,
        activity.type,
        activity.source,
        activity.sourceId,
        epoch(activity.startTime),
        epoch(activity.endTime),
        activity.duration,
        activity.distance,
        activity.averagePace,
        activity.bestPace,
        activity.elevationGain,
        activity.averageHeartRate,
        activity.maxHeartRate,
        activity.calories,
        activity.gpxData,
        activity.routeCoordinates,
        activity.isIndoor ? 1 : 0,
        activity.raceName,
        activity.weatherData,
      ],
    },
    // 分段全量重写:splits 无独立更新语义,按活动整组替换最简单且幂等。
    { sql: 'DELETE FROM splits WHERE activity_id = ?', args: [activity.id] },
    ...activitySplits.map(split => ({
      sql: `INSERT INTO splits (id, activity_id, kilometer, duration, pace, distance, elevation_gain, average_heart_rate)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [
        split.id,
        split.activityId,
        split.kilometer,
        split.duration,
        split.pace,
        split.distance,
        split.elevationGain,
        split.averageHeartRate,
      ],
    })),
  ]
  return statements
}

/**
 * 把 shared.db 中比主站库更新的活动镜像过去。幂等,可随时重跑。
 * 调用方式:performSync 成功后 fire-and-forget;失败/剩余由下一轮同步自愈。
 */
export async function mirrorActivitiesToMainSite(): Promise<MirrorResult> {
  if (inFlight) return { ran: false, mirrored: 0, remaining: 0 }
  const mainSite = await getMainSiteClient()
  if (!mainSite) {
    console.info('[mirror] 主站库未配置(settings.DATABASE_URL 为空),跳过活动镜像')
    return { ran: false, mirrored: 0, remaining: 0 }
  }

  inFlight = true
  try {
    const cursor = await getMirrorCursor(mainSite)
    const db = await getActivitiesDb()
    const pending = await db
      .select()
      .from(activities)
      .where(gt(activities.startTime, new Date(cursor * 1000)))
      .orderBy(asc(activities.startTime))
      .limit(MIRROR_BATCH_LIMIT + 1)

    const overflow = pending.length > MIRROR_BATCH_LIMIT
    const batch = overflow ? pending.slice(0, MIRROR_BATCH_LIMIT) : pending
    let mirrored = 0
    for (const activity of batch) {
      const activitySplits = await db.select().from(splits).where(eq(splits.activityId, activity.id))
      // 逐活动一个事务:单条失败只损失这一条,游标停在它之前,下轮重试。
      await mainSite.batch(buildUpsertStatements(activity, activitySplits), 'write')
      mirrored++
    }

    const remaining = overflow ? 1 : 0 // 只表征「还有没有」;精确数不值得再查一次
    if (mirrored > 0 || remaining > 0) {
      console.info(`[mirror] 活动镜像 → 主站库:本轮 ${mirrored} 条${overflow ? ',仍有积压,下轮继续' : ''}`)
    }
    return { ran: true, mirrored, remaining }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.warn('[mirror] 活动镜像失败(不影响同步结果,下轮自愈):', errorMessage)
    return { ran: true, mirrored: 0, remaining: 0, errorMessage }
  } finally {
    inFlight = false
  }
}
