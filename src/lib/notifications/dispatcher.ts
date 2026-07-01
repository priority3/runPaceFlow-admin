import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { notificationDeliveries } from '@/lib/db/activities-schema'
import { getRuntimeSettings } from '@/lib/runtime-config'

import {
  sendWeChatTestAccountTemplate,
  type WeChatTestAccountConfig,
} from './wechat-test-account'

export interface NotificationDispatchResult {
  claimed: number
  sent: number
  failed: number
  skipped: number
}

const LOCK_TTL_MS = 2 * 60 * 1000
const MAX_ATTEMPTS = 3

function nextRetry(attempts: number) {
  const delayMinutes = Math.min(60, Math.max(1, attempts) * 5)
  return new Date(Date.now() + delayMinutes * 60 * 1000)
}

function buildConfig(settings: Record<string, string>): WeChatTestAccountConfig {
  return {
    appId: settings.WECHAT_TEST_ACCOUNT_APP_ID ?? '',
    appSecret: settings.WECHAT_TEST_ACCOUNT_APP_SECRET ?? '',
    templateId: settings.WECHAT_TEST_ACCOUNT_TEMPLATE_ID ?? '',
    openId: settings.WECHAT_TEST_ACCOUNT_OPEN_ID ?? '',
  }
}

async function claimPending(limit: number, workerId: string) {
  const db = await getActivitiesDb()
  const now = new Date()
  const rows = await db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        inArray(notificationDeliveries.status, ['pending', 'failed']),
        lte(notificationDeliveries.attempts, MAX_ATTEMPTS - 1),
        or(
          isNull(notificationDeliveries.lockedBy),
          lte(notificationDeliveries.lockedUntil, now),
        ),
        or(
          isNull(notificationDeliveries.nextRetryAt),
          lte(notificationDeliveries.nextRetryAt, now),
        ),
      ),
    )
    .orderBy(asc(notificationDeliveries.createdAt))
    .limit(limit)

  const lockedUntil = new Date(Date.now() + LOCK_TTL_MS)
  for (const row of rows) {
    await db
      .update(notificationDeliveries)
      .set({ lockedBy: workerId, lockedUntil, status: 'pending', updatedAt: new Date() })
      .where(eq(notificationDeliveries.id, row.id))
  }

  return rows
}

export async function dispatchPendingNotifications(limit = 10): Promise<NotificationDispatchResult> {
  const db = await getActivitiesDb()
  const workerId = `worker_${Date.now().toString(36)}`
  const rows = await claimPending(limit, workerId)
  const settings = await getRuntimeSettings({ force: true })
  const config = buildConfig(settings)
  const appUrl = settings.NEXT_PUBLIC_ADMIN_URL || settings.NEXT_PUBLIC_APP_URL

  const result: NotificationDispatchResult = {
    claimed: rows.length,
    sent: 0,
    failed: 0,
    skipped: 0,
  }

  for (const row of rows) {
    try {
      if (row.channel !== 'wechat_test_account') {
        result.skipped++
        await db
          .update(notificationDeliveries)
          .set({
            status: 'failed',
            attempts: row.attempts + 1,
            errorCode: 'unsupported_channel',
            lastError: `Unsupported channel: ${row.channel}`,
            lockedBy: null,
            lockedUntil: null,
            nextRetryAt: null,
            updatedAt: new Date(),
          })
          .where(eq(notificationDeliveries.id, row.id))
        continue
      }

      const sent = await sendWeChatTestAccountTemplate(config, {
        title: row.title,
        content: row.content,
        url: appUrl || undefined,
      })

      result.sent++
      await db
        .update(notificationDeliveries)
        .set({
          status: 'sent',
          attempts: row.attempts + 1,
          providerMessageId: sent.providerMessageId,
          lastError: null,
          errorCode: null,
          lockedBy: null,
          lockedUntil: null,
          nextRetryAt: null,
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(notificationDeliveries.id, row.id))
    } catch (error) {
      const attempts = row.attempts + 1
      result.failed++
      await db
        .update(notificationDeliveries)
        .set({
          status: 'failed',
          attempts,
          errorCode: 'send_failed',
          lastError: error instanceof Error ? error.message : String(error),
          lockedBy: null,
          lockedUntil: null,
          nextRetryAt: attempts >= MAX_ATTEMPTS ? null : nextRetry(attempts),
          updatedAt: new Date(),
        })
        .where(eq(notificationDeliveries.id, row.id))
    }
  }

  return result
}
