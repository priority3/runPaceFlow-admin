/**
 * A/B Tests API
 *
 * GET /api/analytics/ab-tests?days=30
 * Returns A/B test results with variant performance.
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getABTestStats } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(Number(searchParams.get('days') || '30'), 1), 90)

  const tests = await getABTestStats(days)

  return NextResponse.json(
    { tests },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
