import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { listCurrentPrReviews } from '@/lib/pr/review'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get('limit') ?? 20)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20
  const reviews = await listCurrentPrReviews(limit)

  return NextResponse.json(
    { reviews },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
