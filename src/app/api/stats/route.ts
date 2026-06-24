import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getDashboardStats } from '@/lib/activity/dashboard-stats'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async () => {
  const { stats, syncStatus } = await getDashboardStats()

  return NextResponse.json(
    { stats, syncStatus },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
