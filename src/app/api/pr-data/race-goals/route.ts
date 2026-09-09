import { NextResponse } from 'next/server'
import { asc, eq, inArray } from 'drizzle-orm'

import { withPrAgentDataAuth } from '@/lib/api-helpers'
import { getActivitiesDb } from '@/lib/db/activities-client'
import { raceGoals } from '@/lib/db/activities-schema'

export const dynamic = 'force-dynamic'

export const GET = withPrAgentDataAuth(async request => {
  const status = new URL(request.url).searchParams.get('status')?.split(',').filter(Boolean) ?? ['active']
  const db = await getActivitiesDb()
  return NextResponse.json({ goals: await db.select().from(raceGoals).where(inArray(raceGoals.status, status)).orderBy(asc(raceGoals.raceDate)) }, { headers: { 'Cache-Control': 'no-store' } })
})
