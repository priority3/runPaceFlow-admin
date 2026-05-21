/**
 * Analytics Health API
 *
 * GET /api/analytics/health
 * Returns beacon reception status and connectivity diagnostics.
 * Helps debug "no data" issues.
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { ensureSchema, getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async () => {
  await ensureSchema()
  const db = getDb()

  const now = Math.floor(Date.now() / 1000)
  const fiveMinAgo = now - 300
  const oneHourAgo = now - 3600
  const oneDayAgo = now - 86400

  const [recentBeacons, hourlyBeacons, dailyBeacons, lastBeacon, recentErrors, recentClicks] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as count FROM page_views WHERE created_at >= ?`,
      args: [fiveMinAgo],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as count FROM page_views WHERE created_at >= ?`,
      args: [oneHourAgo],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as count FROM page_views WHERE created_at >= ?`,
      args: [oneDayAgo],
    }),
    db.execute({
      sql: `SELECT created_at FROM page_views ORDER BY created_at DESC LIMIT 1`,
      args: [],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as count FROM error_events WHERE created_at >= ?`,
      args: [oneHourAgo],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as count FROM click_events WHERE created_at >= ?`,
      args: [oneHourAgo],
    }),
  ])

  const lastBeaconTs = lastBeacon.rows[0]?.created_at as number | null
  const beaconCount5m = Number(recentBeacons.rows[0]?.count ?? 0)
  const beaconCount1h = Number(hourlyBeacons.rows[0]?.count ?? 0)
  const beaconCount1d = Number(dailyBeacons.rows[0]?.count ?? 0)
  const errorCount1h = Number(recentErrors.rows[0]?.count ?? 0)
  const clickCount1h = Number(recentClicks.rows[0]?.count ?? 0)

  // Determine health status
  let status: 'healthy' | 'warning' | 'critical' | 'no_data'
  let message: string

  if (beaconCount1d === 0) {
    status = 'no_data'
    message = '未收到任何信标数据 — 请检查前端 NEXT_PUBLIC_ADMIN_URL 配置'
  } else if (beaconCount5m === 0 && lastBeaconTs && now - lastBeaconTs > 600) {
    status = 'warning'
    message = `最近 ${Math.round((now - lastBeaconTs) / 60)} 分钟无信标 — 前端可能无活跃用户或信标中断`
  } else if (beaconCount5m > 0) {
    status = 'healthy'
    message = '信标接收正常'
  } else {
    status = 'healthy'
    message = '数据正常'
  }

  return NextResponse.json({
    status,
    message,
    beacons: {
      last5min: beaconCount5m,
      last1h: beaconCount1h,
      last1d: beaconCount1d,
      lastTimestamp: lastBeaconTs ? new Date(lastBeaconTs * 1000).toISOString() : null,
    },
    errors: { last1h: errorCount1h },
    clicks: { last1h: clickCount1h },
    timestamp: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
})
