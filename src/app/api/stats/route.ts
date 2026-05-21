import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

const FRONTEND_URL = process.env.RUNPACEFLOW_FRONTEND_URL || 'http://127.0.0.1:3000'

async function trpcQuery<T>(procedure: string): Promise<T> {
  const url = `${FRONTEND_URL}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify({}))}`
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`tRPC ${procedure} failed: ${res.status}`)
  const json = await res.json()
  return json.result?.data?.json as T
}

export const GET = withAuth(async () => {
  const [stats, syncStatus] = await Promise.all([
    trpcQuery('activities.getStats').catch(() => null),
    trpcQuery('sync.getSyncStatus').catch(() => null),
  ])

  return NextResponse.json(
    { stats, syncStatus },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
