'use client'

import { useEffect, useState } from 'react'
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
import { ABTestConfigPanel } from './ABTestConfigPanel'
import { AnalyticsSummary } from './AnalyticsSummary'
import { ClickHeatmapPanel } from './ClickHeatmapPanel'
import { ConversionGoalsPanel } from './ConversionGoalsPanel'
import { ConversionPanel } from './ConversionPanel'
import { ErrorTrackingPanel } from './ErrorTrackingPanel'
import { FunnelSection } from './FunnelSection'
import { JourneyPanel } from './JourneyPanel'
import { RealtimeMapPanel } from './RealtimeMapPanel'
import { AnalyticsData, DATE_PRESETS, StatCard } from './shared'

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
  const [days, setDays] = useState(14)

  const fetchAnalytics = async (rangeDays?: number) => {
    const d = rangeDays ?? days
    setLoading(true)
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
  }

  function handleDaysChange(newDays: number) {
    setDays(newDays)
    fetchAnalytics(newDays)
  }

  useEffect(() => {
    fetchAnalytics()
    const interval = setInterval(() => fetchAnalytics(), 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) return <LoadingState />
  if (!data) return <div className="text-muted-foreground p-8 text-center text-sm">无法加载分析数据</div>

  const maxDailyViews = Math.max(...data.dailyViews.map(d => d.views), 1)

  const anomalyBanner = data.anomaly.status !== 'no_data' && (
    <div className={cn(
      'rounded-md border px-4 py-3 text-sm flex items-center gap-2',
      data.anomaly.status === 'spike' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
      data.anomaly.status === 'drop' && 'border-amber-200 bg-amber-50 text-amber-900',
      data.anomaly.status === 'normal' && 'border-blue-200 bg-blue-50 text-blue-900',
    )}>
      <span className="text-lg">
        {data.anomaly.status === 'spike' ? '📈' : data.anomaly.status === 'drop' ? '📉' : '📊'}
      </span>
      <span>{data.anomaly.message}</span>
    </div>
  )

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">访问分析</h2>
          <p className="text-muted-foreground text-xs mt-1">前端 PV / UV 数据统计</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border shadow-sm">
            {DATE_PRESETS.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => handleDaysChange(p.value)}
                className={cn(
                  'px-2.5 py-1.5 text-xs font-medium transition-colors',
                  days === p.value ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="relative group">
            <button
              type="button"
              className="bg-background hover:bg-accent flex h-9 items-center gap-2 rounded-md border px-3 text-sm shadow-sm transition-colors"
            >
              <Upload className="h-4 w-4" />
              导出
            </button>
            <div className="absolute right-0 top-full mt-1 w-36 rounded-md border bg-background shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              <button
                type="button"
                onClick={() => window.open(`/api/analytics/export?days=${days}&format=csv`, '_blank')}
                className="w-full text-left px-3 py-2 text-xs hover:bg-accent rounded-t-md"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={() => window.open(`/api/analytics/export?days=${days}&format=tsv`, '_blank')}
                className="w-full text-left px-3 py-2 text-xs hover:bg-accent"
              >
                TSV (Excel)
              </button>
              <button
                type="button"
                onClick={() => window.open(`/api/analytics/export?days=${days}&format=json`, '_blank')}
                className="w-full text-left px-3 py-2 text-xs hover:bg-accent"
              >
                JSON
              </button>
              <button
                type="button"
                onClick={() => window.open(`/api/analytics/export?days=${days}&format=summary`, '_blank')}
                className="w-full text-left px-3 py-2 text-xs hover:bg-accent rounded-b-md"
              >
                摘要报告
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchAnalytics()}
            className="bg-background hover:bg-accent flex h-9 items-center gap-2 rounded-md border px-3 text-sm shadow-sm transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      </header>

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
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
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
            <div className="text-muted-foreground py-8 text-center text-sm">暂无数据</div>
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
              <div className="text-muted-foreground p-8 text-center text-sm">暂无数据</div>
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
              <div className="text-muted-foreground p-8 text-center text-sm">暂无数据</div>
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
      <ConversionPanel />
      <ConversionGoalsPanel />
      <ABTestConfigPanel />
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
