import { NextResponse } from 'next/server'

import { withAuth, validateBody } from '@/lib/api-helpers'
import { chatWithPr, listConversationMessages } from '@/lib/pr/chat'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const threadId = url.searchParams.get('threadId')
  if (!threadId) return NextResponse.json({ error: 'threadId is required' }, { status: 400 })

  const messages = await listConversationMessages(threadId)
  return NextResponse.json({ messages })
})

export const POST = withAuth(async (request) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const invalid = validateBody(body, ['message'])
  if (invalid) return invalid

  const result = await chatWithPr({
    message: String(body.message),
    threadId: typeof body.threadId === 'string' ? body.threadId : null,
  })

  return NextResponse.json(result)
})
