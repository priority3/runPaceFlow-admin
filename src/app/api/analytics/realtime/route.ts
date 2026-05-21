/**
 * Real-time Analytics SSE Endpoint
 *
 * GET /api/analytics/realtime
 * Streams real-time visitor count updates via Server-Sent Events.
 * No auth required for public embedding.
 */

import { ensureSchema, getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        try {
          await ensureSchema()
          const db = getDb()
          const since = Math.floor(Date.now() / 1000) - 5 * 60

          const result = await db.execute({
            sql: `SELECT COUNT(DISTINCT visitor_id) as count, GROUP_CONCAT(DISTINCT path) as paths
                  FROM page_views WHERE created_at >= ?`,
            args: [since],
          })

          const data = {
            count: Number(result.rows[0]?.count ?? 0),
            paths: (result.rows[0]?.paths as string)?.split(',') ?? [],
            timestamp: new Date().toISOString(),
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Silent fail
        }
      }

      // Send initial data
      await send()

      // Send updates every 5 seconds
      const interval = setInterval(send, 5000)

      // Clean up on disconnect
      return () => clearInterval(interval)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
