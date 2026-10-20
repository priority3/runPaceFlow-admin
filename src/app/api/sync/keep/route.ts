/**
 * Keep 同步 API(默认同步源)
 *
 * POST /api/sync/keep
 * Body: { limit?: number, fullSync?: boolean, probe?: boolean }
 *
 * - probe=true:干跑,不写库,直接拉最近几条返回映射后的字段(校验单位/轨迹是否完整)。
 *   再加 diagnostics=true 时附带 Keep 原始列表条目与原始轨迹点样本,用于排查漏同步与时间戳单位。
 *   可在 body 传 mobile/password 用**未保存的草稿凭据**测试(配置页「测试连接」就是这么用的:
 *   先测通再保存,而不是把可能错的凭据先写进库);两者缺省时回落已保存的配置。
 * - 否则:performSync 增量同步 Keep → 写活动库 → 响应;PR 跑后复盘随后在后台生成
 *   (不阻塞响应,原因见下面 fire-and-forget 处的注释)。
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
  let body: { limit?: number; fullSync?: boolean; probe?: boolean; diagnostics?: boolean; mobile?: string; password?: string } = {}
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
    // diagnostics:额外返回 Keep 的原始列表与轨迹点样本(见 KeepAdapter.probeDiagnostics)。
    // 显式请求才跑:它要多拉几次详情,常规的「测试连接」不需要。
    const diagnostics = body.diagnostics === true ? await adapter.probeDiagnostics() : undefined
    return NextResponse.json({
      probe: true,
      diagnostics,
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

  // Reason: 复盘生成是 LLM 慢活(每条新活动一次调用,还要过评审与可能的重写),而本端点同时
  // 是对话内「同步一下」的上游 —— pr-agent 侧工具只有 20s 超时。把它串在响应之前,只要这次
  // 真的拉到新活动就必然超时,对话里只能反复说「正在拉/还在跑」,用户永远拿不到结果
  // (2026-10-16 线上对话实测)。改为 fire-and-forget:响应只等到数据入库,复盘随后自己生成完
  // —— 与同文件 performSync 内 mirrorActivitiesToTurso 的处理方式一致。
  if (result.success && result.activityIds.length > 0) {
    void requestPrReviewBatch(result.activityIds).catch(error =>
      console.warn('[sync/keep] 复盘批量生成失败(数据已入库,不影响本次同步结果):', (error as Error).message),
    )
  }

  return NextResponse.json({
    success: result.success,
    count: result.activitiesCount,
    activityIds: result.activityIds,
    errorMessage: result.errorMessage,
  })
})
