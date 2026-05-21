/**
 * Conversion Funnel Analysis
 *
 * Analyzes user journeys through predefined page sequences.
 * Helps identify drop-off points in key user flows.
 */

import { ensureSchema, getDb } from './db'

export interface FunnelStep {
  path: string
  label: string
}

export interface FunnelResult {
  name: string
  steps: Array<{
    path: string
    label: string
    visitors: number
    dropoffRate: number
  }>
  conversionRate: number
  totalVisitors: number
}

// Predefined funnels for RunPaceFlow
export const DEFAULT_FUNNELS: Array<{ name: string; steps: FunnelStep[] }> = [
  {
    name: '首页 → 活动详情',
    steps: [
      { path: '/', label: '首页' },
      { path: '/activities', label: '活动列表' },
    ],
  },
  {
    name: '注册/登录流程',
    steps: [
      { path: '/', label: '首页' },
      { path: '/login', label: '登录页' },
    ],
  },
]

export async function analyzeFunnel(
  steps: FunnelStep[],
  days = 30,
): Promise<FunnelResult> {
  await ensureSchema()
  const db = getDb()

  const now = Math.floor(Date.now() / 1000)
  const startDay = now - (now % 86400) - (8 * 3600)
  const start = startDay - days * 86400

  const result: FunnelResult = {
    name: steps.map(s => s.label).join(' → '),
    steps: [],
    conversionRate: 0,
    totalVisitors: 0,
  }

  let prevVisitors = 0

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]

    // Count unique visitors who visited this path
    const visitorsResult = await db.execute({
      sql: `SELECT COUNT(DISTINCT visitor_id) as count
            FROM page_views
            WHERE path = ? AND created_at >= ?`,
      args: [step.path, start],
    })

    const visitors = Number(visitorsResult.rows[0]?.count ?? 0)

    // Calculate dropoff from previous step
    const dropoffRate = i === 0 ? 0 : prevVisitors > 0
      ? ((prevVisitors - visitors) / prevVisitors) * 100
      : 0

    result.steps.push({
      path: step.path,
      label: step.label,
      visitors,
      dropoffRate: Math.round(dropoffRate * 10) / 10,
    })

    if (i === 0) {
      result.totalVisitors = visitors
    }

    prevVisitors = visitors
  }

  // Overall conversion rate
  result.conversionRate = result.totalVisitors > 0
    ? Math.round((result.steps[result.steps.length - 1].visitors / result.totalVisitors) * 1000) / 10
    : 0

  return result
}

export async function analyzeAllFunnels(days = 30): Promise<FunnelResult[]> {
  return Promise.all(
    DEFAULT_FUNNELS.map(funnel => analyzeFunnel(funnel.steps, days))
  )
}
