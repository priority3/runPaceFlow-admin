import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { notificationDeliveries } from '@/lib/db/activities-schema'
import { sendPushPlus } from '@/lib/notify'
import { getRuntimeSettings } from '@/lib/runtime-config'

/** 把 PR 文本内容 + H5 对话链接组装成 PushPlus 的 HTML 正文。 */
function buildPushPlusHtml(content: string, settings: Record<string, string>): string {
  // Reason: 硬编码域名是部署默认域,仅在 NEXT_PUBLIC_ADMIN_URL 未配置时作最后兜底。
  const base = (settings.NEXT_PUBLIC_ADMIN_URL || 'https://runpaceflow-admin.razet.me').replace(/\/$/, '')
  const token = settings.PR_CHAT_TOKEN
  const link = token ? `${base}/pr?t=${encodeURIComponent(token)}` : `${base}/pr`
  const body = content
    .replace(/\*\*/g, '')
    .replace(/[<>]/g, ch => (ch === '<' ? '&lt;' : '&gt;'))
    .replace(/\r?\n/g, '<br>')
  return `${body}<br><br><a href="${link}" style="display:inline-block;padding:8px 14px;background:#171717;color:#fff;border-radius:8px;text-decoration:none;">💬 打开 PR 对话</a>`
}

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

  const result: NotificationDispatchResult = {
    claimed: rows.length,
    sent: 0,
    failed: 0,
    skipped: 0,
  }

  for (const row of rows) {
    try {
      // PushPlus 渠道:PR 每日反思/复盘的默认推送方式(取代微信测试号)。正文带 H5 对话链接。
      if (row.channel === 'pushplus') {
        const pushToken = settings.PUSHPLUS_TOKEN
        if (!pushToken) {
          throw new Error('PUSHPLUS_TOKEN 未配置')
        }
        const r = await sendPushPlus(pushToken, row.title, buildPushPlusHtml(row.content, settings))
        if (!r.success) throw new Error(r.message || 'PushPlus 发送失败')
        result.sent++
        await db
          .update(notificationDeliveries)
          .set({
            status: 'sent',
            attempts: row.attempts + 1,
            lastError: null,
            errorCode: null,
            lockedBy: null,
            lockedUntil: null,
            nextRetryAt: null,
            sentAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(notificationDeliveries.id, row.id))
        continue
      }

      // 微信测试号渠道已退役,遗留的其他渠道行统一标记失败,避免死循环重投。
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
