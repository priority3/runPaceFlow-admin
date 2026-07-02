import { NextResponse } from 'next/server'

import { withAuthParams } from '@/lib/api-helpers'
import { recordPrFeedbackEvent } from '@/lib/pr/feedback-loop'
import { confirmMemory } from '@/lib/pr/memory'

export const dynamic = 'force-dynamic'

export const POST = withAuthParams<{ id: string }>(async (_request, { params }) => {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const memoryId = await confirmMemory(id)
  if (!memoryId) return NextResponse.json({ error: 'Memory not found' }, { status: 404 })

  await recordPrFeedbackEvent({ targetType: 'memory', targetId: memoryId, eventType: 'memory_confirm' })

  return NextResponse.json({ memoryId })
})
