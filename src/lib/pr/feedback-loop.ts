import { getActivitiesDb } from '@/lib/db/activities-client'
import { prFeedbackEvents, prMetricEvents } from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'

export type PrFeedbackEventType =
  | 'thumbs_up'
  | 'thumbs_down'
  | 'correction'
  | 'regenerate'
  | 'memory_confirm'
  | 'memory_archive'
  | 'notification_open'
  | 'notification_ignore'

export async function recordPrFeedbackEvent(input: {
  targetType: string
  targetId: string
  eventType: PrFeedbackEventType
  value?: string | null
  note?: string | null
  metadata?: Record<string, unknown> | null
}) {
  const db = await getActivitiesDb()
  const id = generateId('pfe')
  await db.insert(prFeedbackEvents).values({
    id,
    targetType: input.targetType,
    targetId: input.targetId,
    eventType: input.eventType,
    value: input.value ?? null,
    note: input.note ?? null,
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
  })
  return id
}

export async function recordPrMetricEvent(input: {
  runId?: string | null
  metricName: string
  metricValue: number
  dimensions?: Record<string, unknown> | null
}) {
  const db = await getActivitiesDb()
  const id = generateId('pme')
  await db.insert(prMetricEvents).values({
    id,
    runId: input.runId ?? null,
    metricName: input.metricName,
    metricValue: input.metricValue,
    dimensionsJson: input.dimensions ? JSON.stringify(input.dimensions) : null,
  })
  return id
}
