'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BarChart3,
  Eye,
  Footprints,
  Globe,
  RefreshCw,
  TrendingUp,
  Upload,
  Users,
} from 'lucide-react'

import { cn } from '@/lib/utils'

import {
  DeviceBrowserOSSection,
  ExitPagesSection,
  GeoSection,
  HourlyHeatMap,
  LanguageTimezoneSection,
  PageFlowsSection,
  PerformanceSection,
  PerformanceTrendSection,
  SessionQualitySection,
  WeekComparisonSection,
} from './AnalyticsCharts'
import { AnalyticsSummary } from './AnalyticsSummary'
import { ClickHeatmapPanel } from './ClickHeatmapPanel'
import { ConversionGoalsPanel } from './ConversionGoalsPanel'
import { ErrorTrackingPanel } from './ErrorTrackingPanel'
import { FunnelSection } from './FunnelSection'
import { JourneyPanel } from './JourneyPanel'
import { RealtimeMapPanel } from './RealtimeMapPanel'
import { AnalyticsData, DATE_PRESETS, EmptyState, PanelHeader, StatCard } from './shared'

import { InsightsPanel } from './InsightsPanel'

interface PerformanceTrendData {
  date: string
  avgLoadTime: number | null
  p95LoadTime: number | null
  avgScrollDepth: number | null
  sampleSize: number
}

