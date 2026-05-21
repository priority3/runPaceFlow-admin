/**
 * Data Retention API
 *
 * GET /api/analytics/retention - Get retention stats
 * POST /api/analytics/retention - Run cleanup
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { cleanupOldData, getRetentionStats } from '@/lib/retention'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireAuth()
    const stats = await getRetentionStats()
    return NextResponse.json(stats, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST() {
  try {
    await requireAuth()
    const result = await cleanupOldData()
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
