import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { listMemories } from '@/lib/pr/memory'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const statuses = url.searchParams.get('status')?.split(',').filter(Boolean) ?? ['candidate', 'active']
  const memories = await listMemories(statuses, 100)

  return NextResponse.json({ memories })
})
