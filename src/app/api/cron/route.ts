/**
 * Cron Manual Trigger API
 *
 * POST /api/cron
 * Body: { action: 'sync' | 'insights' | 'notify' }
 *
 * Manually triggers scheduled jobs for testing.
 */

import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { manualSync, manualInsights, manualNotify } from '@/lib/scheduler'
import { generateAnalyticsDigest, sendPushPlus } from '@/lib/notify'
import { cleanupOldData } from '@/lib/retention'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    await requireAuth()
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  let body: { action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action } = body
  if (!action || !['sync', 'insights', 'notify', 'analytics-digest', 'retention-cleanup'].includes(action)) {
    return NextResponse.json(
      { error: 'action must be one of: sync, insights, notify, analytics-digest, retention-cleanup' },
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
    case 'analytics-digest': {
      const digest = await generateAnalyticsDigest()
      // Read PushPlus token from settings
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
}
