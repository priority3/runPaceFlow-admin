'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react'

import { useToast } from '@/components/ui/toast'

/**
 * PR 伙伴的定时任务(执行在 pr-agent,管理在这里)。
 *
 * 这些 job 的清单、cron、执行历史都由 pr-agent 持有 —— 本组件是纯客户端,
 * 经 /api/pr/jobs 代理读写。刻意不在本仓复刻一份 job 定义:此前 admin 曾登记过
 * 同名 job,结果渲染成「可改、保存成功」但本进程没有 handler 的假开关。
 *
 * 下次触发时刻与生效时区都由 pr-agent 算好返回,前端零 cron 解析逻辑。
 */

interface JobRun {
  startedAt: number
  durationMs: number | null
  ok: boolean
  message: string | null
}

interface PrJob {
  id: string
  name: string
  cronExpression: string
  cronSource: 'db' | 'env' | 'default'
  defaultCron: string
  enabled: boolean
  nextRunAt: number | null
  lastRun: JobRun | null
  runs: JobRun[]
}

interface JobsResponse {
  timezone: string
  historyLimit: number
  schedulerDisabled: boolean
  jobs: PrJob[]
}

const SOURCE_LABEL: Record<PrJob['cronSource'], string> = {
  db: '面板已改',
  env: '环境变量',
  default: '默认',
}

function fmtTime(sec: number | null) {
  if (!sec) return '—'
  return new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false })
}

