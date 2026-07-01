import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { listFriendDiaryEntries } from '@/lib/pr/weekly'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get('limit') ?? 20)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20
  const entries = await listFriendDiaryEntries(limit)

  return NextResponse.json({ entries })
})
