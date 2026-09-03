/**
 * Keep 同步 API(默认同步源)
 *
 * POST /api/sync/keep
 * Body: { limit?: number, fullSync?: boolean, probe?: boolean }
 *
 * - probe=true:干跑,不写库,直接拉最近几条返回映射后的字段(校验单位/轨迹是否完整)。
 *   可在 body 传 mobile/password 用**未保存的草稿凭据**测试(配置页「测试连接」就是这么用的:
 *   先测通再保存,而不是把可能错的凭据先写进库);两者缺省时回落已保存的配置。
 * - 否则:performSync 增量同步 Keep → 写活动库 → 触发 PR 跑后复盘。
 */
import { NextResponse } from 'next/server'

import { withSyncTriggerAuth } from '@/lib/api-helpers'
import { requestPrReviewBatch } from '@/lib/pr-agent-client'
import { getRuntimeSettings } from '@/lib/runtime-config'
import { KeepAdapter } from '@/lib/sync/adapters/keep'
import { performSync } from '@/lib/sync/service'

export const dynamic = 'force-dynamic'

// 鉴权:admin 会话(面板 / 配置页测试连接)或 Bearer SYNC_TRIGGER_TOKEN
// (pr-agent 在对话里说「同步一下」时打过来,服务端到服务端拿不到会话 cookie)。
export const POST = withSyncTriggerAuth(async (request) => {
  let body: { limit?: number; fullSync?: boolean; probe?: boolean; mobile?: string; password?: string } = {}
  try {
    body = await request.json()
  } catch {
    // 允许空 body
  }

  if (body.probe) {
    // 草稿优先:body 里带了就用它(配置页未保存的输入值),否则回落已保存的配置。
    const draftMobile = typeof body.mobile === 'string' ? body.mobile.trim() : ''
    const draftPassword = typeof body.password === 'string' ? body.password.trim() : ''
    let mobile = draftMobile
    let password = draftPassword
    if (!mobile || !password) {
      const settings = await getRuntimeSettings({ force: true })
      mobile = mobile || settings.KEEP_MOBILE
      password = password || settings.KEEP_PASSWORD
    }
    if (!mobile || !password) {
      return NextResponse.json(
        { error: 'Keep 手机号与密码都要填(输入框里填上即可测,不必先保存)' },
        { status: 400 },
      )
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
      ? await requestPrReviewBatch(result.activityIds)
      : { generated: 0, skipped: 0, failed: 0, notified: 0 }

  return NextResponse.json({
    success: result.success,
    count: result.activitiesCount,
    activityIds: result.activityIds,
    reviews,
    errorMessage: result.errorMessage,
  })
})
