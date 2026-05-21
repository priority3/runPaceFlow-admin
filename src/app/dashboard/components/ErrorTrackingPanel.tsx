'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import { cn } from '@/lib/utils'

import { CollapsibleSection } from './shared'

interface ErrorSummary {
  message: string
  count: number
  firstSeen: string
  lastSeen: string
}

interface ErrorEvent {
  message: string
  filename: string | null
  lineno: number | null
  path: string
  visitorId: string | null
  date: string
  createdAt: string
}

interface ErrorDaily {
  date: string
  count: number
}

interface ErrorData {
  total: number
  summary: ErrorSummary[]
  recent: ErrorEvent[]
  daily: ErrorDaily[]
}

export function ErrorTrackingPanel() {
  const [data, setData] = useState<ErrorData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/analytics/errors?days=7', { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch {}
      setLoading(false)
    }
    fetchData()
  }, [])

  if (loading) return null
  if (!data || data.total === 0) return null

  const maxDaily = Math.max(...data.daily.map(d => d.count), 1)

  return (
    <CollapsibleSection title="错误追踪" defaultOpen={false}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          <span>近 7 天共 {data.total} 个错误</span>
        </div>

        {/* Daily error trend */}
        {data.daily.length > 0 && (
          <div className="bg-card rounded-lg border p-4 shadow-sm">
            <h4 className="text-xs font-medium mb-3">每日错误趋势</h4>
            <div className="flex items-end gap-0.5 h-20">
              {data.daily.map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                  <div className="w-full flex justify-center">
                    <div className="hidden group-hover:block absolute bottom-full mb-1 bg-foreground text-background text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                      {d.date.slice(5)} — {d.count} 个错误
                    </div>
                  </div>
                  <div
                    className="bg-amber-500 rounded-t w-full"
                    style={{ height: `${Math.max((d.count / maxDaily) * 100, 2)}%`, minHeight: d.count > 0 ? '4px' : '1px' }}
                  />
                  {d.date.slice(-2) === '01' || data.daily.indexOf(d) % Math.ceil(data.daily.length / 7) === 0 ? (
                    <span className="text-muted-foreground text-[9px] tabular-nums">{d.date.slice(5)}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error summary */}
        <div>
          <h4 className="text-xs font-medium mb-2">错误类型统计</h4>
          <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
            <div className="divide-y">
              {data.summary.slice(0, 10).map((err, i) => (
                <div key={`${err.message}-${i}`} className="px-4 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium truncate max-w-[400px]">{err.message}</span>
                    <span className="text-xs font-medium tabular-nums text-amber-600">{err.count} 次</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    首次: {new Date(err.firstSeen).toLocaleDateString('zh-CN')} ·
                    最近: {new Date(err.lastSeen).toLocaleDateString('zh-CN')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent errors */}
        <div>
          <h4 className="text-xs font-medium mb-2">最近错误</h4>
          <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
            <div className="divide-y">
              {data.recent.slice(0, 10).map((err, i) => (
                <div key={`${err.createdAt}-${i}`} className="px-4 py-2.5">
                  <div className="text-xs font-medium truncate mb-1">{err.message}</div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{err.path}</span>
                    {err.filename && (
                      <span className="font-mono">{err.filename}:{err.lineno}</span>
                    )}
                    <span>{new Date(err.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  )
}
