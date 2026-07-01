import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getPrMetrics } from '@/lib/pr/metrics'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const daysParam = Number(url.searchParams.get('days') ?? 30)
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 365) : 30
  const metrics = await getPrMetrics(days)

  return NextResponse.json({ metrics })
})
