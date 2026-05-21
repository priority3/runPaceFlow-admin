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

export interface ABTestResult {
  testName: string
  variants: Array<{
    name: string
    visitors: number
    conversions: number
    conversionRate: number
  }>
  totalVisitors: number
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
      sql: `SELECT load_time FROM page_views
            WHERE created_at >= ? AND load_time IS NOT NULL
            ORDER BY load_time LIMIT 1
            OFFSET (SELECT MAX(0, COUNT(*) - COUNT(*) * 0.05) FROM page_views WHERE created_at >= ? AND load_time IS NOT NULL)`,
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

// ─── A/B Test Stats ──────────────────────────────────────────────────────────

export async function getABTestStats(days = 30): Promise<ABTestResult[]> {
  await ensureSchema()
  const db = getDb()
  const start = todayStart() - (days - 1) * 86400

  const result = await db.execute({
    sql: `SELECT ab_tests, visitor_id FROM page_views
          WHERE created_at >= ? AND ab_tests IS NOT NULL`,
    args: [start],
  })

  const testMap = new Map<string, Map<string, Set<string>>>()

  for (const row of result.rows) {
    try {
      const abTests = JSON.parse(row.ab_tests as string) as Record<string, string>
      const visitorId = row.visitor_id as string

      for (const [testName, variant] of Object.entries(abTests)) {
        if (!testMap.has(testName)) {
          testMap.set(testName, new Map())
        }
        const variantMap = testMap.get(testName)!
        if (!variantMap.has(variant)) {
          variantMap.set(variant, new Set())
        }
        variantMap.get(variant)!.add(visitorId)
      }
    } catch {
      // Skip malformed data
    }
  }

  const results: ABTestResult[] = []
  for (const [testName, variantMap] of testMap) {
    let totalVisitors = 0
    const variants = Array.from(variantMap.entries()).map(([name, visitors]) => {
      totalVisitors += visitors.size
      return { name, visitors: visitors.size, conversions: 0, conversionRate: 0 }
    })

    results.push({ testName, variants, totalVisitors })
  }

  return results
}
