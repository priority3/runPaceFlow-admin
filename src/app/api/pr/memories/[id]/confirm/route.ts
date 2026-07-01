import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { recordPrFeedbackEvent } from '@/lib/pr/feedback-loop'
import { confirmMemory } from '@/lib/pr/memory'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (_request, context?: { params?: Promise<{ id: string }> }) => {
  const params = await context?.params
  const id = params?.id
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const memoryId = await confirmMemory(id)
  if (!memoryId) return NextResponse.json({ error: 'Memory not found' }, { status: 404 })

  await recordPrFeedbackEvent({ targetType: 'memory', targetId: memoryId, eventType: 'memory_confirm' })

  return NextResponse.json({ memoryId })
})
