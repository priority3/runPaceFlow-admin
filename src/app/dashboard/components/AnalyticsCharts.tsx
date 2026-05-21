'use client'

import { cn } from '@/lib/utils'

import type { AnalyticsData } from './shared'

import { CollapsibleSection } from './shared'

// ─── Performance Stats ───────────────────────────────────────────────────────

export function PerformanceSection({ data }: { data: AnalyticsData }) {
  if (!data.performance) return null

  const { avgLoadTime, avgScrollDepth, p95LoadTime } = data.performance

  return (
    <CollapsibleSection title="性能指标" defaultOpen={false}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <span className="text-muted-foreground text-xs">平均加载时间</span>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {avgLoadTime != null ? `${avgLoadTime}ms` : '-'}
          </p>
          <p className="text-muted-foreground text-[10px] mt-0.5">
            {avgLoadTime != null ? (avgLoadTime < 1000 ? '优秀' : avgLoadTime < 2000 ? '良好' : '偏慢') : '暂无数据'}
          </p>
        </div>
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <span className="text-muted-foreground text-xs">P95 加载时间</span>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {p95LoadTime != null ? `${p95LoadTime}ms` : '-'}
          </p>
          <p className="text-muted-foreground text-[10px] mt-0.5">
            {p95LoadTime != null ? (p95LoadTime < 2000 ? '优秀' : p95LoadTime < 4000 ? '良好' : '需优化') : '暂无数据'}
          </p>
        </div>
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <span className="text-muted-foreground text-xs">平均滚动深度</span>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {avgScrollDepth != null ? `${avgScrollDepth.toFixed(0)}%` : '-'}
          </p>
          <p className="text-muted-foreground text-[10px] mt-0.5">
            {avgScrollDepth != null ? (avgScrollDepth > 70 ? '用户参与度高' : avgScrollDepth > 40 ? '一般' : '内容吸引力不足') : '暂无数据'}
          </p>
        </div>
      </div>
    </CollapsibleSection>
  )
}

// ─── Device / Browser / OS Breakdown ─────────────────────────────────────────

