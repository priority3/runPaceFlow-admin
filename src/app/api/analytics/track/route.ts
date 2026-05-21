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
