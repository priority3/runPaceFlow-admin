/**
 * Analytics Insights API
 *
 * GET /api/analytics/insights
 * Returns auto-generated insights from analytics data.
 * No auth required for lightweight polling.
 */

import { NextResponse } from 'next/server'

import { generateInsights } from '@/lib/analytics-insights'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const insights = await generateInsights()
    return NextResponse.json(
      { insights },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      { insights: [], error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    )
  }
}
