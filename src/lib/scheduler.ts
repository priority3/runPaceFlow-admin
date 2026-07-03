/**
 * Scheduler Service
 *
 * Manages cron jobs for activity sync, AI analysis, and PushPlus notifications.
 * Reads cron expressions from the database for configurable scheduling.
 */

import cron from 'node-cron'

import { generateInsightsForUncached } from './ai'
import { dispatchPendingNotifications } from './notifications/dispatcher'
import { generateDailyReport, sendPushPlus } from './notify'
import { generatePrReviewsForActivities } from './pr/review'
import { generateDailyReview } from './pr/daily'
import { generateWeeklyReview } from './pr/weekly'
import { cleanupOldData } from './retention'
import { ensureDefaultJobs, listJobs, recordJobRun } from './scheduler-config'
import { drainStravaEvents } from './strava/events'
import { performSync } from './sync/service'

let schedulerStarted = false
let scheduledTasks: cron.ScheduledTask[] = []

// ─── Sync Activities ────────────────────────────────────────────────────────

async function syncActivities(): Promise<number> {
  let totalSynced = 0

  // Reason: admin 已接管同步,直接进程内调用 performSync(增量),不再 HTTP fetch 主站。
  // Sync Strava
  try {
    const result = await performSync({ source: 'strava', limit: 50 })
    if (result.success && result.activitiesCount > 0) {
      totalSynced += result.activitiesCount
      const reviews = await generatePrReviewsForActivities(result.activityIds)
      console.log(`[Scheduler] Strava sync: ${result.activitiesCount} activities`)
      console.log(
        `[Scheduler] PR reviews: ${reviews.generated} generated, ${reviews.skipped} skipped, ${reviews.failed} failed`,
      )
    } else if (!result.success) {
      console.warn('[Scheduler] Strava sync failed:', result.errorMessage)
    }
  } catch (err) {
    console.warn('[Scheduler] Strava sync failed:', (err as Error).message)
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
      const token = process.env.PUSHPLUS_TOKEN
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

  const token = process.env.PUSHPLUS_TOKEN
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

async function jobNotificationDispatch() {
  console.log('[Scheduler] Running PR notification dispatch job...')
  const startTime = Date.now()

  try {
    const result = await dispatchPendingNotifications(10)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun(
      'notification_dispatch',
      `success: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped in ${elapsed}s`,
    )
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun('notification_dispatch', `error: ${(err as Error).message} (${elapsed}s)`)
  }
}

async function jobWeeklyReview() {
  console.log('[Scheduler] Running PR weekly review job...')
  const startTime = Date.now()

  try {
    const result = await generateWeeklyReview({ enqueueNotification: true })
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun(
      'weekly_review',
      `${result.generated ? 'generated' : 'skipped'}: ${result.subjectId} in ${elapsed}s`,
    )
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun('weekly_review', `error: ${(err as Error).message} (${elapsed}s)`)
  }
}

async function jobPrDailyReview() {
  console.log('[Scheduler] Running PR daily reflection job...')
  const startTime = Date.now()
  try {
    const result = await generateDailyReview({ enqueueNotification: true })
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun(
      'pr_daily_review',
      `${result.generated ? 'generated' : 'skipped'}: ${result.subjectId} in ${elapsed}s`,
    )
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    await recordJobRun('pr_daily_review', `error: ${(err as Error).message} (${elapsed}s)`)
  }
}

// ─── Job: Retention Cleanup ─────────────────────────────────────────────────

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
  const token = process.env.PUSHPLUS_TOKEN
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

export async function manualWeeklyReview(): Promise<{ success: boolean; message: string }> {
  try {
    const result = await generateWeeklyReview({ force: true, enqueueNotification: true })
    await recordJobRun('weekly_review', `manual: ${result.generated ? 'generated' : 'skipped'} ${result.subjectId}`)
    return {
      success: true,
      message: `Weekly review ${result.generated ? 'generated' : 'skipped'} for ${result.subjectId}`,
    }
  } catch (err) {
    return { success: false, message: (err as Error).message }
  }
}

export async function manualDailyReview(): Promise<{ success: boolean; message: string }> {
  try {
    const result = await generateDailyReview({ force: true, enqueueNotification: true })
    await recordJobRun('pr_daily_review', `manual: ${result.generated ? 'generated' : 'skipped'} ${result.subjectId}`)
    return {
      success: true,
      message: `Daily reflection ${result.generated ? 'generated' : 'skipped'} for ${result.subjectId} (${result.model ?? 'n/a'})`,
    }
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

// ─── Scheduler Init ─────────────────────────────────────────────────────────

const JOB_HANDLERS: Record<string, () => Promise<void>> = {
  sync: jobSyncAndNotify,
  strava_event_drain: jobStravaEventDrain,
  insights: jobGenerateInsights,
  notification_dispatch: jobNotificationDispatch,
  weekly_review: jobWeeklyReview,
  pr_daily_review: jobPrDailyReview,
  daily_report: jobDailyReport,
  retention_cleanup: jobRetentionCleanup,
}

async function setupJobs() {
  // Stop existing tasks
  for (const task of scheduledTasks) {
    task.stop()
  }
  scheduledTasks = []

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
    scheduledTasks.push(task)
    console.log(`[Scheduler] Registered "${job.name}" with cron: ${job.cronExpression}`)
  }
}

export async function startScheduler() {
  if (schedulerStarted) return
  schedulerStarted = true

  await ensureDefaultJobs()
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
