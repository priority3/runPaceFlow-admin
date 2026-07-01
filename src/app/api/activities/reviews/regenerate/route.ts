import { NextResponse } from 'next/server'

import { withAuth, validateBody } from '@/lib/api-helpers'
import { recordPrFeedbackEvent } from '@/lib/pr/feedback-loop'
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

  const activityId = String(body.activityId)
  const review = await generatePrReviewForActivity(activityId, {
    force: true,
    enqueueNotification: body.enqueueNotification !== false,
    trigger: 'manual_review',
  })

  if (!review) {
    return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
  }

  await recordPrFeedbackEvent({
    targetType: 'activity',
    targetId: activityId,
    eventType: 'regenerate',
    metadata: { reviewId: review.id },
  })

  return NextResponse.json({ review })
})
