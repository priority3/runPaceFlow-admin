import { NextResponse } from 'next/server'

import { withAuth, validateBody } from '@/lib/api-helpers'
import { createLifeEvent, listLifeEvents, type LifeEventType } from '@/lib/pr/life-events'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get('limit') ?? 20)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20
  const events = await listLifeEvents(limit)
  return NextResponse.json({ events })
})

export const POST = withAuth(async (request) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const invalid = validateBody(body, ['type'])
  if (invalid) return invalid

  const eventId = await createLifeEvent({
    type: String(body.type) as LifeEventType,
    occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    mediaUrl: typeof body.mediaUrl === 'string' ? body.mediaUrl : null,
    rawText: typeof body.rawText === 'string' ? body.rawText : null,
  })

  return NextResponse.json({ eventId })
})
