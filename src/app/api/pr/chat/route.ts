import { NextResponse } from 'next/server'

import { withPrChatAuth } from '@/lib/api-helpers'
import { chatWithPr, listConversationMessages } from '@/lib/pr/chat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SSE 响应头:no-transform + X-Accel-Buffering 防 Cloudflare 隧道/代理缓冲
// (settings/public/stream 已验证此组合能穿隧道增量到达)。
const SSE_HEADERS = {
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
  'X-Accel-Buffering': 'no',
}

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
  const threadId = typeof body.threadId === 'string' ? body.threadId : null

  // 非流式路径:原有行为,一次性 JSON(旧客户端/微信回调等继续可用)。
  if (body.stream !== true) {
    const result = await chatWithPr({ message, threadId, imageUrl })
    return NextResponse.json(result)
  }

  // 流式路径:SSE 转发 thinking/text/tool 增量,最后 done 带完整结果(与非流式同形)。
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true // 客户端断开后 enqueue 会抛,置位后停止转发(服务端继续算完并落库)
        }
      }
      // 思考间隙可能超过 Cloudflare ~100s 空闲切断,15s 心跳保活
      const keepAlive = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ka\n\n'))
        } catch {
          closed = true
        }
      }, 15_000)
      request.signal.addEventListener('abort', () => (closed = true), { once: true })

      let streamedText = ''
      try {
        const result = await chatWithPr({
          message,
          threadId,
          imageUrl,
          onStream: evt => {
            if (evt.type === 'thinking') send('thinking', { delta: evt.delta })
            else if (evt.type === 'text') {
              streamedText += evt.delta
              send('text', { delta: evt.delta })
            } else if (evt.type === 'tool') send('tool', { name: evt.name })
            else if (evt.type === 'text_reset') {
              streamedText = ''
              send('text_reset', {})
            }
          },
        })
        // 评审改写/规则兜底/空响应等场景:最终答案与流出的不一致时整段替换
        if (result.answer !== streamedText) send('replace', { answer: result.answer })
        send('done', result)
      } catch (error) {
        send('error', { message: (error as Error).message })
      } finally {
        clearInterval(keepAlive)
        closed = true
        try {
          controller.close()
        } catch {
          /* 已关闭 */
        }
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})
