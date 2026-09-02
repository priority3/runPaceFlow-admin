/**
 * Advanced Analytics Queries
 *
 * Performance stats, trends, and A/B test analytics.
 * Separated from core queries for modularity.
 */

import { ensureSchema, getDb } from './db'

// ─── Helper ──────────────────────────────────────────────────────────────────

function todayStart(): number {
  const now = Math.floor(Date.now() / 1000)
  return now - (now % 86400) - (8 * 3600) // UTC+8
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PerformanceStats {
  avgLoadTime: number | null
  avgScrollDepth: number | null
  p95LoadTime: number | null
}

export interface PerformanceTrend {
  date: string
  avgLoadTime: number | null
  p95LoadTime: number | null
  avgScrollDepth: number | null
  sampleSize: number
}

// ─── Performance Stats ───────────────────────────────────────────────────────

export async function getPerformanceStats(days = 7): Promise<PerformanceStats> {
  await ensureSchema()
  const db = getDb()
  const start = todayStart() - (days - 1) * 86400

  const [avgResult, p95Result] = await Promise.all([
    db.execute({
      sql: `SELECT AVG(load_time) as avg_load, AVG(scroll_depth) as avg_scroll
            FROM page_views WHERE created_at >= ? AND load_time IS NOT NULL`,
      args: [start],
    }),
    db.execute({
      // Reason: OFFSET 只接受整数,而 COUNT(*) * 0.95 是浮点 —— 样本数不是 20 的倍数时
      // SQLite 直接抛 SQLITE_MISMATCH(整个 /api/analytics/stats 因此 500)。必须 CAST 取整,
      // 口径与 getPerformanceTrend 的 `rn = CAST(cnt * 0.95 AS INTEGER) + 1` 保持一致。
      sql: `SELECT load_time FROM page_views
            WHERE created_at >= ? AND load_time IS NOT NULL
            ORDER BY load_time LIMIT 1
            OFFSET (SELECT CAST(COUNT(*) * 0.95 AS INTEGER) FROM page_views WHERE created_at >= ? AND load_time IS NOT NULL)`,
      args: [start, start],
    }),
  ])

  const avg = avgResult.rows[0]
  return {
    avgLoadTime: avg?.avg_load != null ? Number(avg.avg_load) : null,
    avgScrollDepth: avg?.avg_scroll != null ? Number(avg.avg_scroll) : null,
    p95LoadTime: p95Result.rows[0]?.load_time != null ? Number(p95Result.rows[0].load_time) : null,
  }
}

// ─── Performance Trend ───────────────────────────────────────────────────────

export async function getPerformanceTrend(days = 14): Promise<PerformanceTrend[]> {
  await ensureSchema()
  const db = getDb()
  const start = todayStart() - (days - 1) * 86400

  const result = await db.execute({
    sql: `SELECT
            date(created_at, 'unixepoch', '+8 hours') as day,
            AVG(load_time) as avg_load,
            AVG(scroll_depth) as avg_scroll,
            COUNT(*) as sample_size
          FROM page_views
          WHERE created_at >= ? AND load_time IS NOT NULL
          GROUP BY day
          ORDER BY day ASC`,
    args: [start],
  })

  const p95Result = await db.execute({
    sql: `WITH daily AS (
            SELECT
              date(created_at, 'unixepoch', '+8 hours') as day,
              load_time,
              ROW_NUMBER() OVER (PARTITION BY date(created_at, 'unixepoch', '+8 hours') ORDER BY load_time) as rn,
              COUNT(*) OVER (PARTITION BY date(created_at, 'unixepoch', '+8 hours')) as cnt
            FROM page_views
            WHERE created_at >= ? AND load_time IS NOT NULL
          )
          SELECT day, load_time as p95_load
          FROM daily
          WHERE rn = CAST(cnt * 0.95 AS INTEGER) + 1
          ORDER BY day ASC`,
    args: [start],
  })

  const p95Map = new Map(p95Result.rows.map(r => [r.day as string, Number(r.p95_load)]))

  return result.rows.map(r => ({
    date: r.day as string,
    avgLoadTime: r.avg_load != null ? Number(r.avg_load) : null,
    p95LoadTime: p95Map.get(r.day as string) ?? null,
    avgScrollDepth: r.avg_scroll != null ? Number(r.avg_scroll) : null,
    sampleSize: Number(r.sample_size),
  }))
}

