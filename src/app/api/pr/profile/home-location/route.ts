/**
 * 常跑地点面板 API:查看当前生效地点与来源、保存显式值、清除回退自动推导。
 * 数据落 friend_profile.home_location_json(画像数据,非服务配置),读写经 home-location helper;
 * 坐标/名称的合法性在这一层把关(表单只做体验性预检,不是防线)。
 */
import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getExplicitHomeLocation, upsertExplicitHomeLocation } from '@/lib/pr/home-location'
import { getHomeLocation, invalidateHomeLocationCache } from '@/lib/pr/providers/environment'

export const dynamic = 'force-dynamic'

/**
 * 读当前地点状态,GET/PUT/DELETE 共用的响应形状。
 * Reason: 面板要看的是当下真相,不是 TTL 缓存里的旧地点——取 effective 前先失效缓存;
 * 写路径(PUT/DELETE)复用同一入口,失效发生在 upsert 之后,天然满足「写后失效」,
 * 同进程的聊天上下文下一次构建即用新地点。
 */
async function readLocationState() {
  invalidateHomeLocationCache()
  const [explicit, effective] = await Promise.all([getExplicitHomeLocation(), getHomeLocation()])
  return {
    explicit,
    effective,
    source: explicit ? ('explicit' as const) : effective ? ('derived' as const) : ('none' as const),
  }
}

/**
 * 宽松取坐标:接受 number 或非空数字字符串,其余一律 NaN。
 * Reason: Number('') 与 Number(null) 都是 0——空字段静默落成 (0,0) 的海上坐标,必须挡掉。
 */
function toCoord(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}

export const GET = withAuth(async () => NextResponse.json(await readLocationState()))

export const PUT = withAuth(async request => {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const lat = toCoord(body.lat)
  const lng = toCoord(body.lng)
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
    return NextResponse.json({ error: '纬度需为 -90 ~ 90 的数字' }, { status: 400 })
  }
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) {
    return NextResponse.json({ error: '经度需为 -180 ~ 180 的数字' }, { status: 400 })
  }
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (label.length > 30) {
    return NextResponse.json({ error: '地点名称最多 30 字' }, { status: 400 })
  }

  await upsertExplicitHomeLocation({ lat, lng, ...(label ? { label } : {}) })
  return NextResponse.json(await readLocationState())
})

export const DELETE = withAuth(async () => {
  await upsertExplicitHomeLocation(null)
  return NextResponse.json(await readLocationState())
})
