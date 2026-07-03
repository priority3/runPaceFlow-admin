/**
 * Cron Manual Trigger API
 *
 * POST /api/cron
 * Body: { action: 'sync' | 'insights' | 'notify' | 'notification-dispatch' | 'analytics-digest' | 'retention-cleanup' }
 *
 * Manually triggers scheduled jobs for testing.
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { dispatchPendingNotifications } from '@/lib/notifications/dispatcher'
import { manualSync, manualInsights, manualNotify, manualWeeklyReview, manualDailyReview, manualStravaEventDrain } from '@/lib/scheduler'
import { generateAnalyticsDigest, sendPushPlus } from '@/lib/notify'
import { cleanupOldData } from '@/lib/retention'

export const dynamic = 'force-dynamic'

const VALID_ACTIONS = ['sync', 'insights', 'notify', 'notification-dispatch', 'weekly-review', 'daily-review', 'strava-event-drain', 'analytics-digest', 'retention-cleanup'] as const

export const POST = withAuth(async (request) => {
  let body: { action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action } = body
  if (!action || !VALID_ACTIONS.includes(action as typeof VALID_ACTIONS[number])) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  let result: { success: boolean; message: string }

  switch (action) {
    case 'sync':
      result = await manualSync()
      break
    case 'insights':
      result = await manualInsights()
      break
    case 'notify':
      result = await manualNotify()
      break
    case 'notification-dispatch': {
      const dispatched = await dispatchPendingNotifications(10)
      result = {
        success: dispatched.failed === 0,
        message: `PR notifications: ${dispatched.sent} sent, ${dispatched.failed} failed, ${dispatched.skipped} skipped`,
      }
      break
    }
    case 'weekly-review':
      result = await manualWeeklyReview()
      break
    case 'daily-review':
      result = await manualDailyReview()
      break
    case 'strava-event-drain':
      result = await manualStravaEventDrain()
      break
    case 'analytics-digest': {
      const digest = await generateAnalyticsDigest()
      const { getDb } = await import('@/lib/db')
      const db = getDb()
      const tokenResult = await db.execute({
        sql: `SELECT value FROM app_settings WHERE key = 'PUSHPLUS_TOKEN'`,
        args: [],
      })
      const pushToken = tokenResult.rows[0]?.value as string
      if (!pushToken) {
        result = { success: false, message: 'PUSHPLUS_TOKEN not configured' }
        break
      }
      const sendResult = await sendPushPlus(pushToken, digest.title, digest.content)
      result = { success: sendResult.success, message: sendResult.success ? 'Analytics digest sent' : (sendResult.message || 'Failed to send') }
      break
    }
    case 'retention-cleanup': {
      const retention = await cleanupOldData()
      result = { success: true, message: `Cleaned ${retention.deleted} rows (retention: ${retention.retentionDays} days)` }
      break
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  return NextResponse.json(result)
})
