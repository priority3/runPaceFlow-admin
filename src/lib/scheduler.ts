/**
 * Scheduler Service
 *
 * Manages cron jobs for activity sync, AI analysis, and PushPlus notifications.
 * Reads cron expressions from the database for configurable scheduling.
 */

import cron from 'node-cron'

import { generateInsightsForUncached } from './ai'
import { generateDailyReport, sendPushPlus } from './notify'
import { cleanupOldData } from './retention'
import { ensureDefaultJobs, listJobs, recordJobRun } from './scheduler-config'
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
      console.log(`[Scheduler] Strava sync: ${result.activitiesCount} activities`)
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

// ─── Scheduler Init ─────────────────────────────────────────────────────────

const JOB_HANDLERS: Record<string, () => Promise<void>> = {
  sync: jobSyncAndNotify,
  insights: jobGenerateInsights,
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
