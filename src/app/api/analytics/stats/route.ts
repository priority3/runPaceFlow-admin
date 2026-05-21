/**
 * Analytics Stats API
 *
 * GET /api/analytics/stats
 * Returns aggregated analytics data. Requires auth.
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import {
  detectTrafficAnomaly,
  getAnalyticsOverview,
  getBrowserStats,
  getCityStats,
  getCountryStats,
  getDailyPageViews,
  getDeviceStats,
  getExitPages,
  getHourlyStats,
  getLanguageStats,
  getOSStats,
  getPageFlows,
  getPerformanceStats,
  getRealtimeVisitors,
  getReferrerDomainStats,
  getReferrerStats,
  getSessionStats,
  getTimezoneStats,
  getTopPages,
  getWeekComparison,
} from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(Number(searchParams.get('days') || '14'), 1), 90)

  const [overview, topPages, dailyViews, referrers, referrerDomains, browsers, os, devices, countries, cities, realtime, sessions, hourly, exitPages, weekComparison, languages, timezones, anomaly, pageFlows, performance] = await Promise.all([
    getAnalyticsOverview(),
    getTopPages(15),
    getDailyPageViews(days),
    getReferrerStats(10),
    getReferrerDomainStats(10),
    getBrowserStats(10),
    getOSStats(10),
    getDeviceStats(),
    getCountryStats(15),
    getCityStats(15),
    getRealtimeVisitors(5),
    getSessionStats(days),
    getHourlyStats(days),
    getExitPages(10),
    getWeekComparison(),
    getLanguageStats(10),
    getTimezoneStats(10),
    detectTrafficAnomaly(),
    getPageFlows(15),
    getPerformanceStats(days),
  ])

  return NextResponse.json(
    { overview, topPages, dailyViews, referrers, referrerDomains, browsers, os, devices, countries, cities, realtime, sessions, hourly, exitPages, weekComparison, languages, timezones, anomaly, pageFlows, performance },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
