/**
 * Error Events API
 *
 * GET /api/analytics/errors?days=7
 * Returns JavaScript error events from the frontend.
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { ensureSchema, getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

function todayStart(): number {
  const now = Math.floor(Date.now() / 1000)
  return now - (now % 86400) - (8 * 3600) // UTC+8
}

export async function GET(request: Request) {
  try {
    await requireAuth()
    await ensureSchema()

    const { searchParams } = new URL(request.url)
    const days = Math.min(Math.max(Number(searchParams.get('days') || '7'), 1), 30)
    const start = todayStart() - (days - 1) * 86400

    const db = getDb()

    // Get error summary by message
    const summaryResult = await db.execute({
      sql: `SELECT message, COUNT(*) as count, MIN(created_at) as first_seen, MAX(created_at) as last_seen
            FROM error_events
            WHERE created_at >= ?
            GROUP BY message
            ORDER BY count DESC
            LIMIT 20`,
      args: [start],
    })

    // Get recent errors
    const recentResult = await db.execute({
      sql: `SELECT message, filename, lineno, path, visitor_id,
              date(created_at, 'unixepoch', '+8 hours') as date,
              created_at
            FROM error_events
            WHERE created_at >= ?
            ORDER BY created_at DESC
            LIMIT 20`,
      args: [start],
    })

    // Get total count
    const totalResult = await db.execute({
      sql: `SELECT COUNT(*) as count FROM error_events WHERE created_at >= ?`,
      args: [start],
    })

    // Get daily error counts
    const dailyResult = await db.execute({
      sql: `SELECT date(created_at, 'unixepoch', '+8 hours') as day, COUNT(*) as count
            FROM error_events
            WHERE created_at >= ?
            GROUP BY day
            ORDER BY day ASC`,
      args: [start],
    })

    return NextResponse.json(
      {
        total: Number(totalResult.rows[0]?.count ?? 0),
        summary: summaryResult.rows.map(r => ({
          message: r.message as string,
          count: Number(r.count),
          firstSeen: new Date((r.first_seen as number) * 1000).toISOString(),
          lastSeen: new Date((r.last_seen as number) * 1000).toISOString(),
        })),
        recent: recentResult.rows.map(r => ({
          message: r.message as string,
          filename: r.filename as string | null,
          lineno: r.lineno as number | null,
          path: r.path as string,
          visitorId: r.visitor_id as string | null,
          date: r.date as string,
          createdAt: new Date((r.created_at as number) * 1000).toISOString(),
        })),
        daily: dailyResult.rows.map(r => ({
          date: r.day as string,
          count: Number(r.count),
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    )
  }
}
