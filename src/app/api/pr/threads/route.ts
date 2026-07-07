/**
 * PR 会话列表管理(H5 多会话)。
 * GET    /api/pr/threads         列出会话
 * DELETE /api/pr/threads?id=xxx  删除某会话及其消息
 * 认证:admin 会话 或 Bearer PR_CHAT_TOKEN(与 /api/pr/chat 一致)。用查询串删除避免动态路由。
 */
import { NextResponse } from 'next/server'

import { withPrChatAuth } from '@/lib/api-helpers'
import { deleteConversationThread, listConversationThreads } from '@/lib/pr/chat'

export const dynamic = 'force-dynamic'

export const GET = withPrChatAuth(async () => {
  const threads = await listConversationThreads(50)
  return NextResponse.json({ threads })
})

export const DELETE = withPrChatAuth(async (request) => {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const ok = await deleteConversationThread(id)
  if (!ok) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  return NextResponse.json({ deleted: id })
})
