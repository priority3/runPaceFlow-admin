'use client'

import { useState } from 'react'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'

import { cn, formatDateTime } from '@/lib/utils'

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

export function StatCard({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; accent?: 'green' | 'red'
}) {
  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="flex items-center gap-2"><Icon className="text-muted-foreground h-4 w-4" /><span className="text-muted-foreground text-xs">{label}</span></div>
      <p className={cn('mt-2 truncate text-lg font-semibold tabular-nums', accent === 'green' && 'text-emerald-600', accent === 'red' && 'text-red-600')}>{value}</p>
    </div>
  )
}

export function ServiceCard({ name, status, responseTime, type }: {
  name: string; status: string; responseTime?: number | null; type?: string
}) {
  const isOnline = status === 'online'
  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{name}</span>
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
          {isOnline ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {isOnline ? '在线' : '离线'}
        </span>
      </div>
      <dl className="space-y-1 text-xs">
        {responseTime != null && <div className="flex justify-between"><dt className="text-muted-foreground">响应</dt><dd className="tabular-nums">{responseTime}ms</dd></div>}
        {type && <div className="flex justify-between"><dt className="text-muted-foreground">类型</dt><dd className="font-medium uppercase">{type}</dd></div>}
      </dl>
    </div>
  )
}

export function SyncCard({ source, configured, lastSync }: {
  source: string; configured: boolean; lastSync?: { startedAt: string; activitiesSynced: number } | null
}) {
  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{source}</span>
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
          {configured ? '已配置' : '未配置'}
        </span>
      </div>
      <dl className="space-y-1 text-xs">
        <div className="flex justify-between"><dt className="text-muted-foreground">最后同步</dt><dd>{lastSync?.startedAt ? formatDateTime(lastSync.startedAt) : '无'}</dd></div>
        {lastSync && <div className="flex justify-between"><dt className="text-muted-foreground">同步条数</dt><dd className="tabular-nums">{lastSync.activitiesSynced}</dd></div>}
      </dl>
    </div>
  )
}

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export function CollapsibleSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/50 transition-colors"
      >
        {title}
        <svg className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="border-t px-4 py-4">{children}</div>}
    </div>
  )
}

/**
 * 折叠面板的加载占位。
 * Reason: 这些折叠子面板原本在 loading 时 return null，数据到达后突然出现把下方内容
 * 往下推，造成布局跳动。加载阶段先渲染一个等高的折叠态占位（标题骨架），稳定布局。
 */
export function CollapsibleSkeleton() {
  return (
    <div className="bg-card rounded-lg border shadow-sm overflow-hidden" aria-hidden>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="bg-muted h-4 w-32 animate-pulse rounded" />
        <div className="bg-muted h-4 w-4 animate-pulse rounded" />
      </div>
    </div>
  )
}
