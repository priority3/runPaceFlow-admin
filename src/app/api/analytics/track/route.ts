/**
 * Analytics Track API
 *
 * POST /api/analytics/track
 * Receives page view beacons from the frontend.
 * Parses user agent, resolves IP geolocation.
 * No auth required - this is a public ingestion endpoint.
 */

import { NextResponse } from 'next/server'

import { trackPageView } from '@/lib/analytics'
import { ensureSchema, getDb } from '@/lib/db'
import { getGeoFromIP } from '@/lib/geo'
import { rateLimit } from '@/lib/rate-limit'
import { parseUserAgent } from '@/lib/ua-parser'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

export async function POST(request: Request) {
  // Rate limit: 30 requests per minute per IP
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rateLimitResponse = rateLimit(`track:${ip}`, 30, 60_000)
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = await request.json()

    // Handle click events
    if (body.type === 'clicks' && Array.isArray(body.clicks)) {
      await ensureSchema()
      const db = getDb()
      for (const click of body.clicks) {
        await db.execute({
          sql: `INSERT INTO click_events (x, y, selector, path, visitor_id, created_at)
                VALUES (?, ?, ?, ?, ?, unixepoch())`,
          args: [click.x, click.y, click.selector, body.path, body.visitorId],
        })
      }
      return NextResponse.json({ ok: true }, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      })
    }

    // Handle error events
    if (body.type === 'error') {
      await ensureSchema()
      const db = getDb()
      await db.execute({
        sql: `INSERT INTO error_events (message, filename, lineno, colno, stack, path, visitor_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
        args: [
          body.message ?? '',
          body.filename ?? null,
          body.lineno ?? null,
          body.colno ?? null,
          body.stack ?? null,
          body.path ?? '/',
          body.visitorId ?? null,
        ],
      })
      return NextResponse.json({ ok: true }, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      })
    }

    const { path, referrer, visitorId, sessionId, language, timezone, loadTime, scrollDepth, abTests } = body
    const userAgent = request.headers.get('user-agent') || body.userAgent || ''

    if (!path || typeof path !== 'string') {
      return NextResponse.json({ error: 'path is required' }, { status: 400 })
    }

    // Parse user agent
    const ua = parseUserAgent(userAgent)

    // Get geolocation (async, non-blocking for fast response)
    const geo = getGeoFromIP(ip).catch(() => ({ country: null, region: null, city: null }))

    const geoData = await geo

    await trackPageView({
      path,
      referrer,
      userAgent,
      ip,
      visitorId,
      sessionId,
      browser: ua.browser,
      os: ua.os,
      deviceType: ua.deviceType,
      country: geoData.country,
      city: geoData.city,
      region: geoData.region,
      language,
      timezone,
      loadTime: typeof loadTime === 'number' ? loadTime : null,
      scrollDepth: typeof scrollDepth === 'number' ? scrollDepth : null,
      abTests: abTests && typeof abTests === 'object' ? abTests : null,
    })

    return NextResponse.json({ ok: true }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[Analytics] Track error:', error)
    return NextResponse.json({ ok: true }) // Silent fail - don't break frontend
  }
}
