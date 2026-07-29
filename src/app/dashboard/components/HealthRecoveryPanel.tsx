'use client'

import { useEffect, useState } from 'react'
import { HeartPulse, RefreshCw } from 'lucide-react'

import { cn } from '@/lib/utils'

import { LoadingState } from './shared'

interface HealthMetric {
  date: string
  sleepMinutes: number | null
  deepSleepMinutes: number | null
  remSleepMinutes: number | null
  hrv: number | null
  restingHr: number | null
  steps: number | null
  envAudioDb: number | null
  recoveryLabel: 'good' | 'okay' | 'poor' | 'unknown'
}

// Reason: 项目只有浅色一套主题,原来的 *-300 / white/* 文字色在白底上读不出来。
const RECOVERY: Record<string, { label: string; cls: string }> = {
  good: { label: '好', cls: 'bg-emerald-50 text-emerald-700' },
  okay: { label: '一般', cls: 'bg-sky-50 text-sky-700' },
  poor: { label: '偏弱', cls: 'bg-rose-50 text-rose-700' },
  unknown: { label: '未知', cls: 'bg-muted text-muted-foreground' },
}

function hm(min: number | null) {
  if (min == null) return '-'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}m`
}

export function HealthRecoveryPanel() {
  const [metrics, setMetrics] = useState<HealthMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fetchMetrics = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/health/daily?limit=14', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setMetrics(data.metrics ?? [])
        setLoadError(null)
      } else {
        setLoadError(`加载健康数据失败 (HTTP ${res.status})`)
      }
    } catch (e) {
      setLoadError(`加载健康数据失败: ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setLoading(false)
  }

  useEffect(() => {
    void Promise.resolve().then(fetchMetrics)
  }, [])

  if (loading) return <LoadingState />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <HeartPulse className="h-4 w-4" /> 近 14 天恢复
        </h3>
        <button type="button" onClick={fetchMetrics}
          className="bg-muted text-muted-foreground hover:bg-accent inline-flex items-center gap-1 rounded px-2 py-1 text-xs">
          <RefreshCw className="h-3 w-3" /> 刷新
        </button>
      </div>

      {loadError && <p className="text-sm text-rose-600">{loadError}</p>}

      {metrics.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-xs">
                <th className="px-2 py-1.5 font-normal">日期</th>
                <th className="px-2 py-1.5 font-normal">睡眠</th>
                <th className="px-2 py-1.5 font-normal">深睡</th>
                <th className="px-2 py-1.5 font-normal">REM</th>
                <th className="px-2 py-1.5 font-normal">静息</th>
                <th className="px-2 py-1.5 font-normal">HRV</th>
                <th className="px-2 py-1.5 font-normal">步数</th>
                <th className="px-2 py-1.5 font-normal">环境</th>
                <th className="px-2 py-1.5 font-normal">恢复</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => {
                const rec = RECOVERY[m.recoveryLabel] ?? RECOVERY.unknown
                return (
                  <tr key={m.date} className="border-b">
                    <td className="text-muted-foreground whitespace-nowrap px-2 py-1.5">{m.date.slice(5)}</td>
                    <td className="px-2 py-1.5">{hm(m.sleepMinutes)}</td>
                    <td className="text-muted-foreground px-2 py-1.5">{hm(m.deepSleepMinutes)}</td>
                    <td className="text-muted-foreground px-2 py-1.5">{hm(m.remSleepMinutes)}</td>
                    <td className="px-2 py-1.5">{m.restingHr ?? '-'}</td>
                    <td className="px-2 py-1.5">{m.hrv ?? '-'}</td>
                    <td className="px-2 py-1.5">{m.steps?.toLocaleString() ?? '-'}</td>
                    <td className="text-muted-foreground px-2 py-1.5">{m.envAudioDb != null ? `${m.envAudioDb}dB` : '-'}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-xs', rec.cls)}>{rec.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
          暂无健康数据。iOS 快捷指令上报后会出现在这里。
        </p>
      )}
    </div>
  )
}
