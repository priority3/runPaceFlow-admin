import { NextResponse } from 'next/server'

import { withPrChatAuth } from '@/lib/api-helpers'
import { chatWithPr, listConversationMessages } from '@/lib/pr/chat'

export const dynamic = 'force-dynamic'

export const GET = withPrChatAuth(async (request) => {
  const url = new URL(request.url)
  const threadId = url.searchParams.get('threadId')
  if (!threadId) return NextResponse.json({ error: 'threadId is required' }, { status: 400 })

  const messages = await listConversationMessages(threadId)
  return NextResponse.json({ messages })
})

export const POST = withPrChatAuth(async (request) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // message 或 imageUrl 至少有一个(允许只发图片)。
  const message = typeof body.message === 'string' ? body.message : ''
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : null
  if (!message.trim() && !imageUrl) {
    return NextResponse.json({ error: 'message or imageUrl required' }, { status: 400 })
  }

  const result = await chatWithPr({
    message,
    threadId: typeof body.threadId === 'string' ? body.threadId : null,
    imageUrl,
  })

  return NextResponse.json(result)
})
