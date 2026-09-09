import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { withAuthParams } from '@/lib/api-helpers'
import { getActivitiesDb } from '@/lib/db/activities-client'
import { raceGoals } from '@/lib/db/activities-schema'
import { syncRacePlanGoal } from '@/lib/pr-data/race-plans'

export const dynamic = 'force-dynamic'
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(), raceDate: z.coerce.date().optional(), distanceMeters: z.number().positive().optional(),
  targetType: z.string().trim().min(1).max(40).optional(), targetTimeSec: z.number().int().positive().nullable().optional(), priority: z.string().max(30).optional(), status: z.string().max(30).optional(), notes: z.string().nullable().optional(),
})

export const PATCH = withAuthParams<{ id: string }>(async (request, context) => {
  const { id } = await context.params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid race goal payload', issues: parsed.error.issues }, { status: 400 })
  const db = await getActivitiesDb()
  await db.update(raceGoals).set({ ...parsed.data, updatedAt: new Date() }).where(eq(raceGoals.id, id))
  await syncRacePlanGoal(id)
  return NextResponse.json({ goalId: id })
})

export const DELETE = withAuthParams<{ id: string }>(async (_request, context) => {
  const { id } = await context.params
  const db = await getActivitiesDb()
  await db.update(raceGoals).set({ status: 'archived', updatedAt: new Date() }).where(eq(raceGoals.id, id))
  await syncRacePlanGoal(id, true)
  return NextResponse.json({ goalId: id })
})
