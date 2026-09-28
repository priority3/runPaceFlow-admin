/**
 * Scheduler Service
 *
 * Manages cron jobs for activity sync, AI analysis, and PushPlus notifications.
 * Reads cron expressions from the database for configurable scheduling.
 */

import cron from 'node-cron'

import { generateInsightsForUncached } from './ai'
import { requestPrReviewBatch } from './pr-agent-client'
import { generateDailyReport, sendPushPlus } from './notify'
import { mirrorAdminDb } from './db-mirror'
import { cleanupOldData } from './retention'
import { getRuntimeSetting } from './runtime-config'
import { ensureDefaultJobs, listJobs, recordJobRun } from './scheduler-config'
import { drainStravaEvents } from './strava/events'
import { performSync } from './sync/service'

/**
 * 调度器状态挂在 globalThis 上,而不是模块级变量。
 *
 * Reason: Next.js 把 instrumentation.ts 与路由处理函数打进不同的 bundle,本模块会被实例化
 * 两次、各持一份模块级变量。09-28 把启动点挪到 instrumentation 之后,进程启动注册一套、
 * 随后第一次请求 /api/health 又注册一套 —— 每个定时任务每次跑两遍(两个同步并发写库);
 * reloadScheduler(面板改 cron 后由 /api/scheduler 调用)也只能停掉自己那份,另一份继续
 * 按旧 cron 触发。同一进程里 globalThis 只有一个,两份模块实例经它共享同一份状态。
 * node-cron 在 serverExternalPackages 里、由 require 缓存保证单例,任一实例创建的任务都能
 * 被另一实例 stop()。
 */
type SchedulerState = { started: boolean; tasks: cron.ScheduledTask[] }
const globalForScheduler = globalThis as typeof globalThis & { __rpfScheduler?: SchedulerState }
const state: SchedulerState = (globalForScheduler.__rpfScheduler ??= { started: false, tasks: [] })

// ─── Sync Activities ────────────────────────────────────────────────────────

async function syncActivities(): Promise<number> {
  let totalSynced = 0

  // Reason: admin 已接管同步,直接进程内调用 performSync(增量),不再 HTTP fetch 主站。
  // 默认同步源 = Keep(Apple Watch 跑步经苹果健康同步进 Keep;Strava 因政策收紧停用,
  // 其适配器/路由仍保留,可按需手动触发 /api/sync/strava)。
  try {
    const result = await performSync({ source: 'keep', limit: 50 })
    if (result.success && result.activitiesCount > 0) {
      totalSynced += result.activitiesCount
      const reviews = await requestPrReviewBatch(result.activityIds)
      console.log(`[Scheduler] Keep sync: ${result.activitiesCount} activities`)
      console.log(
        `[Scheduler] PR reviews: ${reviews.generated} generated, ${reviews.skipped} skipped, ${reviews.failed} failed, ${reviews.notified} notified`,
      )
      // 「有推送入队就立刻分发」已随复盘链路迁去 pr-agent 的 /api/pr/reviews/generate-batch,
      // 由它在生成后就地 dispatch,跑完几秒内到微信的体验不变。
    } else if (!result.success) {
      console.warn('[Scheduler] Keep sync failed:', result.errorMessage)
    }
  } catch (err) {
    console.warn('[Scheduler] Keep sync failed:', (err as Error).message)
  }

  return totalSynced
}

// ─── Job: Sync + Notify ─────────────────────────────────────────────────────

