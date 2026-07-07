import { NextResponse } from 'next/server'

import { withAuth, withHealthImportAuth } from '@/lib/api-helpers'
import { generateDailyReview } from '@/lib/pr/daily'
import { deriveSleep } from '@/lib/pr/health-derive'
import { getLatestHealthDailyMetrics, upsertHealthDailyMetric } from '@/lib/pr/health'
import { projectFriendProfile } from '@/lib/pr/memory'

export const dynamic = 'force-dynamic'

/**
 * Parse a newline-delimited segments blob (`stage|startISO|endISO` per line) into
 * segment objects. Reason: iOS Shortcuts builds a text blob far more reliably than a
 * nested JSON array, so the collector uploads text and the server structures it.
 */
function parseSegmentsText(
  text: string,
): Array<{ stage: string; start: string; end: string; minutes?: number }> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [stage = '', start = '', end = '', durRaw = ''] = line.split('|')
      const durSec = Number(durRaw)
      // Duration (seconds) is the reliable fallback when timestamps don't render.
      const minutes = Number.isFinite(durSec) && durSec > 0 ? durSec / 60 : undefined
      return { stage: stage.trim(), start: start.trim(), end: end.trim(), minutes }
    })
    .filter((s) => s.stage && (s.minutes != null || (s.start && s.end)))
}

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

  // Two ingest shapes, both supported:
  // 1) Rich (new shortcut): raw sleepSegments/napSegments — server derives aggregates.
  // 2) Direct (legacy): sleepMinutes/deepSleepMinutes/... already computed by the caller.
  const sleepSegments = Array.isArray(body.sleepSegments)
    ? body.sleepSegments
    : typeof body.sleepSegmentsText === 'string'
      ? parseSegmentsText(body.sleepSegmentsText)
      : null
  const hasSegments = Array.isArray(sleepSegments)
  const derived = hasSegments ? deriveSleep(sleepSegments, body.napSegments) : null

  // 睡眠新鲜度:醒来时间应是「今晨」。若醒来距今 > 20 小时,这就不是昨晚的觉——
  // 多半是手表没戴、没有新睡眠,快捷指令把上一晚的旧数据又报了一遍(HealthKit 返回最近可用样本)。
  // 此时不把旧睡眠当今晚:睡眠摘要置空(恢复标签会变 unknown),让 PR 明说"没读到昨晚睡眠",
  // 而不是复述前一天的数字。原始 segments 仍保留在 payload 里供追溯。
  const SLEEP_STALE_MS = 20 * 60 * 60 * 1000
  const wakeMs = derived?.wakeTime ? new Date(derived.wakeTime).getTime() : null
  const sleepStale = wakeMs != null && Number.isFinite(wakeMs) && Date.now() - wakeMs > SLEEP_STALE_MS

  const audioAvgDb = toNumberOrNull(body.audioAvgDb ?? body.envAudioDb ?? body.environmentalAudioDb)
  const audioMaxDb = toNumberOrNull(body.audioMaxDb)

  // Raw facts + server-derived extras are preserved in payload for the PR agent to
  // converse over (bedtime, wake, awakenings, per-segment timeline, naps, audio peak).
  const payload = hasSegments
    ? {
        sleepSegments,
        napSegments: Array.isArray(body.napSegments) ? body.napSegments : [],
        audio: { avgDb: audioAvgDb, maxDb: audioMaxDb },
        derived: derived
          ? {
              napMinutes: derived.napMinutes,
              coreMinutes: derived.coreMinutes,
              inBedMinutes: derived.inBedMinutes,
              awakeMinutes: derived.awakeMinutes,
              awakenings: derived.awakenings,
              bedtime: derived.bedtime,
              wakeTime: derived.wakeTime,
              stale: sleepStale,
            }
          : undefined,
      }
    : (body.payload ?? null)

  const metric = await upsertHealthDailyMetric({
    date,
    // Reason: 睡眠数据过期(见上)→ 摘要置空,不把旧数据当昨晚。
    sleepMinutes: sleepStale ? null : derived ? derived.sleepMinutes : toNumberOrNull(body.sleepMinutes),
    deepSleepMinutes: sleepStale ? null : derived ? derived.deepSleepMinutes : toNumberOrNull(body.deepSleepMinutes),
    remSleepMinutes: sleepStale ? null : derived ? derived.remSleepMinutes : toNumberOrNull(body.remSleepMinutes),
    hrv: toNumberOrNull(body.hrv),
    restingHr: toNumberOrNull(body.restingHr),
    steps: toNumberOrNull(body.steps),
    envAudioDb: audioAvgDb,
    source: typeof body.source === 'string' && body.source.trim() ? body.source.trim() : undefined,
    payload,
  })

  // Reason: profile projection is a downstream nicety; a failure here must not fail
  // the ingest, otherwise a reporter would retry and think the upload was lost.
  try {
    await projectFriendProfile()
  } catch (error) {
    console.warn('[health/daily] projectFriendProfile failed:', (error as Error).message)
  }

  // Reason: fire the daily reflection the moment fresh health data lands, bound to
  // that record's date. This is event-driven instead of a fixed cron clock, so PR
  // reflects on the day just uploaded whenever the user actually wakes — never before
  // the morning's data exists. Non-blocking: the reporter isn't held on the AI call,
  // and the notification-dispatch job (every 10 min) delivers the result.
  void generateDailyReview({ date }).catch((error) =>
    console.warn('[health/daily] daily reflection failed:', (error as Error).message),
  )

  return NextResponse.json({ metricId: metric.id, metric })
})
