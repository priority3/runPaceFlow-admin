/**
 * Analytics Widget API
 *
 * GET /api/analytics/widget
 * Returns a lightweight JSON response for embedding in iframes or widgets.
 * No auth required - only shows aggregate totals.
 */

import { NextResponse } from 'next/server'

import { getAnalyticsOverview, getTopPages } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [overview, topPages] = await Promise.all([
      getAnalyticsOverview(),
      getTopPages(5),
    ])

    return NextResponse.json(
      {
        widget: 'runpaceflow-analytics',
        version: '1.0',
        overview: {
          totalViews: overview.totalPageViews,
          uniqueVisitors: overview.uniqueVisitors,
          todayViews: overview.todayPageViews,
          todayVisitors: overview.todayUniqueVisitors,
        },
        topPages: topPages.map(p => ({
          path: p.path,
          views: p.views,
        })),
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  } catch {
    return NextResponse.json(
      {
        widget: 'runpaceflow-analytics',
        version: '1.0',
        overview: { totalViews: 0, uniqueVisitors: 0, todayViews: 0, todayVisitors: 0 },
        topPages: [],
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  }
}
