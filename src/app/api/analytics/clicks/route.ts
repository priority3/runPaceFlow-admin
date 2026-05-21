/**
 * Click Heatmap API
 *
 * GET /api/analytics/clicks?path=/&days=7
 * Returns click event data for heatmap visualization.
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
  const path = searchParams.get('path') || '/'
  const days = Math.min(Math.max(Number(searchParams.get('days') || '7'), 1), 30)
  const start = todayStart() - (days - 1) * 86400

  const db = getDb()

  const [result, statsResult] = await Promise.all([
    db.execute({
      sql: `SELECT x, y, selector, COUNT(*) as count
            FROM click_events
            WHERE path = ? AND created_at >= ?
            GROUP BY x, y, selector
            ORDER BY count DESC
            LIMIT 100`,
      args: [path, start],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as total, COUNT(DISTINCT selector) as selectors
            FROM click_events
            WHERE path = ? AND created_at >= ?`,
      args: [path, start],
    }),
  ])

  const clicks = result.rows.map(r => ({
    x: Number(r.x),
    y: Number(r.y),
    selector: r.selector as string,
    count: Number(r.count),
  }))

  const stats = statsResult.rows[0]

  return NextResponse.json(
    {
      path,
      clicks,
      stats: {
        totalClicks: Number(stats?.total ?? 0),
        uniqueSelectors: Number(stats?.selectors ?? 0),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
