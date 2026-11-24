'use client'

import { useCallback, useEffect, useState } from 'react'
import { HeartPulse, Plus, RefreshCw } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

import { EmptyState, LoadingState } from './shared'

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

// 彩色分级由适配层统一降噪，这里只保留语义标签
const RECOVERY: Record<string, { label: string; cls: string }> = {
  good: { label: '好', cls: 'bg-emerald-50 text-emerald-700' },
  okay: { label: '一般', cls: 'bg-sky-50 text-sky-700' },
  poor: { label: '偏弱', cls: 'bg-rose-50 text-rose-700' },
  unknown: { label: '未知', cls: 'pr-tag' },
}

function hm(min: number | null) {
  if (min == null) return '-'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}m`
}

/**
 * 恢复数据全站唯一一处（原先「运动数据」页还有一份 limit=5 的副本 + 手工录入）。
 * 手工录入能力搬到这里，和 14 天表格放一起。
 */
export function HealthRecoveryPanel() {
  const { success, error: toastError } = useToast()
  const [metrics, setMetrics] = useState<HealthMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ date: '', sleepMinutes: '', hrv: '', restingHr: '' })
  const [saving, setSaving] = useState(false)

  const fetchMetrics = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    void Promise.resolve().then(fetchMetrics)
  }, [fetchMetrics])

  const saveMetric = async () => {
    if (!draft.date) return
    setSaving(true)
    try {
      const res = await fetch('/api/health/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: draft.date,
          sleepMinutes: draft.sleepMinutes ? Number(draft.sleepMinutes) : null,
          hrv: draft.hrv ? Number(draft.hrv) : null,
          restingHr: draft.restingHr ? Number(draft.restingHr) : null,
          source: 'dashboard',
        }),
      })
      if (res.ok) {
        success('恢复数据已记录')
        setDraft({ date: '', sleepMinutes: '', hrv: '', restingHr: '' })
        await fetchMetrics()
      } else {
        toastError('保存失败，请检查日期格式')
      }
    } catch {
      toastError('保存失败，请检查网络')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="pr-title flex items-center gap-2"><HeartPulse className="h-4 w-4" /> 近 14 天恢复</h3>
        <button type="button" onClick={fetchMetrics} className="pr-btn h-8 text-xs">
          <RefreshCw className="h-3 w-3" /> 刷新
        </button>
      </div>

      {loadError && <p className="pr-meta">{loadError}</p>}

      <div className="grid gap-2 border-b pb-4 sm:grid-cols-2 lg:grid-cols-5" style={{ borderColor: 'var(--pr-line)' }}>
        <input className="pr-field h-9 px-3 text-sm outline-none" placeholder="日期 YYYY-MM-DD" value={draft.date} onChange={(e) => setDraft(prev => ({ ...prev, date: e.target.value }))} />
        <input className="pr-field h-9 px-3 text-sm outline-none" placeholder="睡眠分钟" value={draft.sleepMinutes} onChange={(e) => setDraft(prev => ({ ...prev, sleepMinutes: e.target.value }))} />
        <input className="pr-field h-9 px-3 text-sm outline-none" placeholder="HRV" value={draft.hrv} onChange={(e) => setDraft(prev => ({ ...prev, hrv: e.target.value }))} />
        <input className="pr-field h-9 px-3 text-sm outline-none" placeholder="静息心率" value={draft.restingHr} onChange={(e) => setDraft(prev => ({ ...prev, restingHr: e.target.value }))} />
        <button type="button" onClick={saveMetric} disabled={saving} className="pr-btn pr-btn-primary">
          <Plus className="h-3.5 w-3.5" />
          {saving ? '保存中' : '手工录入'}
        </button>
      </div>

      {metrics.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="pr-meta border-b" style={{ borderColor: 'var(--pr-line)' }}>
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
                  <tr key={m.date} className="border-b" style={{ borderColor: 'var(--pr-line)' }}>
                    <td className="pr-meta whitespace-nowrap px-2 py-1.5">{m.date.slice(5)}</td>
                    <td className="px-2 py-1.5">{hm(m.sleepMinutes)}</td>
                    <td className="pr-meta px-2 py-1.5">{hm(m.deepSleepMinutes)}</td>
                    <td className="pr-meta px-2 py-1.5">{hm(m.remSleepMinutes)}</td>
                    <td className="px-2 py-1.5">{m.restingHr ?? '-'}</td>
                    <td className="px-2 py-1.5">{m.hrv ?? '-'}</td>
                    <td className="px-2 py-1.5">{m.steps?.toLocaleString() ?? '-'}</td>
                    <td className="pr-meta px-2 py-1.5">{m.envAudioDb != null ? `${m.envAudioDb}dB` : '-'}</td>
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
        <EmptyState line="还没有健康数据。iOS 快捷指令上报，或在上面手工录入一条。" />
      )}
    </div>
  )
}
