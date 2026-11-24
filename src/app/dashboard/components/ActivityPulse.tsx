'use client'

import { useEffect, useState } from 'react'

interface DailyPoint {
  date: string
  sync: number
  chats: number
  activities: number
  reviews: number
  agentRuns: number
  pageViews: number
  clicks: number
}

interface PulseEvent {
  id: string
  type: string
  at: string
  title: string
  detail?: string
}

interface TimelineData {
  generatedAt: string
  timezone: string
  dates: string[]
  daily: DailyPoint[]
  events: PulseEvent[]
  latest: {
    syncAt: string | null
    chatAt: string | null
    activityAt: string | null
    reviewAt: string | null
    agentRunAt: string | null
    pageViewAt: string | null
    configChangeAt: string | null
    jobRunAt: string | null
  }
  degraded: boolean
}

const SERIES: { key: keyof Omit<DailyPoint, 'date'>; label: string }[] = [
  { key: 'sync', label: '同步' },
  { key: 'chats', label: '聊天' },
  { key: 'activities', label: '运动' },
  { key: 'reviews', label: '复盘' },
  { key: 'agentRuns', label: 'PR 任务' },
  { key: 'pageViews', label: '访问' },
  { key: 'clicks', label: '点击' },
]

function ago(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  const min = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60_000))
  let value: string
  let unit: string
  if (min < 1) { value = '刚刚'; unit = '' }
  else if (min < 60) { value = String(min); unit = '分钟前' }
  else if (min < 1440) { value = String(Math.floor(min / 60)); unit = '小时前' }
  else { value = String(Math.floor(min / 1440)); unit = '天前' }
  const exact = d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return { value, unit, exact }
}

function shortAgo(iso: string) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  if (min < 1440) return `${Math.floor(min / 60)} 小时前`
  return `${Math.floor(min / 1440)} 天前`
}

function LatestCard({ label, iso }: { label: string; iso: string | null }) {
  const a = ago(iso)
  return (
    <div className="border-b pb-4" style={{ borderColor: 'var(--pr-line)' }}>
      <div className="pr-kpi-label">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="pr-kpi">{a ? a.value : '—'}</span>
        {a?.unit && <span className="pr-meta">{a.unit}</span>}
      </div>
      <p className="pr-meta mt-1">{a ? a.exact : '还没有记录'}</p>
    </div>
  )
}

/** 每类单独归一化:同步每天 24 条不会把「聊天/运动」压成一条平线。 */
function HeatGrid({ data }: { data: TimelineData }) {
  return (
    <div>
      <div className="pr-title mb-4">近 14 天 · 每天发生了多少</div>
      <div className="space-y-2">
        {SERIES.map(s => {
          const values = data.daily.map(d => Number(d[s.key] ?? 0))
          const max = Math.max(1, ...values)
          const total = values.reduce((a, b) => a + b, 0)
          return (
            <div className="pr-pulse-row" key={s.key}>
              <span className="pr-pulse-label">{s.label}</span>
              <div className="pr-pulse-cells">
                {values.map((v, i) => (
                  <span
                    key={i}
                    className="pr-pulse-cell"
                    title={`${data.dates[i]} · ${v} 次`}
                    style={{
                      background: v ? 'var(--pr-text)' : 'var(--pr-line)',
                      opacity: v ? 0.16 + 0.66 * (v / max) : 1,
                    }}
                  />
                ))}
              </div>
              <span className="pr-pulse-total">{total}</span>
            </div>
          )
        })}
      </div>
      <div className="pr-pulse-axis">
        {data.dates.map((d, i) => (
          <span key={d}>{i % 3 === 0 ? d.slice(5) : ''}</span>
        ))}
      </div>
      <p className="pr-meta mt-3">格子越深表示当天次数越多，每一行按自己的峰值归一化</p>
    </div>
  )
}

export function ActivityPulse() {
  const [data, setData] = useState<TimelineData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/overview/timeline', { cache: 'no-store' })
        if (!res.ok) throw new Error('failed')
        const json = (await res.json()) as TimelineData
        if (alive) { setData(json); setError(false) }
      } catch {
        if (alive) setError(true)
      }
    }
    void load()
    const timer = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  if (error) {
    return (
      <section className="border-t pt-6" style={{ borderColor: 'var(--pr-line)' }}>
        <p className="pr-body">活动时间线暂时取不到，稍后会自动重试。</p>
      </section>
    )
  }

  if (!data) {
    return (
      <section className="border-t pt-6" style={{ borderColor: 'var(--pr-line)' }} aria-label="活动时间线加载中">
        <div className="pr-skeleton h-4 w-24" />
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-3">
              <div className="pr-skeleton h-2.5 w-20" />
              <div className="pr-skeleton h-7 w-28" />
            </div>
          ))}
        </div>
        <div className="mt-8 space-y-2">
          {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="pr-skeleton h-3 w-full" />)}
        </div>
      </section>
    )
  }

  return (
    <section className="border-t pt-6" style={{ borderColor: 'var(--pr-line)' }}>
      <div className="flex items-baseline justify-between gap-4 pb-6">
        <div>
          <h3 className="pr-title">最近活动</h3>
          <p className="pr-meta mt-1">同步、对话、运动与访问的真实时间</p>
        </div>
        <span className="pr-meta">{data.timezone} · 每 60 秒刷新</span>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <LatestCard label="距上次同步" iso={data.latest.syncAt} />
        <LatestCard label="距上次聊天" iso={data.latest.chatAt} />
        <LatestCard label="距上次运动" iso={data.latest.activityAt} />
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-2">
        <HeatGrid data={data} />
        <div>
          <div className="pr-title mb-4">最近发生了什么</div>
          {data.events.length === 0 ? (
            <p className="pr-meta">这段时间还没有记录，等下一次同步或对话后这里会出现时间线。</p>
          ) : (
            <div className="pr-timeline">
              {data.events.slice(0, 12).map(e => (
                <div className="pr-timeline-item" key={e.id}>
                  <span className="pr-timeline-dot" />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="pr-body">{e.title}</span>
                    <span className="pr-meta shrink-0" title={new Date(e.at).toLocaleString('zh-CN')}>
                      {shortAgo(e.at)}
                    </span>
                  </div>
                  {e.detail && <p className="pr-meta mt-0.5 truncate">{e.detail}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.degraded && (
        <p className="pr-meta mt-6">共享数据库暂时不可读，这里只显示了本机能取到的部分。</p>
      )}
    </section>
  )
}
