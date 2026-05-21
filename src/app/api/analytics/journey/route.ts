/**
 * User Journey API
 *
 * GET /api/analytics/journey?days=30
 * Returns user navigation paths with transition counts.
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { ensureSchema, getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

function todayStart(): number {
  const now = Math.floor(Date.now() / 1000)
  return now - (now % 86400) - (8 * 3600) // UTC+8
}

export const GET = withAuth(async (request) => {
  await ensureSchema()

  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(Number(searchParams.get('days') || '30'), 1), 90)
  const start = todayStart() - (days - 1) * 86400

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
            WHERE created_at >= ?
          )
          SELECT path as from_page, next_path as to_page, COUNT(*) as count
          FROM ordered
          WHERE next_path IS NOT NULL
            AND next_path != path
            AND (next_time - created_at) < 1800
          GROUP BY from_page, to_page
          ORDER BY count DESC
          LIMIT 50`,
    args: [start],
  })

  const totalTransitions = result.rows.reduce((sum, r) => sum + Number(r.count), 0)

  const paths = result.rows.map(r => ({
    from: r.from_page as string,
    to: r.to_page as string,
    count: Number(r.count),
    percentage: totalTransitions > 0 ? (Number(r.count) / totalTransitions) * 100 : 0,
  }))

  return NextResponse.json(
    { paths, totalTransitions },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
