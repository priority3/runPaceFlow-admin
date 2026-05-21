/**
 * Public Analytics Stats API
 *
 * GET /api/analytics/public
 * Returns a lightweight summary for embedding or public dashboards.
 * No auth required - only shows aggregate totals.
 */

import { NextResponse } from 'next/server'

import { getAnalyticsOverview, getTopPages, getDailyPageViews } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [overview, topPages, dailyViews] = await Promise.all([
      getAnalyticsOverview(),
      getTopPages(5),
      getDailyPageViews(7),
    ])

    return NextResponse.json(
      { overview, topPages, dailyViews },
      {
        headers: {
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  } catch {
    return NextResponse.json(
      { overview: { totalPageViews: 0, uniqueVisitors: 0, todayPageViews: 0, todayUniqueVisitors: 0, weeklyPageViews: 0, weeklyUniqueVisitors: 0 }, topPages: [], dailyViews: [] },
      { headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' } },
    )
  }
}
