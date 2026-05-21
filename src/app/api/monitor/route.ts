import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { getMonitorData } from '@/lib/monitor'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireAuth()
    const data = await getMonitorData()
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    )
  }
}
