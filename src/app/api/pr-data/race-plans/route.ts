import { NextResponse } from 'next/server'

import { withPrAgentDataAuth } from '@/lib/api-helpers'
import { listRacePlansByIds, racePlanSyncSchema, syncRacePlans } from '@/lib/pr-data/race-plans'

export const dynamic = 'force-dynamic'

export const GET = withPrAgentDataAuth(async request => {
  const ids = new URL(request.url).searchParams.getAll('id')
  return NextResponse.json({ plans: await listRacePlansByIds(ids.length ? ids : undefined) }, { headers: { 'Cache-Control': 'no-store' } })
})

export const POST = withPrAgentDataAuth(async request => {
  const parsed = racePlanSyncSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid race plan payload', issues: parsed.error.issues }, { status: 400 })
  return NextResponse.json({ plans: await syncRacePlans(parsed.data) }, { headers: { 'Cache-Control': 'no-store' } })
})
