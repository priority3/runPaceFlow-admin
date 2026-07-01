import { NextResponse } from 'next/server'

import { withAuth, validateBody } from '@/lib/api-helpers'
import { createRaceGoal, listRaceGoals } from '@/lib/pr/race-goals'
import { projectFriendProfile } from '@/lib/pr/memory'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const statuses = url.searchParams.get('status')?.split(',').filter(Boolean) ?? ['active']
  const goals = await listRaceGoals(statuses)
  return NextResponse.json({ goals })
})

export const POST = withAuth(async (request) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const invalid = validateBody(body, ['name', 'raceDate', 'distanceMeters', 'targetType'])
  if (invalid) return invalid

  const goalId = await createRaceGoal({
    name: String(body.name),
    raceDate: String(body.raceDate),
    distanceMeters: Number(body.distanceMeters),
    targetType: String(body.targetType),
    targetTimeSec: typeof body.targetTimeSec === 'number' ? body.targetTimeSec : body.targetTimeSec ? Number(body.targetTimeSec) : null,
    priority: typeof body.priority === 'string' ? body.priority : undefined,
    status: typeof body.status === 'string' ? body.status : undefined,
    notes: typeof body.notes === 'string' ? body.notes : null,
  })

  await projectFriendProfile()

  return NextResponse.json({ goalId })
})