export function AnalyticsPanel() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [performanceTrend, setPerformanceTrend] = useState<PerformanceTrendData[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [days, setDays] = useState(14)

  const fetchAnalytics = useCallback(async (rangeDays?: number) => {
    const d = rangeDays ?? days
    // Reason: 仅首次（无数据）显示整页加载态；后续刷新只标记 refreshing，避免清空已渲染内容造成闪烁
    setData(prev => {
      if (prev === null) setLoading(true)
      else setRefreshing(true)
      return prev
    })
    try {
      const [statsRes, trendRes] = await Promise.all([
        fetch(`/api/analytics/stats?days=${d}`, { cache: 'no-store' }),
        fetch(`/api/analytics/performance-trend?days=${d}`, { cache: 'no-store' }),
      ])
      if (statsRes.ok) {
        const json = await statsRes.json()
        setData(json)
      }
      if (trendRes.ok) {
        const trend = await trendRes.json()
        setPerformanceTrend(trend.data ?? [])
      }
    } catch {}
    setLoading(false)
    setRefreshing(false)
  }, [days])

  function handleDaysChange(newDays: number) {
    setDays(newDays)
    fetchAnalytics(newDays)
  }

  useEffect(() => {
    void Promise.resolve().then(() => fetchAnalytics())
    const interval = setInterval(() => fetchAnalytics(), 30000)
    return () => clearInterval(interval)
  }, [fetchAnalytics])

  if (loading) return <LoadingState />
  if (!data) return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <EmptyState
        line="分析数据还没加载出来。"
        action={<button type="button" onClick={() => fetchAnalytics()} className="pr-btn">重试</button>}
      />
    </div>
  )

  const maxDailyViews = Math.max(...data.dailyViews.map(d => d.views), 1)

  // 异常提示:一行文字 + 状态点。三态靠形状(实心 / 空心 / 警示)和文案,不靠底色块。
  const anomalyBanner = data.anomaly.status !== 'no_data' && (
    <div className="flex items-center gap-2 border-b py-3 text-sm" style={{ borderColor: 'var(--pr-line)' }}>
      <span className={cn(
        'pr-status-dot',
        data.anomaly.status === 'normal' && 'pr-status-dot--off',
        data.anomaly.status === 'drop' && 'pr-status-dot--warn',
      )} />
      <span>{data.anomaly.message}</span>
    </div>
  )

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <PanelHeader
        title="访问分析"
        description="前端 PV / UV 数据统计"
        action={
          <div className="flex items-center gap-4">
            {/* 当前项用字重 + 下划线,不用实心底色块 */}
            <div className="flex items-center gap-3">
              {DATE_PRESETS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handleDaysChange(p.value)}
                  className={cn(
                    'text-xs transition-colors',
                    days === p.value
                      ? 'font-medium text-foreground underline underline-offset-4'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <ExportMenu days={days} />
            <button type="button" onClick={() => fetchAnalytics()} disabled={refreshing} className="pr-btn">
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              刷新
            </button>
          </div>
        }
      />

      {anomalyBanner}

      <InsightsPanel />

      <AnalyticsSummary />

      {/* Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Globe} label="总浏览量" value={String(data.overview.totalPageViews)} />
        <StatCard icon={Users} label="总访客" value={String(data.overview.uniqueVisitors)} />
        <StatCard icon={BarChart3} label="今日浏览" value={String(data.overview.todayPageViews)} />
        <StatCard icon={Eye} label="实时访客" value={`${data.realtime.count} (5min)`} accent={data.realtime.count > 0 ? 'green' : undefined} />
      </div>

      {/* Session Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Footprints} label="总会话数" value={String(data.sessions.totalSessions)} />
        <StatCard icon={BarChart3} label="平均页面/会话" value={data.sessions.avgPagesPerSession.toFixed(1)} />
        <StatCard icon={Users} label="跳出率" value={`${data.sessions.bounceRate.toFixed(1)}%`} accent={data.sessions.bounceRate > 70 ? 'red' : data.sessions.bounceRate < 40 ? 'green' : undefined} />
        <StatCard icon={TrendingUp} label="周浏览" value={String(data.overview.weeklyPageViews)} />
      </div>

      {/* Live Visitors */}
      {data.realtime.count > 0 && (
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="pr-status-dot pr-status-dot--live" />
            <span className="text-sm font-medium">{data.realtime.count} 位访客正在浏览</span>
          </div>
          {data.realtime.paths.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.realtime.paths.map(p => (
                <span key={p} className="bg-muted inline-flex items-center rounded-md px-2 py-0.5 text-xs font-mono">{p}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <RealtimeMapPanel />

      {/* Daily Trend Chart */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">每日趋势 (近 14 天)</h3>
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          {data.dailyViews.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">这个范围里还没有数据，换个时间范围看看</div>
          ) : (
            <div className="flex items-end gap-1 h-40">
              {data.dailyViews.map((day) => (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex gap-0.5 items-end justify-center" style={{ height: '120px' }}>
                    <div
                      className="bg-primary/80 rounded-t w-full max-w-[20px]"
                      style={{ height: `${(day.views / maxDailyViews) * 100}%`, minHeight: day.views > 0 ? '4px' : '0' }}
                      title={`${day.views} 浏览`}
                    />
                  </div>
                  <span className="text-muted-foreground text-[10px] tabular-nums">
                    {day.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Top Pages */}
        <section>
          <h3 className="mb-3 text-sm font-semibold">热门页面</h3>
          <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
            {data.topPages.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-sm">这个范围里还没有数据，换个时间范围看看</div>
            ) : (
              <div className="divide-y">
                {data.topPages.slice(0, 10).map((page) => (
                  <div key={page.path} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                    <span className="font-mono text-xs truncate min-w-0">{page.path}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground text-xs tabular-nums">{page.uniqueVisitors} UV</span>
                      <span className="font-medium tabular-nums">{page.views} PV</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Referrers */}
        <section>
          <h3 className="mb-3 text-sm font-semibold">来源域名</h3>
          <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
            {data.referrerDomains.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-sm">这个范围里还没有数据，换个时间范围看看</div>
            ) : (
              <div className="divide-y">
                {data.referrerDomains.map((ref) => (
                  <div key={ref.name} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                    <span className="truncate min-w-0 text-xs">
                      {ref.name === 'direct' ? '直接访问' : ref.name}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground text-xs tabular-nums">{ref.uniqueVisitors} UV</span>
                      <span className="font-medium tabular-nums">{ref.views}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <DeviceBrowserOSSection data={data} />
      <GeoSection data={data} />
      <HourlyHeatMap data={data} />

      <div className="grid gap-4 sm:grid-cols-2">
        <WeekComparisonSection data={data} />
        <ExitPagesSection data={data} />
      </div>

      <SessionQualitySection data={data} />
      <PerformanceSection data={data} />
      <PerformanceTrendSection data={performanceTrend} />
      <ConversionGoalsPanel />
      <JourneyPanel />
      <ClickHeatmapPanel />
      <ErrorTrackingPanel />
      <FunnelSection />
      <PageFlowsSection data={data} />
      <LanguageTimezoneSection data={data} />
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

const EXPORT_FORMATS: Array<{ format: string; label: string }> = [
  { format: 'csv', label: 'CSV' },
  { format: 'tsv', label: 'TSV (Excel)' },
  { format: 'json', label: 'JSON' },
  { format: 'summary', label: '摘要报告' },
]

/**
 * 导出下拉菜单。
 * Reason: 原实现用 group-hover 触发，触屏设备无 hover 无法打开、键盘也不可达；
 * 改为 click 触发 + 点击外部关闭 + Esc 关闭 + aria 属性，保证可访问性。
 */
function ExportMenu({ days }: { days: number }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function handleExport(format: string) {
    window.open(`/api/analytics/export?days=${days}&format=${format}`, '_blank')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="bg-background hover:bg-accent flex h-9 items-center gap-2 rounded-md border px-3 text-sm shadow-sm transition-colors"
      >
        <Upload className="h-4 w-4" />
        导出
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-36 rounded-md border bg-background shadow-md z-50 overflow-hidden">
          {EXPORT_FORMATS.map(({ format, label }) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              onClick={() => handleExport(format)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-accent"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
