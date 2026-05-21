/**
 * Conversion Goals API
 *
 * GET /api/analytics/conversions?days=30
 * Returns conversion goal statistics.
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getConversionStats } from '@/lib/conversions'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(Number(searchParams.get('days') || '30'), 1), 90)

  const data = await getConversionStats(days)

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
