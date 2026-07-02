import { NextResponse } from 'next/server'

import { withAuth, withHealthImportAuth } from '@/lib/api-helpers'
import { getLatestHealthDailyMetrics, upsertHealthDailyMetric } from '@/lib/pr/health'
import { projectFriendProfile } from '@/lib/pr/memory'

export const dynamic = 'force-dynamic'

/** Coerces an optional numeric field, tolerating string inputs from Shortcuts JSON. */
function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

/** Validates a YYYY-MM-DD calendar date (the idempotency key alongside source). */
function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * Today's date as YYYY-MM-DD in Asia/Shanghai.
 * Reason: reporters (iOS Shortcuts) may fail to populate `date`; a morning sleep
 * report is for "today" in the user's timezone, so default to CST rather than 400.
 */
function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get('limit') ?? 14)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 30) : 14
  const metrics = await getLatestHealthDailyMetrics(limit)
  return NextResponse.json({ metrics })
})

// POST accepts either an admin session (dashboard) or a HEALTH_IMPORT_TOKEN Bearer
// token (external reporters such as iOS Shortcuts / HealthKit).
export const POST = withHealthImportAuth(async (request) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // date is optional: default to today (Asia/Shanghai) when the reporter omits it.
  const rawDate = typeof body.date === 'string' ? body.date.trim() : ''
  const date = rawDate || todayYmd()
  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'date must be a valid YYYY-MM-DD string' }, { status: 400 })
  }

  const metric = await upsertHealthDailyMetric({
    date,
    sleepMinutes: toNumberOrNull(body.sleepMinutes),
    deepSleepMinutes: toNumberOrNull(body.deepSleepMinutes),
    remSleepMinutes: toNumberOrNull(body.remSleepMinutes),
    hrv: toNumberOrNull(body.hrv),
    restingHr: toNumberOrNull(body.restingHr),
    steps: toNumberOrNull(body.steps),
    // Reason: 快捷指令示例里用的键名是 environmentalAudioDb,这里同时接受 envAudioDb 两种写法。
    envAudioDb: toNumberOrNull(body.envAudioDb ?? body.environmentalAudioDb),
    source: typeof body.source === 'string' && body.source.trim() ? body.source.trim() : undefined,
    payload: body.payload ?? null,
  })

  // Reason: profile projection is a downstream nicety; a failure here must not fail
  // the ingest, otherwise a reporter would retry and think the upload was lost.
  try {
    await projectFriendProfile()
  } catch (error) {
    console.warn('[health/daily] projectFriendProfile failed:', (error as Error).message)
  }

  return NextResponse.json({ metricId: metric.id, metric })
})
