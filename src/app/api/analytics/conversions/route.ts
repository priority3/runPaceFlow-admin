/**
 * Conversion Goals API
 *
 * GET /api/analytics/conversions?days=30
 * Returns conversion goal statistics.
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { getConversionStats } from '@/lib/conversions'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireAuth()

    const { searchParams } = new URL(request.url)
    const days = Math.min(Math.max(Number(searchParams.get('days') || '30'), 1), 90)

    const data = await getConversionStats(days)

    return NextResponse.json(
      { data },
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
