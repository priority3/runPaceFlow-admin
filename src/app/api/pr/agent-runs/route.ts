import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { listAgentRuns } from '@/lib/pr/state'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get('limit') ?? 30)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 30

  return NextResponse.json({ runs: await listAgentRuns(limit) })
})
