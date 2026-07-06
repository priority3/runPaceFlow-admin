/**
 * Keep 同步 API(默认同步源)
 *
 * POST /api/sync/keep
 * Body: { limit?: number, fullSync?: boolean, probe?: boolean }
 *
 * - probe=true:干跑,不写库,直接拉最近几条返回映射后的字段(校验单位/轨迹是否完整)。
 * - 否则:performSync 增量同步 Keep → 写活动库 → 触发 PR 跑后复盘。
 */
import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { generatePrReviewsForActivities } from '@/lib/pr/review'
import { getRuntimeSettings } from '@/lib/runtime-config'
import { KeepAdapter } from '@/lib/sync/adapters/keep'
import { performSync } from '@/lib/sync/service'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (request) => {
  let body: { limit?: number; fullSync?: boolean; probe?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    // 允许空 body
  }

  if (body.probe) {
    const settings = await getRuntimeSettings({ force: true })
    const mobile = settings.KEEP_MOBILE
    const password = settings.KEEP_PASSWORD
    if (!mobile || !password) {
      return NextResponse.json({ error: 'KEEP_MOBILE / KEEP_PASSWORD 未在设置里配置' }, { status: 400 })
    }
    const adapter = new KeepAdapter(mobile, password)
    if (!(await adapter.authenticate())) {
      return NextResponse.json({ error: 'Keep 登录失败(手机号/密码?)' }, { status: 401 })
    }
    const limit = typeof body.limit === 'number' ? body.limit : 3
    const acts = await adapter.getActivities({ limit })
    return NextResponse.json({
      probe: true,
      count: acts.length,
      activities: acts.map(a => ({
        id: a.id,
        title: a.title,
        startTime: a.startTime,
        durationSec: a.duration,
        distanceM: a.distance,
        avgHr: a.averageHeartRate ?? null,
        maxHr: a.maxHeartRate ?? null,
        calories: a.calories ?? null,
        isIndoor: a.isIndoor ?? false,
        hasGpx: Boolean(a.gpxData),
        gpxPoints: a.gpxData ? (a.gpxData.match(/<trkpt/g) ?? []).length : 0,
      })),
    })
  }

  const limit = typeof body.limit === 'number' ? body.limit : 50
  const fullSync = body.fullSync === true
  const result = await performSync({ source: 'keep', limit, fullSync })
  const reviews =
    result.success && result.activityIds.length > 0
      ? await generatePrReviewsForActivities(result.activityIds)
      : { generated: 0, skipped: 0, failed: 0 }

  return NextResponse.json({
    success: result.success,
    count: result.activitiesCount,
    activityIds: result.activityIds,
    reviews,
    errorMessage: result.errorMessage,
  })
})
