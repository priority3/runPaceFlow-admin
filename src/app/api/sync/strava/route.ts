/**
 * Strava 同步 API
 *
 * POST /api/sync/strava
 * Body: { limit?: number, fullSync?: boolean }
 *
 * admin 直接调 Strava API 增量同步,写入共享活动库。
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { requestPrReviewBatch } from '@/lib/pr-agent-client'
import { performSync } from '@/lib/sync/service'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (request) => {
  let body: { limit?: number; fullSync?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    // 允许空 body,用默认值
  }

  const limit = typeof body.limit === 'number' ? body.limit : 50
  const fullSync = body.fullSync === true

  const result = await performSync({ source: 'strava', limit, fullSync })

  // 同 /api/sync/keep:复盘生成是 LLM 慢活,不阻塞同步结果的返回(否则调用方必然超时)。
  if (result.success && result.activityIds.length > 0) {
    void requestPrReviewBatch(result.activityIds).catch(error =>
      console.warn('[sync/strava] 复盘批量生成失败(数据已入库,不影响本次同步结果):', (error as Error).message),
    )
  }

  return NextResponse.json(
    {
      success: result.success,
      count: result.activitiesCount,
      activityIds: result.activityIds,
      errorMessage: result.errorMessage,
      logId: result.logId,
    },
    { status: result.success ? 200 : 500 },
  )
})
