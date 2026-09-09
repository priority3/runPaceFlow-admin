import { withAuth } from '@/lib/api-helpers'
import { getActivitiesDb } from '@/lib/db/activities-client'
import { raceGoals } from '@/lib/db/activities-schema'
import { asc, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const goalSchema = z.object({
  name: z.string().trim().min(1).max(120), raceDate: z.coerce.date(), distanceMeters: z.number().positive(),
  targetType: z.string().trim().min(1).max(40), targetTimeSec: z.number().int().positive().nullable().optional(),
  priority: z.string().max(30).optional(), status: z.string().max(30).optional(), notes: z.string().nullable().optional(),
})

export const GET = withAuth(async request => {
  const status = new URL(request.url).searchParams.get('status')?.split(',').filter(Boolean) ?? ['active']
  const db = await getActivitiesDb()
  return NextResponse.json({ goals: await db.select().from(raceGoals).where(inArray(raceGoals.status, status)).orderBy(asc(raceGoals.raceDate)) })
})

export const POST = withAuth(async request => {
  const parsed = goalSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid race goal payload', issues: parsed.error.issues }, { status: 400 })
  const db = await getActivitiesDb()
  const id = `goal_${crypto.randomUUID().replaceAll('-', '')}`
  await db.insert(raceGoals).values({ id, ...parsed.data, priority: parsed.data.priority ?? 'primary', status: parsed.data.status ?? 'active', notes: parsed.data.notes ?? null })
  return NextResponse.json({ goalId: id })
})

export const PATCH = withAuth(async request => {
  const id = new URL(request.url).pathname.split('/').pop()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const body = await request.json().catch(() => null)
  const parsed = goalSchema.partial().safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid race goal payload', issues: parsed.error.issues }, { status: 400 })
  const db = await getActivitiesDb()
  await db.update(raceGoals).set({ ...parsed.data, updatedAt: new Date() }).where(eq(raceGoals.id, id))
  return NextResponse.json({ goalId: id })
})

export const DELETE = withAuth(async request => {
  const id = new URL(request.url).pathname.split('/').pop()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const db = await getActivitiesDb()
  await db.update(raceGoals).set({ status: 'archived', updatedAt: new Date() }).where(eq(raceGoals.id, id))
  return NextResponse.json({ goalId: id })
})
