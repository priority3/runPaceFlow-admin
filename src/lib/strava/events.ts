import { createHash } from 'node:crypto'

import { and, asc, eq, isNull, lte, or } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { stravaEvents } from '@/lib/db/activities-schema'
import { generatePrReviewsForActivities } from '@/lib/pr/review'
import { performSync } from '@/lib/sync/service'
import { generateId } from '@/lib/utils'

interface StravaWebhookPayload {
  aspect_type?: string
  event_time?: number
  object_id?: number | string
  object_type?: string
  owner_id?: number | string
  subscription_id?: number
  updates?: Record<string, unknown>
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(value)
}

function payloadHash(payload: unknown) {
  return createHash('sha256').update(stableSerialize(payload)).digest('hex')
}

export async function recordStravaEvent(payload: StravaWebhookPayload) {
  const hash = payloadHash(payload)
  const eventTime = payload.event_time ? new Date(Number(payload.event_time) * 1000) : new Date()
  const aspectType = String(payload.aspect_type ?? 'unknown')
  const objectType = String(payload.object_type ?? 'unknown')
  const objectId = String(payload.object_id ?? 'unknown')
  const ownerId = payload.owner_id == null ? null : String(payload.owner_id)
  const idempotencyKey = [ownerId ?? 'unknown', aspectType, objectType, objectId, Math.floor(eventTime.getTime() / 1000), hash].join(':')
  const db = await getActivitiesDb()
  const id = generateId('strava_evt')

  await db
    .insert(stravaEvents)
    .values({
      id,
      aspectType,
      objectType,
      objectId,
      ownerId,
      eventTime,
      payloadHash: hash,
      idempotencyKey,
      payloadJson: stableSerialize(payload),
      status: 'pending',
    })
    .onConflictDoNothing()

  return { id, idempotencyKey }
}

export async function drainStravaEvents(limit = 5) {
  const db = await getActivitiesDb()
  const now = new Date()
  const lockedBy = `drain_${process.pid}_${Date.now().toString(36)}`
  const lockedUntil = new Date(Date.now() + 60_000)
  const rows = await db
    .select()
    .from(stravaEvents)
    .where(
      and(
        eq(stravaEvents.status, 'pending'),
        or(isNull(stravaEvents.nextRetryAt), lte(stravaEvents.nextRetryAt, now)),
        or(isNull(stravaEvents.lockedUntil), lte(stravaEvents.lockedUntil, now)),
      ),
    )
    .orderBy(asc(stravaEvents.createdAt))
    .limit(limit)

  let processed = 0
  let synced = 0
  let skipped = 0
  let failed = 0

  for (const event of rows) {
    await db
      .update(stravaEvents)
      .set({ lockedBy, lockedUntil, attempts: event.attempts + 1 })
      .where(eq(stravaEvents.id, event.id))

    try {
      if (event.objectType === 'activity' && (event.aspectType === 'create' || event.aspectType === 'update')) {
        const sync = await performSync({ source: 'strava', limit: 20 })
        if (!sync.success) throw new Error(sync.errorMessage ?? 'Strava sync failed')
        const reviews = await generatePrReviewsForActivities(sync.activityIds)
        synced += sync.activitiesCount
        await db
          .update(stravaEvents)
          .set({
            status: 'processed',
            processedAt: new Date(),
            lockedBy: null,
            lockedUntil: null,
            lastError: null,
            errorCode: null,
            payloadJson: stableSerialize({
              event: JSON.parse(event.payloadJson),
              sync: {
                activitiesCount: sync.activitiesCount,
                activityIds: sync.activityIds,
                reviews,
              },
            }),
          })
          .where(eq(stravaEvents.id, event.id))
      } else {
        skipped++
        await db
          .update(stravaEvents)
          .set({
            status: 'ignored',
            processedAt: new Date(),
            lockedBy: null,
            lockedUntil: null,
          })
          .where(eq(stravaEvents.id, event.id))
      }
      processed++
    } catch (error) {
      failed++
      const errorMessage = error instanceof Error ? error.message : String(error)
      await db
        .update(stravaEvents)
        .set({
          status: 'pending',
          nextRetryAt: new Date(Date.now() + Math.min(event.attempts + 1, 6) * 60_000),
          lockedBy: null,
          lockedUntil: null,
          errorCode: 'strava_event_drain_failed',
          lastError: errorMessage,
        })
        .where(eq(stravaEvents.id, event.id))
    }
  }

  return { processed, synced, skipped, failed }
}
