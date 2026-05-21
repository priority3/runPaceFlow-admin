/**
 * A/B Tests API
 *
 * GET /api/analytics/ab-tests?days=30
 * Returns A/B test results with variant performance.
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { getABTestStats } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireAuth()

    const { searchParams } = new URL(request.url)
    const days = Math.min(Math.max(Number(searchParams.get('days') || '30'), 1), 90)

    const tests = await getABTestStats(days)

    return NextResponse.json(
      { tests },
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
