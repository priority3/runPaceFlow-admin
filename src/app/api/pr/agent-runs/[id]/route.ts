import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getAgentRunDetail } from '@/lib/pr/state'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (_request, context?: { params?: Promise<{ id: string }> }) => {
  const params = await context?.params
  const id = params?.id
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const detail = await getAgentRunDetail(id)
  if (!detail) return NextResponse.json({ error: 'Agent run not found' }, { status: 404 })

  return NextResponse.json(detail)
})