function fmtDuration(ms: number | null) {
  if (ms == null) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** 相对时间:下次触发用「还有 x」,历史用「x 前」。 */
function fmtRelative(sec: number, nowSec: number) {
  const diff = Math.abs(sec - nowSec)
  const future = sec > nowSec
  const unit =
    diff < 60 ? `${Math.round(diff)} 秒`
      : diff < 3600 ? `${Math.round(diff / 60)} 分钟`
        : diff < 86400 ? `${Math.round(diff / 3600)} 小时`
          : `${Math.round(diff / 86400)} 天`
  return future ? `还有 ${unit}` : `${unit}前`
}

export function PrJobsPanel() {
  const { success, error: toastError } = useToast()
  const [data, setData] = useState<JobsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  // Reason: 相对时间要在客户端算,但直接用 Date.now() 会让首屏与服务端渲染不一致;
  // 挂载后再取一次,未挂载时不渲染相对时间。
  const [nowSec, setNowSec] = useState<number | null>(null)

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/pr/jobs', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json as JobsResponse)
      setLoadError(null)
      setNowSec(Math.floor(Date.now() / 1000))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '加载失败')
    }
    setLoading(false)
  }, [])

  // Reason: 推到微任务再跑,避免在 effect 体内同步 setState 触发级联渲染
  // (react-hooks/set-state-in-effect);与 SchedulerPanel 的首屏加载写法保持一致。
  useEffect(() => {
    void Promise.resolve().then(fetchJobs)
  }, [fetchJobs])

  async function patchJob(id: string, name: string, patch: { cronExpression?: string | null; enabled?: boolean }) {
    setSaving(id)
    try {
      const res = await fetch(`/api/pr/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      success(`${name}:已保存并生效`)
      setEditing(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await fetchJobs()
    } catch (e) {
      toastError(`${name}:${e instanceof Error ? e.message : '保存失败'}`)
    }
    setSaving(null)
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载 PR 伙伴任务…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="flex items-center gap-1.5 font-medium">
          <AlertCircle className="h-4 w-4" />
          PR 伙伴任务读取失败:{loadError}
        </p>
        <p className="mt-1 text-xs text-amber-800">
          这些任务由 pr-agent 执行。若它不可达,请检查 PR_AGENT_URL 与容器状态 ——
          此处显示失败并不代表任务没在跑。
        </p>
      </div>
    )
  }

  if (!data) return null

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">PR 伙伴任务</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            由 pr-agent 执行,在此管理 · cron 按 <code className="font-mono">{data.timezone}</code> 解释 ·
            保存后立即生效,无需重启
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchJobs()}
          className="bg-background hover:bg-accent flex h-8 items-center gap-2 rounded-md border px-3 text-xs shadow-sm transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>

      {data.schedulerDisabled && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          pr-agent 的调度总开关已关闭(<code className="font-mono">PR_SCHEDULER=off</code>)——
          下列任务**都不会自动触发**,改 cron 也不会生效。
        </div>
      )}

      <div className="space-y-2">
        {data.jobs.map(job => {
          const draft = editing[job.id]
          const dirty = draft !== undefined && draft.trim() !== job.cronExpression
          const isSaving = saving === job.id
          return (
            <div key={job.id} className="bg-card rounded-lg border p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void patchJob(job.id, job.name, { enabled: !job.enabled })}
                      disabled={isSaving}
                      title={job.enabled ? '点击关闭' : '点击开启'}
                      className="disabled:opacity-50"
                    >
                      {job.enabled ? (
                        <ToggleRight className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <ToggleLeft className="text-muted-foreground h-5 w-5" />
                      )}
                    </button>
                    <span className={`text-sm font-medium ${job.enabled ? '' : 'text-muted-foreground'}`}>
                      {job.name}
                    </span>
                    {job.cronSource !== 'default' && (
                      <span className="text-muted-foreground rounded bg-muted px-1.5 py-0.5 text-xs">
                        {SOURCE_LABEL[job.cronSource]}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={draft ?? job.cronExpression}
                      onChange={e => setEditing(prev => ({ ...prev, [job.id]: e.target.value }))}
                      spellCheck={false}
                      className="border-input bg-background focus:border-ring h-8 w-40 rounded-md border px-2 font-mono text-xs shadow-sm outline-none focus:ring-[3px]"
                    />
                    {dirty && (
                      <button
                        type="button"
                        onClick={() => void patchJob(job.id, job.name, { cronExpression: draft.trim() })}
                        disabled={isSaving}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium disabled:opacity-50"
                      >
                        {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                        保存
                      </button>
                    )}
                    {job.cronSource === 'db' && !dirty && (
                      <button
                        type="button"
                        onClick={() => void patchJob(job.id, job.name, { cronExpression: null })}
                        disabled={isSaving}
                        title={`恢复为 ${job.defaultCron}`}
                        className="text-muted-foreground hover:bg-accent h-8 rounded-md border px-2 text-xs disabled:opacity-50"
                      >
                        复位
                      </button>
                    )}
                  </div>
                </div>

                <div className="text-xs">
                  <p className="flex items-center gap-1.5">
                    <Clock className="text-muted-foreground h-3 w-3" />
                    <span className="text-muted-foreground">下次</span>
                    <span className="font-mono">{fmtTime(job.nextRunAt)}</span>
                    {job.nextRunAt && nowSec && (
                      <span className="text-muted-foreground">({fmtRelative(job.nextRunAt, nowSec)})</span>
                    )}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5">
                    {job.lastRun ? (
                      job.lastRun.ok ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
                      ) : (
                        <AlertCircle className="h-3 w-3 shrink-0 text-red-600" />
                      )
                    ) : null}
                    <span className="text-muted-foreground">上次</span>
                    <span className="font-mono">{job.lastRun ? fmtTime(job.lastRun.startedAt) : '尚未执行'}</span>
                    {job.lastRun && (
                      <span className="text-muted-foreground">{fmtDuration(job.lastRun.durationMs)}</span>
                    )}
                  </p>
                  {job.runs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === job.id ? null : job.id)}
                      className="text-muted-foreground hover:text-foreground mt-1 text-xs underline"
                    >
                      {expanded === job.id ? '收起' : `历史 ${job.runs.length} 条`}
                    </button>
                  )}
                </div>
              </div>

              {expanded === job.id && (
                <table className="mt-3 w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1 text-left font-normal">时间</th>
                      <th className="py-1 text-right font-normal">耗时</th>
                      <th className="py-1 text-left font-normal">结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.runs.map(run => (
                      <tr key={run.startedAt} className="border-b last:border-b-0">
                        <td className="py-1 font-mono">{fmtTime(run.startedAt)}</td>
                        <td className="py-1 text-right font-mono">{fmtDuration(run.durationMs)}</td>
                        <td className={`py-1 ${run.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                          {run.ok ? '成功' : '失败'}
                          {run.message && run.message !== 'ok' && (
                            <span className="text-muted-foreground ml-1 break-all">{run.message}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-muted-foreground mt-2 text-xs">
        每个任务保留最近 {data.historyLimit} 次执行记录。
      </p>
    </section>
  )
}
