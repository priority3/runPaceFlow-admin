/**
 * Realtime Visitors API
 *
 * GET /api/analytics/realtime-visitors
 * Returns detailed information about current visitors (last 5 minutes).
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { ensureSchema, getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireAuth()
    await ensureSchema()

    const db = getDb()
    const since = Math.floor(Date.now() / 1000) - 5 * 60 // Last 5 minutes

    // Get recent visitors with their details
    const result = await db.execute({
      sql: `SELECT visitor_id, path, country, city, browser, os, device_type, MAX(created_at) as last_seen
            FROM page_views
            WHERE created_at >= ? AND visitor_id IS NOT NULL
            GROUP BY visitor_id
            ORDER BY last_seen DESC`,
      args: [since],
    })

    const visitors = result.rows.map(r => ({
      visitorId: r.visitor_id as string,
      path: r.path as string,
      country: r.country as string | null,
      city: r.city as string | null,
      browser: r.browser as string | null,
      os: r.os as string | null,
      deviceType: r.device_type as string | null,
      lastSeen: Number(r.last_seen),
    }))

    return NextResponse.json(
      {
        count: visitors.length,
        visitors,
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
