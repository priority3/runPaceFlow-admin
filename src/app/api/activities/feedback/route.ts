import { NextResponse } from 'next/server'

import { withAuth, validateBody } from '@/lib/api-helpers'
import { createSubjectiveFeedback } from '@/lib/pr/feedback'
import { applyMemoryPatch, curateMemoryFromFeedback } from '@/lib/pr/memory'
import { generatePrReviewForActivity } from '@/lib/pr/review'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (request) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const invalid = validateBody(body, ['activityId'])
  if (invalid) return invalid

  const rpe = typeof body.rpe === 'number' ? body.rpe : body.rpe ? Number(body.rpe) : null
  const pain = body.pain ?? null
  const note = typeof body.note === 'string' ? body.note : null
  const feedbackId = await createSubjectiveFeedback({
    activityId: String(body.activityId),
    mood: typeof body.mood === 'string' ? body.mood : null,
    rpe: Number.isFinite(rpe) ? rpe : null,
    pain,
    note,
    source: typeof body.source === 'string' ? body.source : 'dashboard',
  })
  const memoryPatches = await curateMemoryFromFeedback({
    feedbackId,
    activityId: String(body.activityId),
    note,
    pain,
  })
  const memoryIds: string[] = []
  for (const [index, patch] of memoryPatches.entries()) {
    memoryIds.push(
      await applyMemoryPatch(patch, {
        actor: 'agent',
        idempotencyKey: `feedback:${feedbackId}:memory:${index}`,
      }),
    )
  }
  const review = await generatePrReviewForActivity(String(body.activityId), {
    force: true,
    enqueueNotification: body.enqueueNotification !== false,
    trigger: 'manual_review',
  })

  return NextResponse.json({ feedbackId, memoryIds, review })
})
