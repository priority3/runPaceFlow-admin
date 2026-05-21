/**
 * Analytics Insights Engine
 *
 * Rule-based detection of significant patterns in analytics data.
 * Generates actionable insight cards for the dashboard.
 * No external AI dependency — pure data analysis.
 */

import { ensureSchema, getDb } from './db'

export interface Insight {
  id: string
  type: 'traffic' | 'performance' | 'audience' | 'content' | 'warning'
  severity: 'info' | 'positive' | 'negative' | 'critical'
  title: string
  description: string
  metric?: string
  value?: string
  trend?: 'up' | 'down' | 'stable'
}

function todayStart(): number {
  const now = Math.floor(Date.now() / 1000)
  return now - (now % 86400) - (8 * 3600)
}

function insightId(prefix: string): string {
  return `insight_${prefix}_${Date.now().toString(36)}`
}

export async function generateInsights(): Promise<Insight[]> {
  await ensureSchema()
  const db = getDb()
  const insights: Insight[] = []

  const ts = todayStart()
  const yesterdayStart = ts - 86400
  const weekAgo = ts - 7 * 86400
  const twoWeeksAgo = ts - 14 * 86400

  // ─── Traffic Anomaly Detection ───────────────────────────────────────────
  const [todayTraffic, yesterdayTraffic, lastWeekTraffic] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as visitors FROM page_views WHERE created_at >= ?`,
      args: [ts],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as visitors FROM page_views WHERE created_at >= ? AND created_at < ?`,
      args: [yesterdayStart, ts],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as visitors FROM page_views WHERE created_at >= ? AND created_at < ?`,
      args: [weekAgo, yesterdayStart],
    }),
  ])

  const todayViews = Number(todayTraffic.rows[0]?.views ?? 0)
  const yesterdayViews = Number(yesterdayTraffic.rows[0]?.views ?? 0)
  const lastWeekAvg = Number(lastWeekTraffic.rows[0]?.views ?? 0) // ~7 days worth

  // Traffic spike or drop detection
  if (yesterdayViews > 0) {
    const change = ((todayViews - yesterdayViews) / yesterdayViews) * 100
    if (Math.abs(change) > 30) {
      insights.push({
        id: insightId('traffic'),
        type: 'traffic',
        severity: change > 0 ? 'positive' : 'negative',
        title: change > 0 ? '流量显著增长' : '流量明显下降',
        description: `今日 PV ${todayViews}，较昨日${change > 0 ? '增长' : '下降'} ${Math.abs(change).toFixed(0)}%`,
        metric: 'PV 变化',
        value: `${change > 0 ? '+' : ''}${change.toFixed(0)}%`,
        trend: change > 0 ? 'up' : 'down',
      })
    }
  }

  // Weekly comparison
  if (lastWeekAvg > 0 && todayViews > 0) {
    const dailyAvg = lastWeekAvg / 7
    const weeklyChange = ((todayViews - dailyAvg) / dailyAvg) * 100
    if (Math.abs(weeklyChange) > 20) {
      insights.push({
        id: insightId('weekly'),
        type: 'traffic',
        severity: weeklyChange > 0 ? 'positive' : 'info',
        title: weeklyChange > 0 ? '高于周均水平' : '低于周均水平',
        description: `今日 PV ${todayViews}，周均 ${Math.round(dailyAvg)}`,
        metric: 'vs 周均',
        value: `${weeklyChange > 0 ? '+' : ''}${weeklyChange.toFixed(0)}%`,
        trend: weeklyChange > 0 ? 'up' : 'down',
      })
    }
  }

  // ─── Device Distribution Shift ───────────────────────────────────────────
  const [recentDevices, prevDevices] = await Promise.all([
    db.execute({
      sql: `SELECT COALESCE(device_type, 'unknown') as device, COUNT(*) as views
            FROM page_views WHERE created_at >= ? AND device_type IS NOT NULL
            GROUP BY device ORDER BY views DESC`,
      args: [yesterdayStart],
    }),
    db.execute({
      sql: `SELECT COALESCE(device_type, 'unknown') as device, COUNT(*) as views
            FROM page_views WHERE created_at >= ? AND created_at < ? AND device_type IS NOT NULL
            GROUP BY device ORDER BY views DESC`,
      args: [weekAgo, yesterdayStart],
    }),
  ])

  const recentTotal = recentDevices.rows.reduce((sum, r) => sum + Number(r.views), 0)
  const prevTotal = prevDevices.rows.reduce((sum, r) => sum + Number(r.views), 0)

  if (recentTotal > 10 && prevTotal > 10) {
    for (const device of recentDevices.rows) {
      const recentPct = Number(device.views) / recentTotal
      const prevRow = prevDevices.rows.find(r => r.device === device.device)
      const prevPct = prevRow ? Number(prevRow.views) / prevTotal : 0
      const shift = (recentPct - prevPct) * 100

      if (Math.abs(shift) > 10) {
        const label = device.device === 'desktop' ? '桌面端' : device.device === 'mobile' ? '移动端' : device.device === 'tablet' ? '平板' : String(device.device)
        insights.push({
          id: insightId(`device_${device.device}`),
          type: 'audience',
          severity: 'info',
          title: `${label}占比变化`,
          description: `${label}占比从 ${(prevPct * 100).toFixed(0)}% 变为 ${(recentPct * 100).toFixed(0)}%`,
          metric: label,
          value: `${shift > 0 ? '+' : ''}${shift.toFixed(1)}%`,
          trend: shift > 0 ? 'up' : 'down',
        })
      }
    }
  }

  // ─── Top Content Engagement ──────────────────────────────────────────────
  const topPages = await db.execute({
    sql: `SELECT path, COUNT(*) as views, COUNT(DISTINCT visitor_id) as visitors,
            AVG(scroll_depth) as avg_scroll, AVG(load_time) as avg_load
          FROM page_views WHERE created_at >= ? AND path != '/'
          GROUP BY path ORDER BY views DESC LIMIT 5`,
    args: [weekAgo],
  })

  for (const page of topPages.rows) {
    const avgScroll = Number(page.avg_scroll)
    const avgLoad = Number(page.avg_load)
    const views = Number(page.views)

    if (avgScroll > 0 && avgScroll < 30 && views > 5) {
      insights.push({
        id: insightId(`scroll_${page.path}`),
        type: 'content',
        severity: 'negative',
        title: `页面跳出率高`,
        description: `${page.path} 平均滚动深度仅 ${avgScroll.toFixed(0)}%，${views} 次访问`,
        metric: '滚动深度',
        value: `${avgScroll.toFixed(0)}%`,
        trend: 'down',
      })
    }

    if (avgLoad > 3000 && views > 5) {
      insights.push({
        id: insightId(`load_${page.path}`),
        type: 'performance',
        severity: 'negative',
        title: `页面加载偏慢`,
        description: `${page.path} 平均加载 ${Math.round(avgLoad)}ms`,
        metric: '加载时间',
        value: `${Math.round(avgLoad)}ms`,
        trend: 'down',
      })
    }
  }

  // ─── Geographic Concentration ────────────────────────────────────────────
  const geoData = await db.execute({
    sql: `SELECT COALESCE(country, 'Unknown') as country, COUNT(*) as views
          FROM page_views WHERE created_at >= ? AND country IS NOT NULL
          GROUP BY country ORDER BY views DESC LIMIT 5`,
    args: [weekAgo],
  })

  const totalGeoViews = geoData.rows.reduce((sum, r) => sum + Number(r.views), 0)
  if (totalGeoViews > 0 && geoData.rows.length > 0) {
    const topCountry = geoData.rows[0]
    const topPct = (Number(topCountry.views) / totalGeoViews) * 100
    if (topPct > 80) {
      insights.push({
        id: insightId('geo_concentration'),
        type: 'audience',
        severity: 'info',
        title: '访客地域集中',
        description: `${topCountry.country} 占总流量 ${topPct.toFixed(0)}%`,
        metric: '地域集中度',
        value: `${topPct.toFixed(0)}%`,
      })
    }
  }

  // ─── No Data Warning ─────────────────────────────────────────────────────
  if (todayViews === 0 && yesterdayViews === 0) {
    insights.push({
      id: insightId('no_data'),
      type: 'warning',
      severity: 'critical',
      title: '无访问数据',
      description: '近 2 天无任何访问记录，请检查前端 NEXT_PUBLIC_ADMIN_URL 配置',
      metric: '状态',
      value: '无数据',
    })
  }

  // ─── Bounce Rate ─────────────────────────────────────────────────────────
  const sessionData = await db.execute({
    sql: `SELECT
            COUNT(DISTINCT COALESCE(session_id, visitor_id)) as sessions,
            COUNT(DISTINCT path) as unique_paths,
            COUNT(*) as total_views
          FROM page_views WHERE created_at >= ?`,
    args: [yesterdayStart],
  })

  const sessions = Number(sessionData.rows[0]?.sessions ?? 0)
  const totalViews = Number(sessionData.rows[0]?.total_views ?? 0)
  if (sessions > 0) {
    const avgPages = totalViews / sessions
    if (avgPages < 1.5 && sessions > 5) {
      insights.push({
        id: insightId('bounce'),
        type: 'content',
        severity: 'negative',
        title: '跳出率偏高',
        description: `平均每会话仅 ${avgPages.toFixed(1)} 页，${sessions} 个会话`,
        metric: '页/会话',
        value: avgPages.toFixed(1),
        trend: 'down',
      })
    }
  }

  return insights.slice(0, 10) // Max 10 insights
}
