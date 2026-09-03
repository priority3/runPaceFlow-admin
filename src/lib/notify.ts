/**
 * PushPlus Notification Service
 *
 * Sends notifications via PushPlus (pushplus.plus) - WeChat/email/SMS push service.
 */

import { getDb } from './db'

const PUSHPLUS_API = 'https://www.pushplus.plus/send'

// ─── PushPlus API ───────────────────────────────────────────────────────────

export async function sendPushPlus(
  token: string,
  title: string,
  content: string,
): Promise<{ success: boolean; message?: string }> {
  const res = await fetch(PUSHPLUS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, title, content, template: 'html' }),
  })

  const data = await res.json()
  if (data.code !== 200) {
    return { success: false, message: data.msg || 'PushPlus API error' }
  }
  return { success: true }
}

// ─── Activity Notification ──────────────────────────────────────────────────

interface SyncedActivity {
  id: string
  title: string
  type: string
  distance: number
  duration: number
  average_pace: number | null
  source: string
}

function formatDurationShort(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h${m}m`
  return `${m}m`
}

function formatPaceShort(pace: number | null): string {
  if (!pace) return '-'
  const m = Math.floor(pace / 60)
  const s = Math.floor(pace % 60)
  return `${m}'${s.toString().padStart(2, '0')}"`
}

function formatDistanceKm(meters: number): string {
  return `${(meters / 1000).toFixed(2)}`
}

/**
 * Generate notification content for newly synced activities.
 */
export function generateActivityNotification(
  activities: SyncedActivity[],
): { title: string; content: string } {
  const totalCount = activities.length
  const runningCount = activities.filter((a) => a.type === 'running').length
  const cyclingCount = activities.filter((a) => a.type === 'cycling').length

  const totalDistance = activities.reduce((sum, a) => sum + a.distance, 0)
  const totalDuration = activities.reduce((sum, a) => sum + a.duration, 0)

  const typeBreakdown = []
  if (runningCount > 0) typeBreakdown.push(`跑步 ${runningCount} 条`)
  if (cyclingCount > 0) typeBreakdown.push(`骑行 ${cyclingCount} 条`)

  const activityList = activities
    .map(
      (a) =>
        `<li>${a.type === 'running' ? '🏃' : '🚴'} <b>${a.title}</b> - ${formatDistanceKm(a.distance)}km / ${formatDurationShort(a.duration)} / ${formatPaceShort(a.average_pace)}/km</li>`,
    )
    .join('')

  const title = `🏃 新增 ${totalCount} 条运动记录`
  const content = `
<h2>🏃 新增运动记录</h2>
<p>📅 ${new Date().toLocaleDateString('zh-CN')}</p>
<hr>
<h3>📊 同步概况</h3>
<ul>
  <li>新增活动: <b>${totalCount}</b> 条</li>
  <li>${typeBreakdown.join(' | ')}</li>
  <li>总距离: <b>${formatDistanceKm(totalDistance)} km</b></li>
  <li>总时长: <b>${formatDurationShort(totalDuration)}</b></li>
</ul>
<h3>📋 活动列表</h3>
<ul>${activityList}</ul>
<hr>
<p><small>由 RunPaceFlow Admin 推送</small></p>
`

  return { title, content }
}

// ─── Analytics Digest ──────────────────────────────────────────────────────

/**
 * Generate daily analytics digest for the frontend.
 */
