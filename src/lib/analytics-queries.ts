/**
 * Analytics Query Functions
 *
 * Aggregated query functions for analytics dashboard.
 * Separated from core tracking for modularity.
 */

import { ensureSchema, getDb } from './db'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DimensionStat {
  name: string
  views: number
  uniqueVisitors: number
}

export interface PageFlow {
  from: string
  to: string
  count: number
}

export interface SessionStats {
  totalSessions: number
  avgPagesPerSession: number
  avgSessionDurationSec: number
  bounceRate: number
}

export interface HourlyStat {
  hour: number
  views: number
  uniqueVisitors: number
}

export interface ExitPageStat {
  path: string
  exits: number
  exitRate: number
}

export interface WeekComparison {
  thisWeek: { views: number; uniqueVisitors: number; sessions: number }
  lastWeek: { views: number; uniqueVisitors: number; sessions: number }
}

export interface AnomalyResult {
  todayViews: number
  avgViews: number
  deviation: number
  status: 'normal' | 'spike' | 'drop' | 'no_data'
  message: string
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function todayStart(): number {
  const now = Math.floor(Date.now() / 1000)
  return now - (now % 86400) - (8 * 3600) // UTC+8
}

// ─── Dimension Queries ───────────────────────────────────────────────────────

function dimQuery(field: string, limit?: number) {
  return {
    sql: `SELECT COALESCE(${field}, 'Unknown') as name, COUNT(*) as views, COUNT(DISTINCT visitor_id) as unique_visitors
          FROM page_views WHERE ${field} IS NOT NULL
          GROUP BY name ORDER BY views DESC ${limit ? 'LIMIT ?' : ''}`,
    args: limit ? [limit] : [],
  }
}

export async function getBrowserStats(limit = 10): Promise<DimensionStat[]> {
  await ensureSchema()
  const db = getDb()
  const result = await db.execute(dimQuery('browser', limit))
  return result.rows.map(r => ({ name: r.name as string, views: Number(r.views), uniqueVisitors: Number(r.unique_visitors) }))
}

export async function getOSStats(limit = 10): Promise<DimensionStat[]> {
  await ensureSchema()
  const db = getDb()
  const result = await db.execute(dimQuery('os', limit))
  return result.rows.map(r => ({ name: r.name as string, views: Number(r.views), uniqueVisitors: Number(r.unique_visitors) }))
}

export async function getDeviceStats(): Promise<DimensionStat[]> {
  await ensureSchema()
  const db = getDb()
  const result = await db.execute(dimQuery('device_type'))
  return result.rows.map(r => ({ name: r.name as string, views: Number(r.views), uniqueVisitors: Number(r.unique_visitors) }))
}

export async function getCountryStats(limit = 15): Promise<DimensionStat[]> {
  await ensureSchema()
  const db = getDb()
  const result = await db.execute(dimQuery('country', limit))
  return result.rows.map(r => ({ name: r.name as string, views: Number(r.views), uniqueVisitors: Number(r.unique_visitors) }))
}

export async function getCityStats(limit = 15): Promise<DimensionStat[]> {
  await ensureSchema()
  const db = getDb()
  const result = await db.execute(dimQuery('city', limit))
  return result.rows.map(r => ({ name: r.name as string, views: Number(r.views), uniqueVisitors: Number(r.unique_visitors) }))
}

export async function getLanguageStats(limit = 10): Promise<DimensionStat[]> {
  await ensureSchema()
  const db = getDb()
  const result = await db.execute(dimQuery('language', limit))
  return result.rows.map(r => ({ name: r.name as string, views: Number(r.views), uniqueVisitors: Number(r.unique_visitors) }))
}

export async function getTimezoneStats(limit = 10): Promise<DimensionStat[]> {
  await ensureSchema()
  const db = getDb()
  const result = await db.execute(dimQuery('timezone', limit))
  return result.rows.map(r => ({ name: r.name as string, views: Number(r.views), uniqueVisitors: Number(r.unique_visitors) }))
}

// ─── Realtime ────────────────────────────────────────────────────────────────

export async function getRealtimeVisitors(minutes = 5): Promise<{ count: number; paths: string[] }> {
  await ensureSchema()
  const db = getDb()
  const since = Math.floor(Date.now() / 1000) - minutes * 60
  const result = await db.execute({
    sql: `SELECT COUNT(DISTINCT visitor_id) as count, GROUP_CONCAT(DISTINCT path) as paths
          FROM page_views WHERE created_at >= ?`,
    args: [since],
  })
  return {
    count: Number(result.rows[0]?.count ?? 0),
    paths: (result.rows[0]?.paths as string)?.split(',') ?? [],
  }
}

// ─── Session Stats ───────────────────────────────────────────────────────────

export async function getSessionStats(days = 7): Promise<SessionStats> {
  await ensureSchema()
  const db = getDb()
  const start = todayStart() - (days - 1) * 86400

  const result = await db.execute({
    sql: `SELECT
            COUNT(*) as total_sessions,
            AVG(page_count) as avg_pages,
            AVG(duration_sec) as avg_duration,
            AVG(CASE WHEN page_count = 1 THEN 1.0 ELSE 0.0 END) * 100 as bounce_rate
          FROM (
            SELECT
              COALESCE(session_id, visitor_id, CAST(id AS TEXT)) as sid,
              COUNT(*) as page_count,
              (MAX(created_at) - MIN(created_at)) as duration_sec
            FROM page_views
            WHERE created_at >= ?
            GROUP BY sid
          )`,
    args: [start],
  })

  const row = result.rows[0]
  return {
    totalSessions: Number(row?.total_sessions ?? 0),
    avgPagesPerSession: Number(row?.avg_pages ?? 0),
    avgSessionDurationSec: Number(row?.avg_duration ?? 0),
    bounceRate: Number(row?.bounce_rate ?? 0),
  }
}

// ─── Hourly Heat Map ─────────────────────────────────────────────────────────

export async function getHourlyStats(days = 7): Promise<HourlyStat[]> {
  await ensureSchema()
  const db = getDb()
  const start = todayStart() - (days - 1) * 86400

  const result = await db.execute({
    sql: `SELECT
            CAST(strftime('%H', created_at, 'unixepoch', '+8 hours') AS INTEGER) as hour,
            COUNT(*) as views,
            COUNT(DISTINCT visitor_id) as unique_visitors
          FROM page_views
          WHERE created_at >= ?
          GROUP BY hour
          ORDER BY hour`,
    args: [start],
  })

  const map = new Map(result.rows.map(r => [Number(r.hour), { hour: Number(r.hour), views: Number(r.views), uniqueVisitors: Number(r.unique_visitors) }]))
  return Array.from({ length: 24 }, (_, i) => map.get(i) ?? { hour: i, views: 0, uniqueVisitors: 0 })
}

// ─── Exit Pages ──────────────────────────────────────────────────────────────

export async function getExitPages(limit = 10): Promise<ExitPageStat[]> {
  await ensureSchema()
  const db = getDb()

  const result = await db.execute({
    sql: `SELECT path, COUNT(*) as exits,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM page_views), 1) as exit_rate
          FROM (
            SELECT path, visitor_id, session_id,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(session_id, visitor_id)
                ORDER BY created_at DESC
              ) as rn
            FROM page_views
          )
          WHERE rn = 1
          GROUP BY path
          ORDER BY exits DESC
          LIMIT ?`,
    args: [limit],
  })

  return result.rows.map(r => ({
    path: r.path as string,
    exits: Number(r.exits),
    exitRate: Number(r.exit_rate),
  }))
}

// ─── Week-over-Week Comparison ───────────────────────────────────────────────

export async function getWeekComparison(): Promise<WeekComparison> {
  await ensureSchema()
  const db = getDb()

  const ts = todayStart()
  const thisWeekStart = ts - ((ts / 86400 % 7)) * 86400
  const lastWeekStart = thisWeekStart - 7 * 86400
  const lastWeekEnd = thisWeekStart - 1

  const [thisWeekResult, lastWeekResult] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as unique_visitors,
              COUNT(DISTINCT COALESCE(session_id, visitor_id)) as sessions
            FROM page_views WHERE created_at >= ?`,
      args: [thisWeekStart],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as unique_visitors,
              COUNT(DISTINCT COALESCE(session_id, visitor_id)) as sessions
            FROM page_views WHERE created_at >= ? AND created_at <= ?`,
      args: [lastWeekStart, lastWeekEnd],
    }),
  ])

  const tw = thisWeekResult.rows[0]
  const lw = lastWeekResult.rows[0]
  return {
    thisWeek: { views: Number(tw?.views ?? 0), uniqueVisitors: Number(tw?.unique_visitors ?? 0), sessions: Number(tw?.sessions ?? 0) },
    lastWeek: { views: Number(lw?.views ?? 0), uniqueVisitors: Number(lw?.unique_visitors ?? 0), sessions: Number(lw?.sessions ?? 0) },
  }
}

