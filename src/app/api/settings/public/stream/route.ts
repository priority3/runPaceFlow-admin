import type { NextRequest } from 'next/server'

import { getPublicSettings } from '@/lib/public-settings'
import { subscribeSettingsChanged } from '@/lib/settings-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STREAM_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
  'X-Accel-Buffering': 'no',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: STREAM_HEADERS })
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const enqueue = (chunk: string) => {
        if (!closed) {
          controller.enqueue(encoder.encode(chunk))
        }
      }

      const sendSettings = async () => {
        try {
          const payload = {
            settings: await getPublicSettings(),
            updatedAt: new Date().toISOString(),
          }
          enqueue(`event: settings\ndata: ${JSON.stringify(payload)}\n\n`)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to load public settings'
          enqueue(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`)
        }
      }

      void sendSettings()

      const unsubscribe = subscribeSettingsChanged(() => {
        void sendSettings()
      })

      const keepAlive = setInterval(() => {
        enqueue(': keepalive\n\n')
      }, 25000)

      const close = () => {
        if (closed) return
        closed = true
        clearInterval(keepAlive)
        unsubscribe()
        controller.close()
      }

      request.signal.addEventListener('abort', close, { once: true })
    },
  })

  return new Response(stream, { headers: STREAM_HEADERS })
}
