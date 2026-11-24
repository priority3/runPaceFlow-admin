'use client'

import { useEffect, useState } from 'react'
import { BookOpen, Search } from 'lucide-react'

import { EmptyState, LoadingState } from './shared'

interface DiaryEntry {
  id: string
  periodStart: string
  periodEnd: string
  content: string
  model: string
  createdAt: string
}

interface AgentRun {
  id: string
  trigger: string
  subjectType: string | null
  subjectId: string | null
  status: string
  lastStep: string | null
  errorMessage: string | null
  createdAt: string | null
}

interface Flywheel {
  factGrowth: number
  feedbackRate: number
  memoryConfirmationRate: number
  contextHitRate: number
}

/**
 * PR 的运行侧指标：飞轮效率、周总结/老友日记、agent 运行审计。
 * 这三块原本塞在「运动数据」页里，现在和记忆/复盘/恢复一起归到 PR 伙伴。
 */
export function PrOpsPanel() {
  const [flywheel, setFlywheel] = useState<Flywheel | null>(null)
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([])
  const [weeklyGenerating, setWeeklyGenerating] = useState(false)
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([])
  const [contextPreview, setContextPreview] = useState<{ runId: string; text: string } | null>(null)
  const [contextLoadingId, setContextLoadingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchFlywheel = async () => {
    try {
      const res = await fetch('/api/pr/flywheel?days=30', { cache: 'no-store' })
      const data = await res.json()
      setFlywheel(data.flywheel ?? null)
    } catch {
      setFlywheel(null)
    }
  }

  const fetchDiaryEntries = async () => {
    try {
      const res = await fetch('/api/pr/diary?limit=3', { cache: 'no-store' })
      const data = await res.json()
      setDiaryEntries(data.entries ?? [])
    } catch {
      setDiaryEntries([])
    }
  }

  const fetchAgentRuns = async () => {
    try {
      const res = await fetch('/api/pr/agent-runs?limit=8', { cache: 'no-store' })
      const data = await res.json()
      setAgentRuns(data.runs ?? [])
    } catch {
      setAgentRuns([])
    }
  }

  const generateWeekly = async () => {
    setWeeklyGenerating(true)
    try {
      await fetch('/api/pr/weekly-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      // 周总结本身也是一条 review，通知上面的反思列表一起刷新
      window.dispatchEvent(new Event('pr:reviews-refresh'))
      await Promise.all([fetchAgentRuns(), fetchDiaryEntries(), fetchFlywheel()])
    } finally {
      setWeeklyGenerating(false)
    }
  }

  const inspectRunContext = async (runId: string) => {
    setContextLoadingId(runId)
    try {
      const res = await fetch(`/api/pr/context/${runId}`, { cache: 'no-store' })
      const data = await res.json()
      setContextPreview({
        runId,
        text: JSON.stringify(data.context ?? data, null, 2).slice(0, 2600),
      })
    } finally {
      setContextLoadingId(null)
    }
  }

  useEffect(() => {
    void Promise.resolve().then(async () => {
      await Promise.all([fetchFlywheel(), fetchDiaryEntries(), fetchAgentRuns()])
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingState />

  return (
    <div className="space-y-8">
      {flywheel && (
        <section>
          <h3 className="pr-title mb-4">PR 飞轮 · 近 30 天</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: '新增事实', value: String(flywheel.factGrowth) },
              { label: '反馈率', value: `${(flywheel.feedbackRate * 100).toFixed(0)}%` },
              { label: '记忆确认', value: `${(flywheel.memoryConfirmationRate * 100).toFixed(0)}%` },
              { label: '上下文命中', value: `${(flywheel.contextHitRate * 100).toFixed(0)}%` },
            ].map(item => (
              <div key={item.label} className="border-b pb-5" style={{ borderColor: 'var(--pr-line)' }}>
                <p className="pr-kpi-label">{item.label}</p>
                <p className="pr-kpi mt-2">{item.value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="pr-title flex items-center gap-2"><BookOpen className="h-4 w-4" />周总结与老友日记</h3>
          <button
            type="button"
            onClick={generateWeekly}
            disabled={weeklyGenerating}
            className="pr-btn h-8 text-xs"
          >
            {weeklyGenerating ? '生成中' : '生成周总结'}
          </button>
        </div>
        {diaryEntries.length === 0 ? (
          <EmptyState line="还没有老友日记。点「生成周总结」，PR 会把这一周写下来。" />
        ) : (
          <div>
            {diaryEntries.map(entry => (
              <div key={entry.id} className="pr-row py-3">
                <div className="pr-row-main">
                  <p className="pr-meta mb-2">{entry.periodStart.slice(0, 10)} ~ {entry.periodEnd.slice(0, 10)} · {entry.model}</p>
                  <p className="whitespace-pre-wrap text-sm leading-6">{entry.content}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="pr-title mb-3">PR 运行审计</h3>
        {agentRuns.length === 0 ? (
          <EmptyState line="还没有 PR 运行记录。同步活动或生成复盘后会出现在这里。" />
        ) : (
          <div>
            {agentRuns.map(run => (
              <div key={run.id} className="pr-row flex-col gap-2 py-3 lg:flex-row lg:items-center">
                <div className="pr-row-main">
                  <p className="truncate text-sm font-medium">
                    {run.trigger} · {run.subjectType ?? '—'}:{run.subjectId ?? '—'}
                  </p>
                  <p className="pr-meta mt-1">
                    {run.status} · {run.lastStep ?? '—'} · {run.createdAt ? new Date(run.createdAt).toLocaleString() : '—'}
                  </p>
                  {run.errorMessage && <p className="pr-meta mt-1 truncate">{run.errorMessage}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => inspectRunContext(run.id)}
                  disabled={contextLoadingId === run.id}
                  className="pr-btn h-8 shrink-0 text-xs"
                >
                  <Search className="h-3.5 w-3.5" />
                  {contextLoadingId === run.id ? '读取中' : '查看上下文'}
                </button>
              </div>
            ))}
          </div>
        )}
        {contextPreview && (
          <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--pr-line)' }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="pr-title">Context Snapshot</span>
              <button type="button" onClick={() => setContextPreview(null)} className="pr-meta hover:opacity-70">关闭</button>
            </div>
            <pre className="pr-scroll max-h-80 overflow-auto text-xs leading-5">{contextPreview.text}</pre>
          </div>
        )}
      </section>
    </div>
  )
}
