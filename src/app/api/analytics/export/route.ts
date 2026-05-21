/**
 * Analytics Export API
 *
 * GET /api/analytics/export?days=14&format=csv
 * Exports page view data as CSV. Requires auth.
 */

import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { ensureSchema, getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireAuth()
    await ensureSchema()

    const { searchParams } = new URL(request.url)
    const days = Math.min(Number(searchParams.get('days') || '30'), 90)
    const format = searchParams.get('format') || 'csv'

    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    const startDay = now - (now % 86400) - (8 * 3600)
    const start = startDay - (days - 1) * 86400

    const result = await db.execute({
      sql: `SELECT
              date(created_at, 'unixepoch', '+8 hours') as date,
              path,
              referrer,
              browser,
              os,
              device_type,
              country,
              city,
              language,
              timezone,
              COUNT(*) as views
            FROM page_views
            WHERE created_at >= ?
            GROUP BY date, path, referrer, browser, os, device_type, country, city, language, timezone
            ORDER BY date DESC, views DESC`,
      args: [start],
    })

    const mapped = result.rows.map(r => ({
      date: r.date,
      path: r.path,
      referrer: r.referrer,
      browser: r.browser,
      os: r.os,
      device_type: r.device_type,
      country: r.country,
      city: r.city,
      language: r.language,
      timezone: r.timezone,
      views: Number(r.views),
    }))

    if (format === 'json') {
      return NextResponse.json(mapped, {
        headers: {
          'Content-Disposition': `attachment; filename="analytics-${days}d.json"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const header = 'date,path,referrer,browser,os,device_type,country,city,language,timezone,views'
    const rows = mapped.map(r =>
      [r.date, r.path, r.referrer, r.browser, r.os, r.device_type, r.country, r.city, r.language, r.timezone, r.views]
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    )

    const csv = [header, ...rows].join('\n')

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="analytics-${days}d.csv"`,
        'Cache-Control': 'no-store',
      },
    })
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
