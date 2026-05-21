/**
 * Funnel Analysis API
 *
 * GET /api/analytics/funnels?days=30
 * Returns conversion funnel analysis. Requires auth.
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { analyzeAllFunnels } from '@/lib/funnels'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(Number(searchParams.get('days') || '30'), 1), 90)

  const funnels = await analyzeAllFunnels(days)

  return NextResponse.json(
    { funnels },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
