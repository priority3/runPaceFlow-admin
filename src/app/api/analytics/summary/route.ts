/**
 * Analytics Summary API
 *
 * GET /api/analytics/summary
 * Returns quick summary metrics for the dashboard.
 * No auth required for lightweight polling.
 */

import { NextResponse } from 'next/server'

import { ensureSchema, getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

function todayStart(): number {
  const now = Math.floor(Date.now() / 1000)
  return now - (now % 86400) - (8 * 3600) // UTC+8
}

export async function GET() {
  try {
    await ensureSchema()
    const db = getDb()

    const ts = todayStart()
    const yesterdayStart = ts - 86400
    const weekStart = ts - 7 * 86400

    const [todayResult, yesterdayResult, weekResult, perfResult] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as visitors,
                COUNT(DISTINCT COALESCE(session_id, visitor_id)) as sessions
              FROM page_views WHERE created_at >= ?`,
        args: [ts],
      }),
      db.execute({
        sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as visitors,
                COUNT(DISTINCT COALESCE(session_id, visitor_id)) as sessions
              FROM page_views WHERE created_at >= ? AND created_at < ?`,
        args: [yesterdayStart, ts],
      }),
      db.execute({
        sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as visitors,
                COUNT(DISTINCT COALESCE(session_id, visitor_id)) as sessions
              FROM page_views WHERE created_at >= ?`,
        args: [weekStart],
      }),
      db.execute({
        sql: `SELECT AVG(load_time) as avg_load
              FROM page_views WHERE created_at >= ? AND load_time IS NOT NULL`,
        args: [ts],
      }),
    ])

    const today = todayResult.rows[0]
    const yesterday = yesterdayResult.rows[0]
    const week = weekResult.rows[0]

    return NextResponse.json(
      {
        today: {
          views: Number(today?.views ?? 0),
          visitors: Number(today?.visitors ?? 0),
          sessions: Number(today?.sessions ?? 0),
          avgLoadTime: perfResult.rows[0]?.avg_load != null ? Number(perfResult.rows[0].avg_load) : null,
        },
        yesterday: {
          views: Number(yesterday?.views ?? 0),
          visitors: Number(yesterday?.visitors ?? 0),
          sessions: Number(yesterday?.sessions ?? 0),
        },
        week: {
          views: Number(week?.views ?? 0),
          visitors: Number(week?.visitors ?? 0),
          sessions: Number(week?.sessions ?? 0),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    )
  }
}
