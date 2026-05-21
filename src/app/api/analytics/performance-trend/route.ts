/**
 * Performance Trend API
 *
 * GET /api/analytics/performance-trend?days=14
 * Returns daily performance metrics for trend visualization.
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getPerformanceTrend } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(Number(searchParams.get('days') || '14'), 1), 90)

  const data = await getPerformanceTrend(days)

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
