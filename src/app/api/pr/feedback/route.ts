import { NextResponse } from 'next/server'

import { withAuth, validateBody } from '@/lib/api-helpers'
import { recordPrFeedbackEvent, type PrFeedbackEventType } from '@/lib/pr/feedback-loop'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (request) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const invalid = validateBody(body, ['targetType', 'targetId', 'eventType'])
  if (invalid) return invalid

  const result = await recordPrFeedbackEvent({
    targetType: String(body.targetType),
    targetId: String(body.targetId),
    eventType: String(body.eventType) as PrFeedbackEventType,
    value: typeof body.value === 'string' ? body.value : null,
    note: typeof body.note === 'string' ? body.note : null,
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : null,
  })

  return NextResponse.json(result)
})
