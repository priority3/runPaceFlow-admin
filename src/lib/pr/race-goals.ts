import { asc, desc, eq, inArray } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { raceGoals } from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'

export interface RaceGoalInput {
  name: string
  raceDate: string | Date
  distanceMeters: number
  targetType: string
  targetTimeSec?: number | null
  priority?: string
  status?: string
  notes?: string | null
}

export interface RaceGoalUpdateInput {
  name?: string
  raceDate?: string | Date
  distanceMeters?: number
  targetType?: string
  targetTimeSec?: number | null
  priority?: string
  status?: string
  notes?: string | null
}

export interface RaceGoalContext {
  id: string
  name: string
  raceDate: string
  distanceMeters: number
  targetType: string
  targetTimeSec: number | null
  priority: string
  status: string
  notes: string | null
  daysUntilRace: number
}

function toIso(value: Date | string | number) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function daysUntil(date: string) {
  const diff = new Date(date).getTime() - Date.now()
  return Math.ceil(diff / 86_400_000)
}

function toContext(row: typeof raceGoals.$inferSelect): RaceGoalContext {
  return {
    id: row.id,
    name: row.name,
    raceDate: toIso(row.raceDate),
    distanceMeters: Number(row.distanceMeters),
    targetType: row.targetType,
    targetTimeSec: row.targetTimeSec == null ? null : Number(row.targetTimeSec),
    priority: row.priority,
    status: row.status,
    notes: row.notes ?? null,
    daysUntilRace: daysUntil(toIso(row.raceDate)),
  }
}

export async function createRaceGoal(input: RaceGoalInput) {
  const db = await getActivitiesDb()
  const id = generateId('goal')
  await db.insert(raceGoals).values({
    id,
    name: input.name,
    raceDate: new Date(input.raceDate),
    distanceMeters: input.distanceMeters,
    targetType: input.targetType,
    targetTimeSec: input.targetTimeSec ?? null,
    priority: input.priority ?? 'primary',
    status: input.status ?? 'active',
    notes: input.notes ?? null,
  })
  return id
}

export async function updateRaceGoal(id: string, input: RaceGoalUpdateInput) {
  const db = await getActivitiesDb()
  await db
    .update(raceGoals)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.raceDate !== undefined ? { raceDate: new Date(input.raceDate) } : {}),
      ...(input.distanceMeters !== undefined ? { distanceMeters: input.distanceMeters } : {}),
      ...(input.targetType !== undefined ? { targetType: input.targetType } : {}),
      ...(input.targetTimeSec !== undefined ? { targetTimeSec: input.targetTimeSec } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(raceGoals.id, id))
  return id
}

export async function deleteRaceGoal(id: string) {
  const db = await getActivitiesDb()
  await db.delete(raceGoals).where(eq(raceGoals.id, id))
  return id
}

export async function listRaceGoals(statuses: string[] = ['active']) {
  const db = await getActivitiesDb()
  const rows = await db
    .select()
    .from(raceGoals)
    .where(inArray(raceGoals.status, statuses))
    .orderBy(asc(raceGoals.raceDate))
  return rows.map(toContext)
}

export async function getRaceGoalContext(limit = 3): Promise<RaceGoalContext[]> {
  const db = await getActivitiesDb()
  const rows = await db
    .select()
    .from(raceGoals)
    .where(eq(raceGoals.status, 'active'))
    .orderBy(asc(raceGoals.raceDate))
    .limit(limit)
  return rows.map(toContext)
}
