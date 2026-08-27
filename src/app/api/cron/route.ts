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
import { prAgentFetch } from '@/lib/pr-agent-client'
import { manualSync, manualInsights, manualNotify, manualStravaEventDrain } from '@/lib/scheduler'
import { generateAnalyticsDigest, sendPushPlus } from '@/lib/notify'
import { cleanupOldData } from '@/lib/retention'
import { getRuntimeSetting } from '@/lib/runtime-config'

export const dynamic = 'force-dynamic'

const VALID_ACTIONS = ['sync', 'insights', 'notify', 'notification-dispatch', 'weekly-review', 'daily-review', 'strava-event-drain', 'analytics-digest', 'retention-cleanup'] as const

/**
 * PR 域的手动触发转发给 pr-agent(那边是逻辑 owner,定时任务也归它)。
 * 把对方的 JSON 压成本接口既有的 { success, message } 形状,前端无需改。
 */
async function triggerOnPrAgent(path: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await prAgentFetch(path, { method: 'POST' })
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      return { success: false, message: String(payload.error ?? `pr-agent 返回 ${response.status}`) }
    }
    return { success: true, message: JSON.stringify(payload) }
  } catch (error) {
    return { success: false, message: `pr-agent 不可达:${(error as Error).message}` }
  }
}

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
    case 'notification-dispatch':
      result = await triggerOnPrAgent('/api/pr/notifications/dispatch')
      break
    case 'weekly-review':
      result = await triggerOnPrAgent('/api/pr/weekly-review')
      break
    case 'daily-review':
      result = await triggerOnPrAgent('/api/pr/daily-review')
      break
    case 'strava-event-drain':
      result = await manualStravaEventDrain()
      break
    case 'analytics-digest': {
      const digest = await generateAnalyticsDigest()
      // Reason: 裸 SQL 读 app_settings 拿不到解密后的敏感值,统一走运行时配置读取
      const pushToken = await getRuntimeSetting('PUSHPLUS_TOKEN')
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
