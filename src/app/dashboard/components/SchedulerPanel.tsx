'use client'

import { useEffect, useState } from 'react'
import {
  BarChart3,
  Bell,
  Brain,
  Cloud,
  Play,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'

import { cn, formatDateTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

import { LoadingState } from './shared'

interface SchedulerJob {
  id: string
  name: string
  cronExpression: string
  enabled: boolean
  lastRunAt: string | null
  lastResult: string | null
  updatedAt: string
}

const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每 2 小时', value: '0 */2 * * *' },
  { label: '每 6 小时', value: '0 */6 * * *' },
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '每天 21:00', value: '0 21 * * *' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
  { label: '自定义', value: '__custom__' },
]

export function SchedulerPanel() {
  const { success, error: toastError } = useToast()
  const [jobs, setJobs] = useState<SchedulerJob[]>([])
  const [loading, setLoading] = useState(true)
  const [editingJob, setEditingJob] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [customCron, setCustomCron] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fetchJobs = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/scheduler', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setJobs(data.jobs)
        setLoadError(null)
      } else {
        setLoadError(`加载任务失败 (HTTP ${res.status})`)
      }
    } catch (e) {
      setLoadError(`加载任务失败: ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchJobs()
  }, [])

  function startEdit(job: SchedulerJob) {
    setEditingJob(job.id)
    const isPreset = CRON_PRESETS.some(p => p.value === job.cronExpression && p.value !== '__custom__')
    setEditValue(isPreset ? job.cronExpression : '__custom__')
    setCustomCron(isPreset ? '' : job.cronExpression)
  }

  async function saveJob(id: string) {
    const cronExpr = editValue === '__custom__' ? customCron : editValue
    if (!cronExpr) return

    setSaving(true)
    try {
      const res = await fetch('/api/scheduler', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, cronExpression: cronExpr }),
      })
      if (!res.ok) {
        toastError(`保存任务失败 (HTTP ${res.status})`)
        return
      }
      setEditingJob(null)
      await fetchJobs()
      success('任务已保存')
    } catch (e) {
      toastError(`保存任务失败: ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setSaving(false)
  }

  async function toggleJob(id: string, enabled: boolean) {
    setSaving(true)
    try {
      const res = await fetch('/api/scheduler', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      })
      if (!res.ok) {
        toastError(`${enabled ? '启用' : '暂停'}任务失败 (HTTP ${res.status})`)
        return
      }
      await fetchJobs()
      success(enabled ? '任务已启用' : '任务已暂停')
    } catch (e) {
      toastError(`切换任务失败: ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setSaving(false)
  }

  async function triggerJob(action: string) {
    try {
      const res = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      const message = data.message || (data.success ? '执行成功' : '执行失败')
      // Reason: cron 接口的成功信号散落在 message 文本里（成功/Synced/Generated/sent），统一判定
      const ok = data.success || /成功|Synced|Generated|sent/.test(message)
      if (ok) {
        success(`${action}: ${message}`)
      } else {
        toastError(`${action}: ${message}`)
      }
    } catch (e) {
      toastError(`${action}: 请求失败 (${e instanceof Error ? e.message : '网络错误'})`)
    }
  }

  if (loading) return <LoadingState />

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">任务调度</h2>
          <p className="text-muted-foreground text-xs mt-1">配置定时任务的执行频率和通知时间</p>
        </div>
        <button
          type="button"
          onClick={fetchJobs}
          className="bg-background hover:bg-accent flex h-9 items-center gap-2 rounded-md border px-3 text-sm shadow-sm transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          刷新
        </button>
      </header>

      {/* Load Error Banner */}
      {loadError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {loadError}
        </div>
      )}

      {/* Manual Triggers */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">手动触发</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { action: 'sync', label: '同步数据', icon: Cloud, desc: '立即从 Strava 同步运动数据' },
            { action: 'insights', label: 'AI 分析', icon: Brain, desc: '为未分析的活动生成 AI 洞察' },
            { action: 'notify', label: '发送报告', icon: Bell, desc: '立即推送今日训练报告到微信' },
            { action: 'analytics-digest', label: '访问日报', icon: BarChart3, desc: '推送今日访问数据摘要到微信' },
          ].map(item => (
            <div key={item.action} className="bg-card rounded-lg border p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <item.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{item.label}</span>
              </div>
              <p className="text-muted-foreground text-xs mb-3">{item.desc}</p>
              <button
                type="button"
                onClick={() => triggerJob(item.action)}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium shadow-sm transition-colors"
              >
                <Play className="h-3 w-3" />
                立即执行
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Scheduled Jobs */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">定时任务</h3>
        <div className="space-y-3">
          {jobs.map(job => (
            <div key={job.id} className="bg-card rounded-lg border p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => toggleJob(job.id, !job.enabled)}
                    disabled={saving}
                    className="shrink-0"
                  >
                    {job.enabled ? (
                      <ToggleRight className="h-6 w-6 text-emerald-500" />
                    ) : (
                      <ToggleLeft className="h-6 w-6 text-muted-foreground" />
                    )}
                  </button>
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{job.name}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="text-muted-foreground font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                        {job.cronExpression}
                      </code>
                      {!job.enabled && (
                        <span className="text-amber-600 text-xs">已暂停</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {job.lastRunAt && (
                    <span className="text-muted-foreground text-xs">
                      上次执行: {formatDateTime(job.lastRunAt)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(job)}
                    className="bg-background hover:bg-accent flex h-8 items-center gap-1 rounded-md border px-3 text-xs shadow-sm transition-colors"
                  >
                    编辑
                  </button>
                </div>
              </div>

              {/* Edit Inline */}
              {editingJob === job.id && (
                <div className="mt-3 pt-3 border-t space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Cron 表达式</label>
                    <div className="flex flex-wrap gap-2">
                      {CRON_PRESETS.map(preset => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setEditValue(preset.value)}
                          className={cn(
                            'rounded-md px-3 py-1.5 text-xs border transition-colors',
                            editValue === preset.value
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-background hover:bg-accent',
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {editValue === '__custom__' && (
                    <input
                      type="text"
                      value={customCron}
                      onChange={e => setCustomCron(e.target.value)}
                      placeholder="分 时 日 月 周 (例: 0 9 * * *)"
                      className="border-input bg-background focus:border-ring h-9 w-full max-w-sm rounded-md border px-3 font-mono text-xs shadow-sm outline-none focus:ring-[3px]"
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveJob(job.id)}
                      disabled={saving || (editValue === '__custom__' && !customCron)}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-8 items-center gap-1 rounded-md px-3 text-xs font-medium shadow-sm transition-colors disabled:opacity-50"
                    >
                      {saving ? '保存中...' : '保存'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingJob(null)}
                      className="bg-background hover:bg-accent flex h-8 items-center gap-1 rounded-md border px-3 text-xs shadow-sm transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
