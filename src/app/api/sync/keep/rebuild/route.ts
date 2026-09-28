/**
 * Keep 活动轨迹/分段原地重建(见 lib/sync/rebuild.ts)。
 *
 * POST /api/sync/keep/rebuild
 * Body: { activityIds?: string[], dryRun?: boolean }
 *
 * - 默认只报告不写库(dryRun 缺省即为 true),显式传 dryRun:false 才真正重建。
 * - 不传 activityIds:目标是 Keep 来源、有轨迹但分段总时长为 0 的活动。
 */
import { NextResponse } from 'next/server'

import { withSyncTriggerAuth } from '@/lib/api-helpers'
import { rebuildKeepTracks } from '@/lib/sync/rebuild'

export const dynamic = 'force-dynamic'

export const POST = withSyncTriggerAuth(async request => {
  let body: { activityIds?: unknown; dryRun?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    // 允许空 body
  }

  const activityIds = Array.isArray(body.activityIds)
    ? body.activityIds.filter((id): id is string => typeof id === 'string')
    : undefined
  const result = await rebuildKeepTracks({ activityIds, dryRun: body.dryRun !== false })
  return NextResponse.json(result)
})
