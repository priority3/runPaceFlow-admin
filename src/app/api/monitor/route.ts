import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getMonitorData } from '@/lib/monitor'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async () => {
  const data = await getMonitorData()
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store' },
  })
})