export async function generateAnalyticsDigest(): Promise<{ title: string; content: string }> {
  const db = getDb()

  const now = Math.floor(Date.now() / 1000)
  const todayStart = now - (now % 86400) - (8 * 3600)
  const yesterdayStart = todayStart - 86400
  const weekAgo = todayStart - 7 * 86400

  const [todayResult, yesterdayResult, weekResult, topPagesResult, deviceResult, countryResult, perfResult] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as visitors FROM page_views WHERE created_at >= ?`,
      args: [todayStart],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as visitors FROM page_views WHERE created_at >= ? AND created_at < ?`,
      args: [yesterdayStart, todayStart],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as views, COUNT(DISTINCT visitor_id) as visitors FROM page_views WHERE created_at >= ?`,
      args: [weekAgo],
    }),
    db.execute({
      sql: `SELECT path, COUNT(*) as views FROM page_views WHERE created_at >= ? GROUP BY path ORDER BY views DESC LIMIT 5`,
      args: [yesterdayStart],
    }),
    db.execute({
      sql: `SELECT COALESCE(device_type, 'unknown') as device, COUNT(*) as views
            FROM page_views WHERE created_at >= ? AND device_type IS NOT NULL
            GROUP BY device ORDER BY views DESC LIMIT 3`,
      args: [yesterdayStart],
    }),
    db.execute({
      sql: `SELECT COALESCE(country, 'Unknown') as country, COUNT(*) as views
            FROM page_views WHERE created_at >= ? AND country IS NOT NULL
            GROUP BY country ORDER BY views DESC LIMIT 3`,
      args: [yesterdayStart],
    }),
    db.execute({
      sql: `SELECT AVG(load_time) as avg_load, AVG(scroll_depth) as avg_scroll
            FROM page_views WHERE created_at >= ? AND load_time IS NOT NULL`,
      args: [yesterdayStart],
    }),
  ])

  const today = todayResult.rows[0]
  const yesterday = yesterdayResult.rows[0]
  const week = weekResult.rows[0]
  const topPages = topPagesResult.rows
  const devices = deviceResult.rows
  const countries = countryResult.rows
  const perf = perfResult.rows[0]

  const todayViews = Number(today?.views ?? 0)
  const yesterdayViews = Number(yesterday?.views ?? 0)
  const delta = yesterdayViews > 0
    ? ((todayViews - yesterdayViews) / yesterdayViews * 100).toFixed(0)
    : 'N/A'

  const topPagesHtml = topPages.length > 0
    ? topPages.map((p, i) => `<li>${i + 1}. ${p.path} — ${p.views} PV</li>`).join('')
    : '<li>暂无数据</li>'

  const deviceLabel: Record<string, string> = { desktop: '桌面端', mobile: '移动端', tablet: '平板' }
  const deviceHtml = devices.length > 0
    ? devices.map(d => `<li>${deviceLabel[d.device as string] ?? d.device}: ${d.views} PV</li>`).join('')
    : '<li>暂无数据</li>'

  const countryHtml = countries.length > 0
    ? countries.map(c => `<li>${c.country}: ${c.views} PV</li>`).join('')
    : '<li>暂无数据</li>'

  const avgLoad = perf?.avg_load != null ? `${Math.round(Number(perf.avg_load))}ms` : '-'
  const avgScroll = perf?.avg_scroll != null ? `${Math.round(Number(perf.avg_scroll))}%` : '-'

  const title = `📊 访问日报 - ${new Date().toLocaleDateString('zh-CN')}`
  const content = `
<h2>📊 每日访问报告</h2>
<p>📅 ${new Date().toLocaleDateString('zh-CN')}</p>
<hr>
<h3>📈 今日概况</h3>
<ul>
  <li>今日 PV: <b>${todayViews}</b></li>
  <li>今日 UV: <b>${Number(today?.visitors ?? 0)}</b></li>
  <li>日环比: <b>${delta === 'N/A' ? '无数据' : `${Number(delta) >= 0 ? '+' : ''}${delta}%`}</b></li>
</ul>
<h3>📅 昨日数据</h3>
<ul>
  <li>PV: ${yesterdayViews}</li>
  <li>UV: ${Number(yesterday?.visitors ?? 0)}</li>
</ul>
<h3>📆 近 7 天</h3>
<ul>
  <li>总 PV: <b>${Number(week?.views ?? 0)}</b></li>
  <li>总 UV: <b>${Number(week?.visitors ?? 0)}</b></li>
</ul>
<h3>🏆 昨日热门页面</h3>
<ol>${topPagesHtml}</ol>
<h3>📱 设备分布</h3>
<ul>${deviceHtml}</ul>
<h3>🌍 地域分布</h3>
<ul>${countryHtml}</ul>
<h3>⚡ 性能指标</h3>
<ul>
  <li>平均加载时间: <b>${avgLoad}</b></li>
  <li>平均滚动深度: <b>${avgScroll}</b></li>
</ul>
<hr>
<p><small>由 RunPaceFlow Analytics 推送</small></p>
`

  return { title, content }
}

// ─── Daily Report ───────────────────────────────────────────────────────────

/**
 * Generate daily training report.
 */
export async function generateDailyReport(): Promise<{ title: string; content: string }> {
  const db = getDb()

  // 「今天」按容器时区的日界算(compose 里设了 TZ=Asia/Shanghai,即北京 00:00)。
  // Reason: 此前容器 TZ 未设 = UTC,日界落在北京 08:00 —— 早于 8 点的晨跑会被算进前一天。
  const todayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000)
  const todayEnd = todayStart + 86400

  const todayResult = await db.execute({
    sql: `SELECT * FROM activities WHERE start_time >= ? AND start_time < ? ORDER BY start_time`,
    args: [todayStart, todayEnd],
  })
  const todayActivities = todayResult.rows as any[]

  // This week
  const weekStart = todayStart - ((new Date().getDay() + 6) % 7) * 86400
  const weekResult = await db.execute({
    sql: `SELECT COUNT(*) as count, COALESCE(SUM(distance),0) as distance, COALESCE(SUM(duration),0) as duration
          FROM activities WHERE start_time >= ?`,
    args: [weekStart],
  })
  const weekStats = weekResult.rows[0]

  // This month
  const monthStart = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000)
  const monthResult = await db.execute({
    sql: `SELECT COUNT(*) as count, COALESCE(SUM(distance),0) as distance, COALESCE(SUM(duration),0) as duration
          FROM activities WHERE start_time >= ?`,
    args: [monthStart],
  })
  const monthStats = monthResult.rows[0]

  // AI insights generated today
  const insightsResult = await db.execute({
    sql: `SELECT COUNT(*) as count FROM activity_insights WHERE generated_at >= ? AND generated_at < ?`,
    args: [todayStart, todayEnd],
  })
  const insightsCount = Number(insightsResult.rows[0]?.count ?? 0)

  const todayCount = todayActivities.length
  const todayDistance = todayActivities.reduce((sum: number, a: any) => sum + (a.distance || 0), 0)
  const todayDuration = todayActivities.reduce((sum: number, a: any) => sum + (a.duration || 0), 0)

  const title = `📊 训练日报 - ${new Date().toLocaleDateString('zh-CN')}`

  let content = `
<h2>📊 每日训练报告</h2>
<p>📅 ${new Date().toLocaleDateString('zh-CN')} ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p>
<hr>
`

  if (todayCount > 0) {
    const runningToday = todayActivities.filter((a: any) => a.type === 'running').length
    const cyclingToday = todayActivities.filter((a: any) => a.type === 'cycling').length
    const typeInfo = []
    if (runningToday > 0) typeInfo.push(`跑步 ${runningToday}`)
    if (cyclingToday > 0) typeInfo.push(`骑行 ${cyclingToday}`)

    content += `
<h3>🏃 今日训练</h3>
<ul>
  <li>活动数量: <b>${todayCount}</b> 条 (${typeInfo.join(', ')})</li>
  <li>总距离: <b>${(todayDistance / 1000).toFixed(2)} km</b></li>
  <li>总时长: <b>${formatDurationShort(todayDuration)}</b></li>
</ul>
`
  } else {
    content += `
<h3>🏃 今日训练</h3>
<p>今天还没有运动记录</p>
`
  }

  content += `
<h3>📈 本周累计</h3>
<ul>
  <li>活动: <b>${Number(weekStats?.count ?? 0)}</b> 条</li>
  <li>距离: <b>${(Number(weekStats?.distance ?? 0) / 1000).toFixed(2)} km</b></li>
  <li>时长: <b>${formatDurationShort(Number(weekStats?.duration ?? 0))}</b></li>
</ul>

<h3>📅 本月累计</h3>
<ul>
  <li>活动: <b>${Number(monthStats?.count ?? 0)}</b> 条</li>
  <li>距离: <b>${(Number(monthStats?.distance ?? 0) / 1000).toFixed(2)} km</b></li>
  <li>时长: <b>${formatDurationShort(Number(monthStats?.duration ?? 0))}</b></li>
</ul>

<h3>🤖 AI 分析</h3>
<p>今日生成 <b>${insightsCount}</b> 条活动分析</p>
<hr>
<p><small>由 RunPaceFlow Admin 推送</small></p>
`

  return { title, content }
}
