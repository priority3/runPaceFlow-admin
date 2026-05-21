/**
 * Funnel Analysis API
 *
 * GET /api/analytics/funnels?days=30
 * Returns conversion funnel analysis. Requires auth.
 */

import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { analyzeAllFunnels } from '@/lib/funnels'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireAuth()

    const { searchParams } = new URL(request.url)
    const days = Math.min(Math.max(Number(searchParams.get('days') || '30'), 1), 90)

    const funnels = await analyzeAllFunnels(days)

    return NextResponse.json(
      { funnels },
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
