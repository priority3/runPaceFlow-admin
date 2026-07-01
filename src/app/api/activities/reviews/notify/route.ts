import { NextResponse } from 'next/server'

import { withAuth, validateBody } from '@/lib/api-helpers'
import { dispatchPendingNotifications } from '@/lib/notifications/dispatcher'
import { enqueueReviewNotification } from '@/lib/pr/review'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (request) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const invalid = validateBody(body, ['reviewId'])
  if (invalid) return invalid

  const notificationId = await enqueueReviewNotification(String(body.reviewId))
  if (!notificationId) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }

  const dispatchNow = body.dispatchNow !== false
  const dispatch = dispatchNow ? await dispatchPendingNotifications(1) : null

  return NextResponse.json({ notificationId, dispatch })
})
