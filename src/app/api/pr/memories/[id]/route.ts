import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { updateMemory, type MemoryItemType } from '@/lib/pr/memory'

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

  const memoryId = await updateMemory(
    id,
    {
      type: typeof body.type === 'string' ? (body.type as MemoryItemType) : undefined,
      content: typeof body.content === 'string' ? body.content : undefined,
      confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
      status:
        body.status === 'candidate' ||
        body.status === 'active' ||
        body.status === 'decayed' ||
        body.status === 'archived'
          ? body.status
          : undefined,
      reason: typeof body.reason === 'string' ? body.reason : '用户更新记忆。',
    },
    { actor: 'user', idempotencyKey: `update:${id}:${Date.now()}` },
  )

  if (!memoryId) return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
  return NextResponse.json({ memoryId })
})