// ─── Page Flow Analysis ──────────────────────────────────────────────────────

export async function getPageFlows(limit = 15): Promise<PageFlow[]> {
  await ensureSchema()
  const db = getDb()

  const result = await db.execute({
    sql: `WITH ordered AS (
            SELECT path, visitor_id, session_id, created_at,
              LEAD(path) OVER (
                PARTITION BY COALESCE(session_id, visitor_id)
                ORDER BY created_at
              ) as next_path,
              LEAD(created_at) OVER (
                PARTITION BY COALESCE(session_id, visitor_id)
                ORDER BY created_at
              ) as next_time
            FROM page_views
          )
          SELECT path as from_page, next_path as to_page, COUNT(*) as count
          FROM ordered
          WHERE next_path IS NOT NULL
            AND next_path != path
            AND (next_time - created_at) < 1800
          GROUP BY from_page, to_page
          ORDER BY count DESC
          LIMIT ?`,
    args: [limit],
  })

  return result.rows.map(r => ({
    from: r.from_page as string,
    to: r.to_page as string,
    count: Number(r.count),
  }))
}

// ─── Traffic Anomaly Detection ───────────────────────────────────────────────

export async function detectTrafficAnomaly(): Promise<AnomalyResult> {
  await ensureSchema()
  const db = getDb()

  const ts = todayStart()

  const todayResult = await db.execute({
    sql: `SELECT COUNT(*) as views FROM page_views WHERE created_at >= ?`,
    args: [ts],
  })
  const todayViews = Number(todayResult.rows[0]?.views ?? 0)

  const avgResult = await db.execute({
    sql: `SELECT AVG(daily_count) as avg_views FROM (
            SELECT date(created_at, 'unixepoch', '+8 hours') as day, COUNT(*) as daily_count
            FROM page_views
            WHERE created_at >= ? AND created_at < ?
            GROUP BY day
          )`,
    args: [ts - 7 * 86400, ts],
  })
  const avgViews = Number(avgResult.rows[0]?.avg_views ?? 0)

  if (avgViews === 0) {
    return { todayViews, avgViews: 0, deviation: 0, status: 'no_data', message: '数据不足，无法判断' }
  }

  const now = Math.floor(Date.now() / 1000)
  const hoursPassed = (now - ts) / 3600
  const dayProgress = Math.min(hoursPassed / 24, 1)
  const projectedToday = dayProgress > 0 ? todayViews / dayProgress : todayViews
  const deviation = ((projectedToday - avgViews) / avgViews) * 100

  let status: AnomalyResult['status'] = 'normal'
  let message = ''

  if (deviation > 50) {
    status = 'spike'
    message = `流量异常偏高 (+${deviation.toFixed(0)}%)，预计今天 ${Math.round(projectedToday)} PV`
  } else if (deviation < -50) {
    status = 'drop'
    message = `流量异常偏低 (${deviation.toFixed(0)}%)，预计今天 ${Math.round(projectedToday)} PV`
  } else {
    message = `流量正常，今日已 ${todayViews} PV，均值 ${avgViews.toFixed(0)} PV/天`
  }

  return { todayViews, avgViews, deviation, status, message }
}

