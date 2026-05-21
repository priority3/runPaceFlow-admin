import { NextResponse } from 'next/server'

import { ensureSchema, getDb } from '@/lib/db'
import { startScheduler } from '@/lib/scheduler'

export async function GET() {
  try {
    await ensureSchema()
    startScheduler()

    const db = getDb()
    const [rowResult, realtimeResult] = await Promise.all([
      db.execute(`SELECT COUNT(*) as count FROM page_views`),
      db.execute({
        sql: `SELECT COUNT(DISTINCT visitor_id) as count FROM page_views WHERE created_at >= ?`,
        args: [Math.floor(Date.now() / 1000) - 300],
      }),
    ])

    return NextResponse.json({
      ok: true,
      analytics: {
        totalPageViews: Number(rowResult.rows[0]?.count ?? 0),
        realtimeVisitors: Number(realtimeResult.rows[0]?.count ?? 0),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
