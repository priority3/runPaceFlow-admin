import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { deleteRaceGoal, updateRaceGoal } from '@/lib/pr/race-goals'
import { projectFriendProfile } from '@/lib/pr/memory'

export const dynamic = 'force-dynamic'

export const PATCH = withAuth(async (request, context?: { params?: Promise<{ id: string }> }) => {
  const params = await context?.params
  const id = params?.id
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  await updateRaceGoal(id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    raceDate: typeof body.raceDate === 'string' ? body.raceDate : undefined,
    distanceMeters: typeof body.distanceMeters === 'number' ? body.distanceMeters : body.distanceMeters ? Number(body.distanceMeters) : undefined,
    targetType: typeof body.targetType === 'string' ? body.targetType : undefined,
    targetTimeSec:
      body.targetTimeSec === null
        ? null
        : typeof body.targetTimeSec === 'number'
          ? body.targetTimeSec
          : body.targetTimeSec
            ? Number(body.targetTimeSec)
            : undefined,
    priority: typeof body.priority === 'string' ? body.priority : undefined,
    status: typeof body.status === 'string' ? body.status : undefined,
    notes: typeof body.notes === 'string' ? body.notes : body.notes === null ? null : undefined,
  })

  await projectFriendProfile()

  return NextResponse.json({ goalId: id })
})

export const DELETE = withAuth(async (_request, context?: { params?: Promise<{ id: string }> }) => {
  const params = await context?.params
  const id = params?.id
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  await deleteRaceGoal(id)
  await projectFriendProfile()
  return NextResponse.json({ goalId: id })
})
