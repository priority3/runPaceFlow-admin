import { NextResponse } from 'next/server'

import type { Client } from '@libsql/client'

import { withAuth } from '@/lib/api-helpers'
import { ensureSchema, getDb } from '@/lib/db'
import { getActivitiesClient } from '@/lib/db/activities-client'

export const dynamic = 'force-dynamic'

const DAYS = 14
const SHIFT = 8 * 3600
const ROW_LIMIT = 500

type Row = Record<string, unknown>
type EventType = 'sync' | 'chat' | 'activity' | 'review' | 'agent_run' | 'page_view' | 'config_change' | 'job_run'

interface PulseEvent {
  id: string
  type: EventType
  at: string
  title: string
  detail?: string
}

interface SourceResult {
  latest: string | null
  daily: Record<string, number>
  events: PulseEvent[]
}

function str(value: unknown): string {
  return value == null ? '' : String(value)
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 与 SQL 的 date(col,'unixepoch','+8 hours') 等价的 UTC+8 日界 */
function dayOf(sec: number): string {
  return new Date((sec + SHIFT) * 1000).toISOString().slice(0, 10)
}

function dateKeys(): string[] {
  const now = Math.floor(Date.now() / 1000)
  const todayStart = now - ((now + SHIFT) % 86400)
  return Array.from({ length: DAYS }, (_, i) =>
    new Date((todayStart - (DAYS - 1 - i) * 86400 + SHIFT) * 1000).toISOString().slice(0, 10),
  )
}

/**
 * 一次扫描同时得到「最后一次时间 / 按日计数 / 最近若干条事件」。
 * 这些表都很小(最大的 sync_logs 约 1.6k 行),不值得为每个指标写一段聚合 SQL。
 * 单表失败只降级该来源:共享库未挂载或表不存在时,页面仍要能渲染其余部分。
 */
async function collect(
  label: string,
  client: Client,
  table: string,
  timeCol: string,
  type: EventType,
  make: (row: Row) => { title: string; detail?: string },
  eventLimit = 8,
): Promise<SourceResult> {
  try {
    const result = await client.execute({
      sql: `SELECT * FROM ${table} ORDER BY ${timeCol} DESC LIMIT ${ROW_LIMIT}`,
    })
    const rows = (result.rows ?? []) as unknown as Row[]
    const daily: Record<string, number> = {}
    const events: PulseEvent[] = []
    let maxSec = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const sec = num(row[timeCol])
      if (sec <= 0) continue
      if (sec > maxSec) maxSec = sec
      const day = dayOf(sec)
      daily[day] = (daily[day] ?? 0) + 1
      if (i < eventLimit) {
        const { title, detail } = make(row)
        events.push({
          id: `${type}-${str(row.id) || i}-${sec}`,
          type,
          at: new Date(sec * 1000).toISOString(),
          title,
          detail,
        })
      }
    }

    return {
      latest: maxSec > 0 ? new Date(maxSec * 1000).toISOString() : null,
      daily,
      events,
    }
  } catch (error) {
    console.warn(`[timeline] ${label} 查询失败:`, error)
    return { latest: null, daily: {}, events: [] }
  }
}

export const GET = withAuth(async () => {
  await ensureSchema()
  const admin = getDb()
  const shared = await getActivitiesClient()

  const [sync, chat, activity, review, agentRun, pageView, configChange, jobRun, clicks] = await Promise.all([
    // 全部 source,不再只查 strava —— 默认同步源早已切到 keep。
    collect('sync_logs', shared, 'sync_logs', 'started_at', 'sync', row => ({
      title: `${str(row.source) || '数据源'} 同步`,
      detail: str(row.status) === 'success'
        ? `新增 ${num(row.activities_count)} 条活动`
        : (str(row.error_message) || str(row.status) || '未完成'),
    }), 20),
    collect('conversation_messages', shared, 'conversation_messages', 'created_at', 'chat', row => ({
      title: '对话消息',
      detail: str(row.role) === 'user' ? '你发的' : 'PR 伙伴回复',
    })),
    collect('activities', shared, 'activities', 'start_time', 'activity', row => ({
      title: '新的运动记录',
      detail: str(row.name) || str(row.type) || `${(num(row.distance_m) / 1000).toFixed(1)} km`,
    })),
    collect('activity_reviews', shared, 'activity_reviews', 'created_at', 'review', row => ({
      title: '生成复盘',
      detail: str(row.kind),
    })),
    collect('agent_runs', shared, 'agent_runs', 'created_at', 'agent_run', row => ({
      title: 'PR 任务执行',
      detail: [str(row.trigger), str(row.status)].filter(Boolean).join(' · '),
    })),
    collect('page_views', admin, 'page_views', 'created_at', 'page_view', row => ({
      title: '主站访问',
      detail: str(row.path),
    })),
    collect('app_setting_audit_logs', admin, 'app_setting_audit_logs', 'created_at', 'config_change', row => ({
      title: '配置变更',
      detail: [str(row.action), str(row.key)].filter(Boolean).join(' · '),
    })),
    collect('scheduler_jobs', admin, 'scheduler_jobs', 'last_run_at', 'job_run', row => ({
      title: '定时任务',
      detail: str(row.id) || str(row.name),
    })),
    // 点击只进热力图,不进时间线(噪声大)
    collect('click_events', admin, 'click_events', 'created_at', 'page_view', () => ({ title: '点击' }), 0),
  ])

  const dates = dateKeys()
  const daily = dates.map(date => ({
    date,
    sync: sync.daily[date] ?? 0,
    chats: chat.daily[date] ?? 0,
    activities: activity.daily[date] ?? 0,
    reviews: review.daily[date] ?? 0,
    agentRuns: agentRun.daily[date] ?? 0,
    pageViews: pageView.daily[date] ?? 0,
    clicks: clicks.daily[date] ?? 0,
  }))

  // 每小时「成功但 0 新增」是常态,不该刷满时间线;同类事件最多留 3 条,
  // 否则一轮对话/一轮定时任务会把「最近发生了什么」变成重复列表。
  const perType = new Map<EventType, number>()
  const events = [
    ...sync.events,
    ...chat.events,
    ...activity.events,
    ...review.events,
    ...agentRun.events,
    ...pageView.events,
    ...configChange.events,
    ...jobRun.events,
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter(e => !(e.type === 'sync' && e.detail === '新增 0 条活动'))
    .filter(e => {
      const n = perType.get(e.type) ?? 0
      if (n >= 3) return false
      perType.set(e.type, n + 1)
      return true
    })
    .slice(0, 16)

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      timezone: 'Asia/Shanghai',
      dates,
      daily,
      events,
      latest: {
        syncAt: sync.latest,
        chatAt: chat.latest,
        activityAt: activity.latest,
        reviewAt: review.latest,
        agentRunAt: agentRun.latest,
        pageViewAt: pageView.latest,
        configChangeAt: configChange.latest,
        jobRunAt: jobRun.latest,
      },
      degraded: !sync.latest && !chat.latest && !activity.latest,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
