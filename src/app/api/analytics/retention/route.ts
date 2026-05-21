/**
 * Data Retention API
 *
 * GET /api/analytics/retention - Get retention stats
 * POST /api/analytics/retention - Run cleanup
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { cleanupOldData, getRetentionStats } from '@/lib/retention'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async () => {
  const stats = await getRetentionStats()
  return NextResponse.json(stats, { headers: { 'Cache-Control': 'no-store' } })
})

export const POST = withAuth(async () => {
  const result = await cleanupOldData()
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
})