async function jobSyncAndNotify() {
  console.log('[Scheduler] Running sync job...')
  const startTime = Date.now()

  try {
    const syncedCount = await syncActivities()

    if (syncedCount > 0) {
      // Reason: 走运行时配置读取,UI 改 token 立即对调度推送生效
      const token = await getRuntimeSetting('PUSHPLUS_TOKEN')
      if (token) {
        try {
          await sendPushPlus(token, `🏃 同步完成 - 新增 ${syncedCount} 条活动`, `<p>已同步 ${syncedCount} 条新的运动记录到数据库。</p>`)
          console.log(`[Scheduler] PushPlus: synced notification sent`)
        } catch (err) {
          console.warn('[Scheduler] PushPlus notify failed:', (err as Error).message)
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun('sync', `success: ${syncedCount} activities in ${elapsed}s`)
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun('sync', `error: ${(err as Error).message} (${elapsed}s)`)
  }
}

// ─── Job: AI Analysis ───────────────────────────────────────────────────────

async function jobGenerateInsights() {
  console.log('[Scheduler] Running AI analysis job...')
  const startTime = Date.now()

  try {
    const count = await generateInsightsForUncached()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[Scheduler] Generated ${count} new insights`)
    await recordJobRun('insights', `success: ${count} insights in ${elapsed}s`)
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun('insights', `error: ${(err as Error).message} (${elapsed}s)`)
  }
}

async function jobStravaEventDrain() {
  console.log('[Scheduler] Running Strava webhook drain job...')
  const startTime = Date.now()

  try {
    const result = await drainStravaEvents(5)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun(
      'strava_event_drain',
      `success: ${result.processed} processed, ${result.synced} synced, ${result.failed} failed in ${elapsed}s`,
    )
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun('strava_event_drain', `error: ${(err as Error).message} (${elapsed}s)`)
  }
}

// ─── Job: Daily Report ──────────────────────────────────────────────────────

async function jobDailyReport() {
  console.log('[Scheduler] Running daily report job...')
  const startTime = Date.now()

  const token = await getRuntimeSetting('PUSHPLUS_TOKEN')
  if (!token) {
    console.warn('[Scheduler] PUSHPLUS_TOKEN not set, skipping daily report')
    await recordJobRun('daily_report', 'skipped: PUSHPLUS_TOKEN not set')
    return
  }

  try {
    const { title, content } = await generateDailyReport()
    const result = await sendPushPlus(token, title, content)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    if (result.success) {
      console.log('[Scheduler] Daily report sent via PushPlus')
      await recordJobRun('daily_report', `success in ${elapsed}s`)
    } else {
      console.warn('[Scheduler] PushPlus failed:', result.message)
      await recordJobRun('daily_report', `error: ${result.message} (${elapsed}s)`)
    }
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun('daily_report', `error: ${(err as Error).message} (${elapsed}s)`)
  }
}

async function jobRetentionCleanup() {
  console.log('[Scheduler] Running retention cleanup job...')
  const startTime = Date.now()

  try {
    const result = await cleanupOldData()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[Scheduler] Retention cleanup: deleted ${result.deleted} rows (retention: ${result.retentionDays} days)`)
    await recordJobRun('retention_cleanup', `success: ${result.deleted} rows deleted in ${elapsed}s`)
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun('retention_cleanup', `error: ${(err as Error).message} (${elapsed}s)`)
  }
}

// ─── Manual Triggers ────────────────────────────────────────────────────────

export async function manualSync(): Promise<{ success: boolean; message: string }> {
  try {
    const count = await syncActivities()
    await recordJobRun('sync', `manual: ${count} activities`)
    return { success: true, message: `Synced ${count} activities` }
  } catch (err) {
    return { success: false, message: (err as Error).message }
  }
}

export async function manualInsights(): Promise<{ success: boolean; message: string }> {
  try {
    const count = await generateInsightsForUncached()
    await recordJobRun('insights', `manual: ${count} insights`)
    return { success: true, message: `Generated ${count} insights` }
  } catch (err) {
    return { success: false, message: (err as Error).message }
  }
}

export async function manualNotify(): Promise<{ success: boolean; message: string }> {
  const token = await getRuntimeSetting('PUSHPLUS_TOKEN')
  if (!token) {
    return { success: false, message: 'PUSHPLUS_TOKEN not set' }
  }

  try {
    const { title, content } = await generateDailyReport()
    const result = await sendPushPlus(token, title, content)
    await recordJobRun('daily_report', `manual: ${result.success ? 'success' : result.message}`)
    return { success: result.success, message: result.message || 'Notification sent' }
  } catch (err) {
    return { success: false, message: (err as Error).message }
  }
}

export async function manualStravaEventDrain(): Promise<{ success: boolean; message: string }> {
  try {
    const result = await drainStravaEvents(10)
    await recordJobRun('strava_event_drain', `manual: ${result.processed} processed, ${result.failed} failed`)
    return {
      success: result.failed === 0,
      message: `Strava events: ${result.processed} processed, ${result.synced} synced, ${result.skipped} skipped, ${result.failed} failed`,
    }
  } catch (err) {
    return { success: false, message: (err as Error).message }
  }
}

async function jobAdminDbMirror() {
  const startTime = Date.now()
  try {
    const result = await mirrorAdminDb()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    if (result.ran) {
      await recordJobRun('admin_db_mirror', `success: ${result.tables} tables, ${result.rows} rows${result.backlog ? ' (backlog)' : ''} in ${elapsed}s`)
    } else {
      // Reason: ran:false 时原先什么都不记,而 last_run_at 是面板「上次执行」的唯一
      // 数据源 —— 于是这个任务每 30 分钟都在跑、只是跳过,面板却永久显示「从未执行」,
      // 看起来像 cron 没注册。与 daily_report 的 skipped 语义对齐。
      await recordJobRun('admin_db_mirror', 'skipped: 未配置 ADMIN_MIRROR_DATABASE_URL')
    }
  } catch (err) {
    await recordJobRun('admin_db_mirror', `error: ${(err as Error).message}`)
  }
}

// ─── Scheduler Init ─────────────────────────────────────────────────────────

const JOB_HANDLERS: Record<string, () => Promise<void>> = {
  sync: jobSyncAndNotify,
  strava_event_drain: jobStravaEventDrain,
  insights: jobGenerateInsights,
  daily_report: jobDailyReport,
  retention_cleanup: jobRetentionCleanup,
  admin_db_mirror: jobAdminDbMirror,
}

async function setupJobs() {
  // Stop existing tasks
  for (const task of state.tasks) {
    task.stop()
  }
  state.tasks = []

  // Load jobs from database
  const jobs = await listJobs()

  for (const job of jobs) {
    const handler = JOB_HANDLERS[job.id]
    if (!handler) continue

    if (!job.enabled) {
      console.log(`[Scheduler] Job "${job.name}" is disabled, skipping`)
      continue
    }

    if (!cron.validate(job.cronExpression)) {
      console.warn(`[Scheduler] Invalid cron expression for "${job.name}": ${job.cronExpression}`)
      continue
    }

    const task = cron.schedule(job.cronExpression, handler)
    state.tasks.push(task)
    console.log(`[Scheduler] Registered "${job.name}" with cron: ${job.cronExpression}`)
  }
}

export async function startScheduler() {
  if (state.started) return
  state.started = true

  await setupJobs()

  console.log('[Scheduler] Started - cron jobs loaded from database')
  console.log('[Scheduler] Use the admin UI to configure schedules')
}

/**
 * Reload scheduler with updated cron expressions.
 * Called after job configuration changes.
 */
export async function reloadScheduler() {
  await setupJobs()
  console.log('[Scheduler] Reloaded with updated schedules')
}
