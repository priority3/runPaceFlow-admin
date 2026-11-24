'use client'

import { useState } from 'react'

import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnalyticsData {
  overview: { totalPageViews: number; uniqueVisitors: number; todayPageViews: number; todayUniqueVisitors: number; weeklyPageViews: number; weeklyUniqueVisitors: number }
  topPages: Array<{ path: string; views: number; uniqueVisitors: number }>
  dailyViews: Array<{ date: string; views: number; uniqueVisitors: number }>
  referrers: Array<{ referrer: string; views: number }>
  referrerDomains: Array<{ name: string; views: number; uniqueVisitors: number }>
  browsers: Array<{ name: string; views: number; uniqueVisitors: number }>
  os: Array<{ name: string; views: number; uniqueVisitors: number }>
  devices: Array<{ name: string; views: number; uniqueVisitors: number }>
  countries: Array<{ name: string; views: number; uniqueVisitors: number }>
  cities: Array<{ name: string; views: number; uniqueVisitors: number }>
  realtime: { count: number; paths: string[] }
  sessions: { totalSessions: number; avgPagesPerSession: number; avgSessionDurationSec: number; bounceRate: number }
  hourly: Array<{ hour: number; views: number; uniqueVisitors: number }>
  exitPages: Array<{ path: string; exits: number; exitRate: number }>
  weekComparison: { thisWeek: { views: number; uniqueVisitors: number; sessions: number }; lastWeek: { views: number; uniqueVisitors: number; sessions: number } }
  languages: Array<{ name: string; views: number; uniqueVisitors: number }>
  timezones: Array<{ name: string; views: number; uniqueVisitors: number }>
  anomaly: { todayViews: number; avgViews: number; deviation: number; status: 'normal' | 'spike' | 'drop' | 'no_data'; message: string }
  pageFlows: Array<{ from: string; to: string; count: number }>
  performance: { avgLoadTime: number | null; avgScrollDepth: number | null; p95LoadTime: number | null }
}

export const DATE_PRESETS = [
  { label: '7天', value: 7 },
  { label: '14天', value: 14 },
  { label: '30天', value: 30 },
  { label: '90天', value: 90 },
]

// ─── Shared Components ────────────────────────────────────────────────────────

/**
 * 页面标题。不吸顶、不加灰底、不加毛玻璃 —— 侧栏已经是唯一一层导航,
 * 再叠一条吸顶栏就变成两层。层级只靠字号和留白。
 */
export function PanelHeader({ title, description, action }: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-4 pb-8 pt-2">
      <div>
        <h2 className="pr-h1">{title}</h2>
        {description && <p className="pr-meta mt-1">{description}</p>}
      </div>
      {action}
    </header>
  )
}

/** KPI:数字第一。accent 用形状(勾/感叹号)而非彩色,灰度下也读得出。 */
export function StatCard({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; accent?: 'green' | 'red'
}) {
  return (
    <div className="border-b pb-5" style={{ borderColor: 'var(--pr-line)' }}>
      <div className="pr-kpi-label flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="pr-kpi mt-2 truncate">
        {value}
        {accent && (
          <span className="ml-2 align-middle text-base text-muted-foreground" aria-label={accent === 'green' ? '指标正常' : '指标需关注'}>
            {accent === 'green' ? '✓' : '!'}
          </span>
        )}
      </p>
    </div>
  )
}

/** 服务状态:线分隔行 + 状态点。在线 = 讯号色实心,离线 = 空心,不只靠颜色。 */
export function ServiceCard({ name, status, responseTime, type }: {
  name: string; status: string; responseTime?: number | null; type?: string
}) {
  const isOnline = status === 'online'
  return (
    <div className="pr-row items-center">
      <div className="pr-row-main">
        <div className="flex items-center gap-2">
          <span className={cn('pr-status-dot', !isOnline && 'pr-status-dot--off')} />
          <strong className="pr-body font-normal">{name}</strong>
        </div>
        <span className="pr-meta mt-1 block">
          {isOnline ? '在线' : '离线'}
          {responseTime != null && ` · ${responseTime}ms`}
          {type && ` · ${type.toUpperCase()}`}
        </span>
      </div>
    </div>
  )
}

/** 空态:一句话 + 一个动作。不写"暂无数据"(那是在描述数据库)。 */
export function EmptyState({ line, action }: { line: string; action?: React.ReactNode }) {
  return (
    <div className="pr-empty">
      <span className="pr-empty-line">{line}</span>
      {action}
    </div>
  )
}

/** 骨架屏:形状跟真实内容一致(标题 + 4 个 KPI + 若干行),不写"加载中…"。 */
export function LoadingState() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8" role="status" aria-label="内容加载中">
      <div className="pr-skeleton h-6 w-24" />
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="space-y-3 border-b pb-5" style={{ borderColor: 'var(--pr-line)' }}>
            <div className="pr-skeleton h-2.5 w-16" />
            <div className="pr-skeleton h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-8 space-y-3">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="pr-skeleton h-3 w-full" />
        ))}
      </div>
    </div>
  )
}

/** 折叠面板:标题 + 1px 线,内容裸排,不套卡片。 */
export function CollapsibleSection({ title, defaultOpen = true, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b" style={{ borderColor: 'var(--pr-line)' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-3 text-left transition-colors hover:opacity-70"
      >
        <span className="pr-title">{title}</span>
        <svg className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="pb-6">{children}</div>}
    </section>
  )
}

/**
 * 折叠面板的加载占位。
 * Reason: 这些折叠子面板原本在 loading 时 return null,数据到达后突然出现把下方内容
 * 往下推,造成布局跳动。加载阶段先渲染一个等高的折叠态占位,稳定布局。
 */
export function CollapsibleSkeleton() {
  return (
    <div className="border-b py-3" style={{ borderColor: 'var(--pr-line)' }} aria-hidden>
      <div className="flex items-center justify-between">
        <div className="pr-skeleton h-3.5 w-32" />
        <div className="pr-skeleton h-3.5 w-3.5" />
      </div>
    </div>
  )
}
