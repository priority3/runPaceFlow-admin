/**
 * Nike 同步 API
 *
 * POST /api/sync/nike
 * Body: { limit?: number, fullSync?: boolean }
 *
 * admin 直接调 Nike API 增量同步,写入共享活动库。
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { performSync } from '@/lib/sync/service'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (request) => {
  let body: { limit?: number; fullSync?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    // 允许空 body
  }

  const limit = typeof body.limit === 'number' ? body.limit : 50
  const fullSync = body.fullSync === true

  const result = await performSync({ source: 'nike', limit, fullSync })

  return NextResponse.json(
    {
      success: result.success,
      count: result.activitiesCount,
      errorMessage: result.errorMessage,
      logId: result.logId,
    },
    { status: result.success ? 200 : 500 },
  )
})
