/**
 * Analytics Service
 *
 * Core page view tracking. Query functions are in analytics-queries.ts.
 */

import { ensureSchema, getDb } from './db'
import type { DimensionStat } from './analytics-queries'

// ─── Re-export Query Functions ───────────────────────────────────────────────

export type {
  DimensionStat,
  PageFlow,
  SessionStats,
  HourlyStat,
  ExitPageStat,
  WeekComparison,
  AnomalyResult,
  PerformanceStats,
  ABTestResult,
} from './analytics-queries'

export {
  getBrowserStats,
  getOSStats,
  getDeviceStats,
  getCountryStats,
  getCityStats,
  getLanguageStats,
  getTimezoneStats,
  getRealtimeVisitors,
  getSessionStats,
  getHourlyStats,
  getExitPages,
  getWeekComparison,
  getPageFlows,
  detectTrafficAnomaly,
  getPerformanceStats,
  getABTestStats,
} from './analytics-queries'

// ─── Track Page View ─────────────────────────────────────────────────────────

export interface TrackPageViewInput {
  path: string
  referrer?: string
  userAgent?: string
  ip?: string
  visitorId?: string
  sessionId?: string
  browser?: string
  os?: string
  deviceType?: string
  country?: string | null
  city?: string | null
  region?: string | null
  language?: string
  timezone?: string
  loadTime?: number | null
  scrollDepth?: number | null
  abTests?: Record<string, string> | null
}

function hashIp(ip: string): string {
  let hash = 0
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return `h_${Math.abs(hash).toString(36)}`
}

export async function trackPageView(input: TrackPageViewInput): Promise<void> {
  await ensureSchema()
  const db = getDb()

  await db.execute({
    sql: `INSERT INTO page_views (path, referrer, user_agent, ip_hash, visitor_id, session_id, browser, os, device_type, country, city, region, language, timezone, load_time, scroll_depth, ab_tests, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    args: [
      input.path,
      input.referrer ?? null,
      input.userAgent ?? null,
      input.ip ? hashIp(input.ip) : null,
      input.visitorId ?? null,
      input.sessionId ?? null,
      input.browser ?? null,
      input.os ?? null,
      input.deviceType ?? null,
      input.country ?? null,
      input.city ?? null,
      input.region ?? null,
      input.language ?? null,
      input.timezone ?? null,
      input.loadTime ?? null,
      input.scrollDepth ?? null,
      input.abTests ? JSON.stringify(input.abTests) : null,
    ],
  })
}

// ─── Query Analytics (Overview & Top Pages) ──────────────────────────────────

export interface AnalyticsOverview {
  totalPageViews: number
  uniqueVisitors: number
  todayPageViews: number
  todayUniqueVisitors: number
  weeklyPageViews: number
  weeklyUniqueVisitors: number
}

export interface PageViewByPath {
  path: string
  views: number
  uniqueVisitors: number
}

export interface DailyPageViews {
  date: string
  views: number
  uniqueVisitors: number
}

export async function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  await ensureSchema()
  const db = getDb()

  const now = Math.floor(Date.now() / 1000)
  const todayStart = now - (now % 86400) - (8 * 3600)
  const weekAgo = todayStart - 7 * 86400

  const [totalResult, todayResult, weekResult] = await Promise.all([
    db.execute(`SELECT COUNT(*) as total, COUNT(DISTINCT visitor_id) as visitors FROM page_views`),
    db.execute({
      sql: `SELECT COUNT(*) as total, COUNT(DISTINCT visitor_id) as visitors FROM page_views WHERE created_at >= ?`,
      args: [todayStart],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as total, COUNT(DISTINCT visitor_id) as visitors FROM page_views WHERE created_at >= ?`,
      args: [weekAgo],
    }),
  ])

  return {
    totalPageViews: Number(totalResult.rows[0]?.total ?? 0),
    uniqueVisitors: Number(totalResult.rows[0]?.visitors ?? 0),
    todayPageViews: Number(todayResult.rows[0]?.total ?? 0),
    todayUniqueVisitors: Number(todayResult.rows[0]?.visitors ?? 0),
    weeklyPageViews: Number(weekResult.rows[0]?.total ?? 0),
    weeklyUniqueVisitors: Number(weekResult.rows[0]?.visitors ?? 0),
  }
}

export async function getTopPages(limit = 20): Promise<PageViewByPath[]> {
  await ensureSchema()
  const db = getDb()

  const result = await db.execute({
    sql: `SELECT path, COUNT(*) as views, COUNT(DISTINCT visitor_id) as unique_visitors
          FROM page_views
          GROUP BY path
          ORDER BY views DESC
          LIMIT ?`,
    args: [limit],
  })

  return result.rows.map((row) => ({
    path: row.path as string,
    views: Number(row.views),
    uniqueVisitors: Number(row.unique_visitors),
  }))
}

export async function getDailyPageViews(days = 14): Promise<DailyPageViews[]> {
  await ensureSchema()
  const db = getDb()

  const now = Math.floor(Date.now() / 1000)
  const startDay = now - (now % 86400) - (8 * 3600)
  const start = startDay - (days - 1) * 86400

  const result = await db.execute({
    sql: `SELECT
            date(created_at, 'unixepoch', '+8 hours') as day,
            COUNT(*) as views,
            COUNT(DISTINCT visitor_id) as unique_visitors
          FROM page_views
          WHERE created_at >= ?
          GROUP BY day
          ORDER BY day ASC`,
    args: [start],
  })

  return result.rows.map((row) => ({
    date: row.day as string,
    views: Number(row.views),
    uniqueVisitors: Number(row.unique_visitors),
  }))
}

export async function getReferrerStats(limit = 10): Promise<Array<{ referrer: string; views: number }>> {
  await ensureSchema()
  const db = getDb()

  const result = await db.execute({
    sql: `SELECT COALESCE(referrer, 'direct') as referrer, COUNT(*) as views
          FROM page_views
          GROUP BY referrer
          ORDER BY views DESC
          LIMIT ?`,
    args: [limit],
  })

  return result.rows.map((row) => ({
    referrer: row.referrer as string,
    views: Number(row.views),
  }))
}

export async function getReferrerDomainStats(limit = 10): Promise<DimensionStat[]> {
  await ensureSchema()
  const db = getDb()

  const result = await db.execute({
    sql: `SELECT
            CASE
              WHEN referrer LIKE 'http://%' THEN
                CASE
                  WHEN instr(substr(referrer, 8), '/') > 0
                  THEN substr(referrer, 8, instr(substr(referrer, 8), '/') - 1)
                  ELSE substr(referrer, 8)
                END
              WHEN referrer LIKE 'https://%' THEN
                CASE
                  WHEN instr(substr(referrer, 9), '/') > 0
                  THEN substr(referrer, 9, instr(substr(referrer, 9), '/') - 1)
                  ELSE substr(referrer, 9)
                END
              ELSE 'direct'
            END as domain,
            COUNT(*) as views,
            COUNT(DISTINCT visitor_id) as unique_visitors
          FROM page_views
          WHERE referrer IS NOT NULL
          GROUP BY domain
          ORDER BY views DESC
          LIMIT ?`,
    args: [limit],
  })

  return result.rows.map(r => ({
    name: r.domain as string,
    views: Number(r.views),
    uniqueVisitors: Number(r.unique_visitors),
  }))
}