export function DeviceBrowserOSSection({ data }: { data: AnalyticsData }) {
  return (
    <CollapsibleSection title="设备 · 浏览器 · 操作系统" defaultOpen={false}>
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Device Type */}
        <section>
          <h3 className="mb-3 text-sm font-semibold">设备类型</h3>
          <div className="bg-card rounded-lg border p-4 shadow-sm">
            {data.devices.length === 0 ? (
              <div className="text-muted-foreground py-4 text-center text-sm">暂无数据</div>
            ) : (
              <div className="space-y-3">
                {data.devices.map(d => {
                  const pct = data.overview.totalPageViews > 0 ? (d.views / data.overview.totalPageViews * 100) : 0
                  const label = d.name === 'desktop' ? '桌面端' : d.name === 'mobile' ? '移动端' : d.name === 'tablet' ? '平板' : d.name
                  return (
                    <div key={d.name}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium">{label}</span>
                        <span className="text-muted-foreground tabular-nums">{d.views} ({pct.toFixed(1)}%)</span>
                      </div>
                      <div className="bg-muted h-2 rounded-full overflow-hidden">
                        <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* Browser */}
        <section>
          <h3 className="mb-3 text-sm font-semibold">浏览器</h3>
          <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
            {data.browsers.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-sm">暂无数据</div>
            ) : (
              <div className="divide-y">
                {data.browsers.slice(0, 8).map(b => (
                  <div key={b.name} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                    <span className="text-xs">{b.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground text-xs tabular-nums">{b.uniqueVisitors} UV</span>
                      <span className="font-medium tabular-nums">{b.views}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* OS */}
        <section>
          <h3 className="mb-3 text-sm font-semibold">操作系统</h3>
          <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
            {data.os.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-sm">暂无数据</div>
            ) : (
              <div className="divide-y">
                {data.os.slice(0, 8).map(o => (
                  <div key={o.name} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                    <span className="text-xs">{o.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground text-xs tabular-nums">{o.uniqueVisitors} UV</span>
                      <span className="font-medium tabular-nums">{o.views}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </CollapsibleSection>
  )
}

// ─── Geo Distribution ────────────────────────────────────────────────────────

export function GeoSection({ data }: { data: AnalyticsData }) {
  return (
    <CollapsibleSection title="地域分布" defaultOpen={false}>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Countries */}
        <section>
          <h3 className="mb-3 text-sm font-semibold">国家/地区分布</h3>
          <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
            {data.countries.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-sm">暂无数据</div>
            ) : (
              <div className="divide-y">
                {data.countries.map(c => {
                  const pct = data.overview.totalPageViews > 0 ? (c.views / data.overview.totalPageViews * 100) : 0
                  return (
                    <div key={c.name} className="px-4 py-2.5 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-xs">{c.name}</span>
                        <span className="text-muted-foreground text-xs tabular-nums">{c.views} PV · {c.uniqueVisitors} UV</span>
                      </div>
                      <div className="bg-muted h-1.5 rounded-full overflow-hidden">
                        <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* Cities */}
        <section>
          <h3 className="mb-3 text-sm font-semibold">城市分布</h3>
          <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
            {data.cities.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-sm">暂无数据</div>
            ) : (
              <div className="divide-y">
                {data.cities.map(c => {
                  const pct = data.overview.totalPageViews > 0 ? (c.views / data.overview.totalPageViews * 100) : 0
                  return (
                    <div key={c.name} className="px-4 py-2.5 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-xs">{c.name}</span>
                        <span className="text-muted-foreground text-xs tabular-nums">{c.views} PV · {c.uniqueVisitors} UV</span>
                      </div>
                      <div className="bg-muted h-1.5 rounded-full overflow-hidden">
                        <div className="bg-blue-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </CollapsibleSection>
  )
}

// ─── Hourly Heat Map ─────────────────────────────────────────────────────────

export function HourlyHeatMap({ data }: { data: AnalyticsData }) {
  return (
    <CollapsibleSection title="访问时段热力图" defaultOpen={false}>
      <section>
        <h3 className="mb-3 text-sm font-semibold">访问时段分布 (近 7 天)</h3>
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          {data.hourly.every(h => h.views === 0) ? (
            <div className="text-muted-foreground py-8 text-center text-sm">暂无数据</div>
          ) : (
            <div className="flex items-end gap-0.5 h-32">
              {data.hourly.map(h => {
                const maxViews = Math.max(...data.hourly.map(x => x.views), 1)
                const pct = (h.views / maxViews) * 100
                return (
                  <div key={h.hour} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                    <div className="w-full flex justify-center">
                      <div className="hidden group-hover:block absolute bottom-full mb-1 bg-foreground text-background text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                        {h.hour}:00 — {h.views} PV, {h.uniqueVisitors} UV
                      </div>
                    </div>
                    <div
                      className="bg-primary/70 hover:bg-primary rounded-t w-full transition-colors cursor-pointer"
                      style={{ height: `${Math.max(pct, 2)}%`, minHeight: h.views > 0 ? '4px' : '1px' }}
                    />
                    {h.hour % 3 === 0 && (
                      <span className="text-muted-foreground text-[9px] tabular-nums">{h.hour}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </CollapsibleSection>
  )
}

// ─── Week-over-Week Comparison ────────────────────────────────────────────────

export function WeekComparisonSection({ data }: { data: AnalyticsData }) {
  const tw = data.weekComparison.thisWeek
  const lw = data.weekComparison.lastWeek
  const delta = (curr: number, prev: number) => {
    if (prev === 0) return curr > 0 ? '+∞%' : '—'
    const d = ((curr - prev) / prev * 100).toFixed(0)
    return Number(d) >= 0 ? `+${d}%` : `${d}%`
  }

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">周同比</h3>
      <div className="bg-card rounded-lg border p-4 shadow-sm">
        <div className="space-y-4">
          {[
            { label: '浏览量', thisVal: tw.views, lastVal: lw.views },
            { label: '访客数', thisVal: tw.uniqueVisitors, lastVal: lw.uniqueVisitors },
            { label: '会话数', thisVal: tw.sessions, lastVal: lw.sessions },
          ].map(row => (
            <div key={row.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">{row.label}</span>
                <span className={cn('font-medium tabular-nums',
                  row.thisVal >= row.lastVal ? 'text-emerald-600' : 'text-red-600'
                )}>
                  {delta(row.thisVal, row.lastVal)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="tabular-nums font-medium">{row.thisVal}</span>
                <span className="text-muted-foreground">vs</span>
                <span className="text-muted-foreground tabular-nums">{row.lastVal}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Exit Pages ──────────────────────────────────────────────────────────────

export function ExitPagesSection({ data }: { data: AnalyticsData }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">退出页面 TOP 10</h3>
      <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
        {data.exitPages.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center text-sm">暂无数据</div>
        ) : (
          <div className="divide-y">
            {data.exitPages.map(ep => (
              <div key={ep.path} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                <span className="font-mono text-xs truncate min-w-0">{ep.path}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-muted-foreground text-xs tabular-nums">{ep.exitRate}%</span>
                  <span className="font-medium tabular-nums">{ep.exits}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Session Quality ─────────────────────────────────────────────────────────

export function SessionQualitySection({ data }: { data: AnalyticsData }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">会话质量</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <span className="text-muted-foreground text-xs">平均会话时长</span>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {data.sessions.avgSessionDurationSec > 60
              ? `${Math.floor(data.sessions.avgSessionDurationSec / 60)}m ${Math.floor(data.sessions.avgSessionDurationSec % 60)}s`
              : `${Math.floor(data.sessions.avgSessionDurationSec)}s`}
          </p>
        </div>
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <span className="text-muted-foreground text-xs">平均浏览页数</span>
          <p className="mt-1 text-lg font-semibold tabular-nums">{data.sessions.avgPagesPerSession.toFixed(1)} 页/会话</p>
        </div>
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <span className="text-muted-foreground text-xs">跳出率</span>
          <p className={cn('mt-1 text-lg font-semibold tabular-nums',
            data.sessions.bounceRate > 70 ? 'text-red-600' : data.sessions.bounceRate < 40 ? 'text-emerald-600' : ''
          )}>
            {data.sessions.bounceRate.toFixed(1)}%
          </p>
          <p className="text-muted-foreground text-[10px] mt-0.5">
            {data.sessions.bounceRate > 70 ? '偏高，考虑优化落地页' : data.sessions.bounceRate < 40 ? '健康' : '一般'}
          </p>
        </div>
      </div>
    </section>
  )
}

// ─── Page Flows ──────────────────────────────────────────────────────────────

export function PageFlowsSection({ data }: { data: AnalyticsData }) {
  if (data.pageFlows.length === 0) return null

  return (
    <CollapsibleSection title="页面流转路径" defaultOpen={false}>
      <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
        <div className="divide-y">
          {data.pageFlows.slice(0, 10).map((flow, i) => (
            <div key={`${flow.from}-${flow.to}-${i}`} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <span className="font-mono text-xs truncate max-w-[200px]">{flow.from}</span>
              <svg className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              <span className="font-mono text-xs truncate max-w-[200px]">{flow.to}</span>
              <span className="ml-auto font-medium tabular-nums shrink-0">{flow.count}</span>
            </div>
          ))}
        </div>
      </div>
    </CollapsibleSection>
  )
}

// ─── Language & Timezone ─────────────────────────────────────────────────────

export function LanguageTimezoneSection({ data }: { data: AnalyticsData }) {
  return (
    <CollapsibleSection title="语言与时区" defaultOpen={false}>
      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <h3 className="mb-3 text-sm font-semibold">语言分布</h3>
          <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
            {data.languages.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-sm">暂无数据</div>
            ) : (
              <div className="divide-y">
                {data.languages.map(l => (
                  <div key={l.name} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                    <span className="text-xs">{l.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground text-xs tabular-nums">{l.uniqueVisitors} UV</span>
                      <span className="font-medium tabular-nums">{l.views}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold">时区分布</h3>
          <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
            {data.timezones.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-sm">暂无数据</div>
            ) : (
              <div className="divide-y">
                {data.timezones.map(tz => (
                  <div key={tz.name} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                    <span className="text-xs">{tz.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground text-xs tabular-nums">{tz.uniqueVisitors} UV</span>
                      <span className="font-medium tabular-nums">{tz.views}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </CollapsibleSection>
  )
}

// ─── Performance Trend ───────────────────────────────────────────────────────

interface PerformanceTrendData {
  date: string
  avgLoadTime: number | null
  p95LoadTime: number | null
  avgScrollDepth: number | null
  sampleSize: number
}

export function PerformanceTrendSection({ data }: { data: PerformanceTrendData[] }) {
  if (!data || data.length === 0) return null

  const maxLoadTime = Math.max(...data.filter(d => d.avgLoadTime != null).map(d => d.avgLoadTime!), 1)

  return (
    <CollapsibleSection title="性能趋势" defaultOpen={false}>
      <section>
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <div className="flex items-center gap-4 mb-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              平均加载时间
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              P95 加载时间
            </span>
            <span className="text-muted-foreground">采样数显示在底部</span>
          </div>
          <div className="flex items-end gap-0.5 h-32">
            {data.map(d => {
              const avgPct = d.avgLoadTime != null ? (d.avgLoadTime / maxLoadTime) * 100 : 0
              const p95Pct = d.p95LoadTime != null ? (d.p95LoadTime / maxLoadTime) * 100 : 0
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                  <div className="w-full flex justify-center">
                    <div className="hidden group-hover:block absolute bottom-full mb-1 bg-foreground text-background text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                      {d.date.slice(5)} — 平均 {d.avgLoadTime != null ? `${Math.round(d.avgLoadTime)}ms` : '-'} / P95 {d.p95LoadTime != null ? `${Math.round(d.p95LoadTime)}ms` : '-'} ({d.sampleSize} 次)
                    </div>
                  </div>
                  <div className="w-full flex gap-px items-end justify-center" style={{ height: '100px' }}>
                    <div
                      className="bg-blue-500 rounded-t flex-1 max-w-[8px]"
                      style={{ height: `${Math.max(avgPct, 2)}%` }}
                    />
                    <div
                      className="bg-amber-500 rounded-t flex-1 max-w-[8px]"
                      style={{ height: `${Math.max(p95Pct, 2)}%` }}
                    />
                  </div>
                  {d.date.slice(-2) === '01' || data.indexOf(d) % Math.ceil(data.length / 7) === 0 ? (
                    <span className="text-muted-foreground text-[9px] tabular-nums">{d.date.slice(5)}</span>
                  ) : (
                    <span className="text-muted-foreground text-[9px] tabular-nums opacity-0">.</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </CollapsibleSection>
  )
}
