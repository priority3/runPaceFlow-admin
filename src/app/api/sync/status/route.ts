/**
 * 同步状态 API
 *
 * GET /api/sync/status
 *
 * 返回 Strava 最近一次同步日志 + 凭据配置情况,供 admin UI 展示。
 */

import { desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getActivitiesDb } from '@/lib/db/activities-client'
import { syncLogs } from '@/lib/db/activities-schema'
import { getRuntimeSettings } from '@/lib/runtime-config'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async () => {
  const db = await getActivitiesDb()
  const settings = await getRuntimeSettings()

  const latest = async (source: string) => {
    const rows = await db
      .select()
      .from(syncLogs)
      .where(eq(syncLogs.source, source))
      .orderBy(desc(syncLogs.startedAt))
      .limit(1)
    return rows[0] || null
  }

  return NextResponse.json({
    strava: {
      hasCredentials: !!(
        settings.STRAVA_CLIENT_ID &&
        settings.STRAVA_CLIENT_SECRET &&
        settings.STRAVA_REFRESH_TOKEN
      ),
      latestSync: await latest('strava'),
    },
  })
})
