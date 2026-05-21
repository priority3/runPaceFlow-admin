/**
 * Conversion Goals Tracking
 *
 * Tracks predefined conversion goals and their completion rates.
 */

import { ensureSchema, getDb } from './db'

export interface ConversionGoal {
  id: string
  name: string
  path: string
  description: string
}

export interface ConversionResult {
  goal: ConversionGoal
  totalVisitors: number
  conversions: number
  conversionRate: number
  dailyConversions: Array<{ date: string; count: number }>
}

// Predefined conversion goals for RunPaceFlow
export const DEFAULT_GOALS: ConversionGoal[] = [
  {
    id: 'homepage_view',
    name: '首页浏览',
    path: '/',
    description: '用户访问首页',
  },
  {
    id: 'activities_view',
    name: '活动列表浏览',
    path: '/activities',
    description: '用户浏览活动列表',
  },
  {
    id: 'login_page',
    name: '登录页访问',
    path: '/login',
    description: '用户访问登录页面',
  },
]

export async function getConversionStats(days = 30): Promise<ConversionResult[]> {
  await ensureSchema()
  const db = getDb()

  const now = Math.floor(Date.now() / 1000)
  const startDay = now - (now % 86400) - (8 * 3600)
  const start = startDay - (days - 1) * 86400

  const results: ConversionResult[] = []

  for (const goal of DEFAULT_GOALS) {
    // Get total visitors who reached this path
    const visitorsResult = await db.execute({
      sql: `SELECT COUNT(DISTINCT visitor_id) as count
            FROM page_views
            WHERE path = ? AND created_at >= ?`,
      args: [goal.path, start],
    })

    // Get daily conversions
    const dailyResult = await db.execute({
      sql: `SELECT date(created_at, 'unixepoch', '+8 hours') as day, COUNT(DISTINCT visitor_id) as count
            FROM page_views
            WHERE path = ? AND created_at >= ?
            GROUP BY day
            ORDER BY day ASC`,
      args: [goal.path, start],
    })

    const totalVisitors = Number(visitorsResult.rows[0]?.count ?? 0)

    // For now, all visitors to the path count as conversions
    // This can be enhanced with actual conversion events
    const conversions = totalVisitors

    results.push({
      goal,
      totalVisitors,
      conversions,
      conversionRate: totalVisitors > 0 ? (conversions / totalVisitors) * 100 : 0,
      dailyConversions: dailyResult.rows.map(r => ({
        date: r.day as string,
        count: Number(r.count),
      })),
    })
  }

  return results
}
