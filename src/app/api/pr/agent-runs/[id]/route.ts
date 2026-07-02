import { NextResponse } from 'next/server'

import { withAuthParams } from '@/lib/api-helpers'
import { getAgentRunDetail } from '@/lib/pr/state'

export const dynamic = 'force-dynamic'

export const GET = withAuthParams<{ id: string }>(async (_request, { params }) => {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const detail = await getAgentRunDetail(id)
  if (!detail) return NextResponse.json({ error: 'Agent run not found' }, { status: 404 })

  return NextResponse.json(detail)
})
