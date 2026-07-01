import { desc, eq } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { healthDailyMetrics } from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'

export interface HealthDailyMetricInput {
  date: string
  sleepMinutes?: number | null
  deepSleepMinutes?: number | null
  remSleepMinutes?: number | null
  hrv?: number | null
  restingHr?: number | null
  source?: string
  payload?: unknown
}

export interface HealthDailyMetricContext {
  id: string
  date: string
  sleepMinutes: number | null
  deepSleepMinutes: number | null
  remSleepMinutes: number | null
  hrv: number | null
  restingHr: number | null
  source: string
  payload: unknown
  recoveryLabel: 'good' | 'okay' | 'poor' | 'unknown'
}

function recoveryLabel(input: {
  sleepMinutes: number | null
  hrv: number | null
  restingHr: number | null
}) {
  if (input.sleepMinutes == null && input.hrv == null && input.restingHr == null) return 'unknown'
  if ((input.sleepMinutes ?? 0) >= 420 && (input.hrv ?? 0) >= 60) return 'good'
  if ((input.sleepMinutes ?? 0) >= 360) return 'okay'
  return 'poor'
}

function toContext(row: typeof healthDailyMetrics.$inferSelect): HealthDailyMetricContext {
  const sleepMinutes = row.sleepMinutes == null ? null : Number(row.sleepMinutes)
  const hrv = row.hrv == null ? null : Number(row.hrv)
  const restingHr = row.restingHr == null ? null : Number(row.restingHr)
  return {
    id: row.id,
    date: row.date,
    sleepMinutes,
    deepSleepMinutes: row.deepSleepMinutes == null ? null : Number(row.deepSleepMinutes),
    remSleepMinutes: row.remSleepMinutes == null ? null : Number(row.remSleepMinutes),
    hrv,
    restingHr,
    source: row.source,
    payload: row.payloadJson ? JSON.parse(row.payloadJson) : null,
    recoveryLabel: recoveryLabel({ sleepMinutes, hrv, restingHr }),
  }
}

/**
 * Idempotently upserts one day's recovery metrics keyed by (date, source).
 * Returns the stored row so callers get the persisted id (which, on update,
 * is the original row's id — not a newly generated one).
 */
export async function upsertHealthDailyMetric(
  input: HealthDailyMetricInput,
): Promise<HealthDailyMetricContext> {
  const db = await getActivitiesDb()
  const id = generateId('health')
  const [row] = await db
    .insert(healthDailyMetrics)
    .values({
      id,
      date: input.date,
      sleepMinutes: input.sleepMinutes ?? null,
      deepSleepMinutes: input.deepSleepMinutes ?? null,
      remSleepMinutes: input.remSleepMinutes ?? null,
      hrv: input.hrv ?? null,
      restingHr: input.restingHr ?? null,
      source: input.source ?? 'healthkit',
      payloadJson: input.payload == null ? null : JSON.stringify(input.payload),
    })
    .onConflictDoUpdate({
      target: [healthDailyMetrics.date, healthDailyMetrics.source],
      set: {
        sleepMinutes: input.sleepMinutes ?? null,
        deepSleepMinutes: input.deepSleepMinutes ?? null,
        remSleepMinutes: input.remSleepMinutes ?? null,
        hrv: input.hrv ?? null,
        restingHr: input.restingHr ?? null,
        payloadJson: input.payload == null ? null : JSON.stringify(input.payload),
      },
    })
    .returning()
  return toContext(row)
}

export async function listHealthDailyMetrics(limit = 14) {
  const db = await getActivitiesDb()
  const rows = await db
    .select()
    .from(healthDailyMetrics)
    .orderBy(desc(healthDailyMetrics.date))
    .limit(limit)
  return rows.map(toContext)
}

export async function getLatestHealthDailyMetrics(limit = 7) {
  return listHealthDailyMetrics(limit)
}
