import { NextResponse } from 'next/server'

import { withPrAgentDataAuthParams } from '@/lib/api-helpers'
import { saveRaceResearch } from '@/lib/pr-data/race-plans'

export const dynamic = 'force-dynamic'

export const POST = withPrAgentDataAuthParams<{ id: string }>(async (request, context) => {
  const { id } = await context.params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid research payload' }, { status: 400 })
  const result = await saveRaceResearch(id, body)
  if (!result) return NextResponse.json({ error: 'Race plan not found' }, { status: 404 })
  return NextResponse.json({ plan: result }, { headers: { 'Cache-Control': 'no-store' } })
})
