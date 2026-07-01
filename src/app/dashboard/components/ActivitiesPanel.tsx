'use client'

import { useEffect, useState } from 'react'
import { Bell, BookOpen, CalendarDays, Footprints, MapIcon, Plus, RefreshCw, Search, Timer, TrendingUp } from 'lucide-react'

import { LoadingState, StatCard } from './shared'

interface ActivityStats {
  total: { activities: number; distance: number; duration: number; elevation: number; averagePace: number }
  thisWeek: { activities: number; distance: number; duration: number }
  lastWeek: { activities: number; distance: number; duration: number }
  thisMonth: { activities: number; distance: number; duration: number }
  byType: {
    running: { total: { activities: number; distance: number } }
    cycling: { total: { activities: number; distance: number } }
  }
}

export function ActivitiesPanel({ stats, loading }: { stats: ActivityStats | null; loading: boolean }) {
  const [raceGoals, setRaceGoals] = useState<Array<{
    id: string
    name: string
    raceDate: string
    distanceMeters: number
    targetType: string
    targetTimeSec: number | null
    priority: string
    status: string
    notes: string | null
    daysUntilRace: number
  }>>([])
  const [healthMetrics, setHealthMetrics] = useState<Array<{
    id: string
    date: string
    sleepMinutes: number | null
    deepSleepMinutes: number | null
    remSleepMinutes: number | null
    hrv: number | null
    restingHr: number | null
    source: string
    recoveryLabel: 'good' | 'okay' | 'poor' | 'unknown'
  }>>([])
  const [goalDraft, setGoalDraft] = useState({ name: '', raceDate: '', distanceMeters: '', targetType: 'time', targetTimeSec: '', notes: '' })
  const [healthDraft, setHealthDraft] = useState({ date: '', sleepMinutes: '', hrv: '', restingHr: '' })
  const [goalSaving, setGoalSaving] = useState(false)
  const [healthSaving, setHealthSaving] = useState(false)
  const [weeklyGenerating, setWeeklyGenerating] = useState(false)
  const [diaryEntries, setDiaryEntries] = useState<Array<{
    id: string
    periodStart: string
    periodEnd: string
    content: string
    model: string
    createdAt: string
  }>>([])
  const [lifeEvents, setLifeEvents] = useState<Array<{
    id: string
    type: string
    occurredAt: string
    mediaUrl: string | null
    rawText: string | null
    observation: Record<string, unknown> | null
    createdAt: string
  }>>([])
  const [lifeDraft, setLifeDraft] = useState({ type: 'manual_note', rawText: '', mediaUrl: '' })
  const [lifeSaving, setLifeSaving] = useState(false)
  const [flywheel, setFlywheel] = useState<{
    factGrowth: number
    feedbackRate: number
    memoryConfirmationRate: number
    contextHitRate: number
    notificationEngagementRate: number
  } | null>(null)
  const [reviews, setReviews] = useState<Array<{
    id: string
    activityId: string | null
    content: string
    model: string
    provider: string | null
    createdAt: string
  }>>([])
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [notifyingId, setNotifyingId] = useState<string | null>(null)
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, { rpe: string; note: string }>>({})
  const [savingFeedbackId, setSavingFeedbackId] = useState<string | null>(null)
  const [memories, setMemories] = useState<Array<{
    id: string
    type: string
    status: string
    content: string
    confidence: number
  }>>([])
  const [memoryActionId, setMemoryActionId] = useState<string | null>(null)
  const [agentRuns, setAgentRuns] = useState<Array<{
    id: string
    trigger: string
    subjectType: string | null
    subjectId: string | null
    status: string
    lastStep: string | null
    errorMessage: string | null
    createdAt: string | null
  }>>([])
  const [contextPreview, setContextPreview] = useState<{ runId: string; text: string } | null>(null)
  const [contextLoadingId, setContextLoadingId] = useState<string | null>(null)

  const fetchReviews = async () => {
    setReviewsLoading(true)
    try {
      const res = await fetch('/api/activities/reviews?limit=5', { cache: 'no-store' })
      const data = await res.json()
      setReviews(data.reviews ?? [])
    } catch {
      setReviews([])
    } finally {
      setReviewsLoading(false)
    }
  }

  const fetchMemories = async () => {
    try {
      const res = await fetch('/api/pr/memories?status=candidate,active', { cache: 'no-store' })
      const data = await res.json()
      setMemories(data.memories ?? [])
    } catch {
      setMemories([])
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

  const fetchRaceGoals = async () => {
    try {
      const res = await fetch('/api/race-goals?status=active', { cache: 'no-store' })
      const data = await res.json()
      setRaceGoals(data.goals ?? [])
    } catch {
      setRaceGoals([])
    }
  }

  const fetchHealthMetrics = async () => {
    try {
      const res = await fetch('/api/health/daily?limit=5', { cache: 'no-store' })
      const data = await res.json()
      setHealthMetrics(data.metrics ?? [])
    } catch {
      setHealthMetrics([])
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

  const fetchLifeEvents = async () => {
    try {
      const res = await fetch('/api/life-events?limit=5', { cache: 'no-store' })
      const data = await res.json()
      setLifeEvents(data.events ?? [])
    } catch {
      setLifeEvents([])
    }
  }

  const fetchFlywheel = async () => {
    try {
      const res = await fetch('/api/pr/flywheel?days=30', { cache: 'no-store' })
      const data = await res.json()
      setFlywheel(data.flywheel ?? null)
    } catch {
      setFlywheel(null)
    }
  }

  const regenerateReview = async (activityId: string | null) => {
    if (!activityId) return
    setRegeneratingId(activityId)
    try {
      await fetch('/api/activities/reviews/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId, enqueueNotification: false }),
      })
      await fetchReviews()
    } finally {
      setRegeneratingId(null)
    }
  }

  const notifyReview = async (reviewId: string) => {
    setNotifyingId(reviewId)
    try {
      await fetch('/api/activities/reviews/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, dispatchNow: true }),
      })
    } finally {
      setNotifyingId(null)
    }
  }

  const submitFeedback = async (activityId: string | null) => {
    if (!activityId) return
    const draft = feedbackDrafts[activityId]
    if (!draft?.rpe && !draft?.note) return

    setSavingFeedbackId(activityId)
    try {
      await fetch('/api/activities/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId,
          rpe: draft.rpe ? Number(draft.rpe) : null,
          note: draft.note,
          enqueueNotification: false,
        }),
      })
      setFeedbackDrafts(prev => ({ ...prev, [activityId]: { rpe: '', note: '' } }))
      await fetchReviews()
      await fetchMemories()
    } finally {
      setSavingFeedbackId(null)
    }
  }

  const updateMemory = async (memoryId: string, action: 'confirm' | 'archive') => {
    setMemoryActionId(memoryId)
    try {
      await fetch(`/api/pr/memories/${memoryId}/${action}`, { method: 'POST' })
      await fetchMemories()
    } finally {
      setMemoryActionId(null)
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

  const createRaceGoal = async () => {
    if (!goalDraft.name || !goalDraft.raceDate || !goalDraft.distanceMeters || !goalDraft.targetType) return
    setGoalSaving(true)
    try {
      await fetch('/api/race-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: goalDraft.name,
          raceDate: goalDraft.raceDate,
          distanceMeters: Number(goalDraft.distanceMeters),
          targetType: goalDraft.targetType,
          targetTimeSec: goalDraft.targetTimeSec ? Number(goalDraft.targetTimeSec) : null,
          notes: goalDraft.notes || null,
        }),
      })
      setGoalDraft({ name: '', raceDate: '', distanceMeters: '', targetType: 'time', targetTimeSec: '', notes: '' })
      await fetchRaceGoals()
    } finally {
      setGoalSaving(false)
    }
  }

  const saveHealthMetric = async () => {
    if (!healthDraft.date) return
    setHealthSaving(true)
    try {
      await fetch('/api/health/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: healthDraft.date,
          sleepMinutes: healthDraft.sleepMinutes ? Number(healthDraft.sleepMinutes) : null,
          hrv: healthDraft.hrv ? Number(healthDraft.hrv) : null,
          restingHr: healthDraft.restingHr ? Number(healthDraft.restingHr) : null,
          source: 'dashboard',
        }),
      })
      setHealthDraft({ date: '', sleepMinutes: '', hrv: '', restingHr: '' })
      await fetchHealthMetrics()
    } finally {
      setHealthSaving(false)
    }
  }

  const generateWeekly = async () => {
    setWeeklyGenerating(true)
    try {
      await fetch('/api/pr/weekly-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, enqueueNotification: false }),
      })
      await fetchReviews()
      await fetchAgentRuns()
      await fetchDiaryEntries()
    } finally {
      setWeeklyGenerating(false)
    }
  }

  const createLifeEvent = async () => {
    if (!lifeDraft.rawText && !lifeDraft.mediaUrl) return
    setLifeSaving(true)
    try {
      await fetch('/api/life-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: lifeDraft.type,
          rawText: lifeDraft.rawText || null,
          mediaUrl: lifeDraft.mediaUrl || null,
        }),
      })
      setLifeDraft({ type: 'manual_note', rawText: '', mediaUrl: '' })
      await fetchLifeEvents()
    } finally {
      setLifeSaving(false)
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => {
      fetchReviews()
      fetchMemories()
      fetchAgentRuns()
      fetchRaceGoals()
      fetchHealthMetrics()
      fetchDiaryEntries()
      fetchLifeEvents()
      fetchFlywheel()
    })
  }, [])

  if (loading) return <LoadingState />

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  const formatPace = (pace: number) => {
    if (!pace || pace <= 0) return '-'
    const min = Math.floor(pace / 60)
    const sec = Math.floor(pace % 60)
    return `${min}'${String(sec).padStart(2, '0')}"`
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4">
        <h2 className="text-xl font-semibold">运动数据</h2>
      </header>

      {flywheel && (
        <section>
          <h3 className="mb-3 text-sm font-semibold">PR 飞轮</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border bg-card p-3 shadow-sm">
              <p className="text-muted-foreground text-xs">新增事实</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{flywheel.factGrowth}</p>
            </div>
            <div className="rounded-lg border bg-card p-3 shadow-sm">
              <p className="text-muted-foreground text-xs">反馈率</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{(flywheel.feedbackRate * 100).toFixed(0)}%</p>
            </div>
            <div className="rounded-lg border bg-card p-3 shadow-sm">
              <p className="text-muted-foreground text-xs">记忆确认</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{(flywheel.memoryConfirmationRate * 100).toFixed(0)}%</p>
            </div>
            <div className="rounded-lg border bg-card p-3 shadow-sm">
              <p className="text-muted-foreground text-xs">上下文命中</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{(flywheel.contextHitRate * 100).toFixed(0)}%</p>
            </div>
            <div className="rounded-lg border bg-card p-3 shadow-sm">
              <p className="text-muted-foreground text-xs">通知送达</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{(flywheel.notificationEngagementRate * 100).toFixed(0)}%</p>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">比赛目标</h3>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          <div className="grid gap-2 border-b p-4 sm:grid-cols-2 lg:grid-cols-3">
            <input className="h-9 rounded-md border bg-background px-3 text-sm" placeholder="目标名称" value={goalDraft.name} onChange={(e) => setGoalDraft(prev => ({ ...prev, name: e.target.value }))} />
            <input className="h-9 rounded-md border bg-background px-3 text-sm" placeholder="比赛日期 YYYY-MM-DD" value={goalDraft.raceDate} onChange={(e) => setGoalDraft(prev => ({ ...prev, raceDate: e.target.value }))} />
            <input className="h-9 rounded-md border bg-background px-3 text-sm" placeholder="距离米数" value={goalDraft.distanceMeters} onChange={(e) => setGoalDraft(prev => ({ ...prev, distanceMeters: e.target.value }))} />
            <input className="h-9 rounded-md border bg-background px-3 text-sm" placeholder="目标类型" value={goalDraft.targetType} onChange={(e) => setGoalDraft(prev => ({ ...prev, targetType: e.target.value }))} />
            <input className="h-9 rounded-md border bg-background px-3 text-sm" placeholder="目标时间(秒)" value={goalDraft.targetTimeSec} onChange={(e) => setGoalDraft(prev => ({ ...prev, targetTimeSec: e.target.value }))} />
            <input className="h-9 rounded-md border bg-background px-3 text-sm" placeholder="备注" value={goalDraft.notes} onChange={(e) => setGoalDraft(prev => ({ ...prev, notes: e.target.value }))} />
            <button type="button" onClick={createRaceGoal} disabled={goalSaving} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 sm:col-span-2 lg:col-span-3">
              <Plus className="h-4 w-4" />
              {goalSaving ? '保存中' : '添加目标'}
            </button>
          </div>
          <div className="divide-y">
            {raceGoals.length === 0 ? (
              <div className="text-muted-foreground px-4 py-6 text-sm">暂无 active 比赛目标。</div>
            ) : (
              raceGoals.map(goal => (
                <div key={goal.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{goal.name}</span>
                    <span className="text-muted-foreground text-xs">{goal.daysUntilRace} 天后</span>
                  </div>
                  <p className="text-muted-foreground text-xs">{(goal.distanceMeters / 1000).toFixed(1)} km · {goal.raceDate.slice(0, 10)} · {goal.targetType}</p>
                  {goal.notes && <p className="text-xs">{goal.notes}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">恢复数据</h3>
          <Timer className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          <div className="grid gap-2 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
            <input className="h-9 rounded-md border bg-background px-3 text-sm" placeholder="日期 YYYY-MM-DD" value={healthDraft.date} onChange={(e) => setHealthDraft(prev => ({ ...prev, date: e.target.value }))} />
            <input className="h-9 rounded-md border bg-background px-3 text-sm" placeholder="睡眠分钟" value={healthDraft.sleepMinutes} onChange={(e) => setHealthDraft(prev => ({ ...prev, sleepMinutes: e.target.value }))} />
            <input className="h-9 rounded-md border bg-background px-3 text-sm" placeholder="HRV" value={healthDraft.hrv} onChange={(e) => setHealthDraft(prev => ({ ...prev, hrv: e.target.value }))} />
            <input className="h-9 rounded-md border bg-background px-3 text-sm" placeholder="静息心率" value={healthDraft.restingHr} onChange={(e) => setHealthDraft(prev => ({ ...prev, restingHr: e.target.value }))} />
            <button type="button" onClick={saveHealthMetric} disabled={healthSaving} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 sm:col-span-2 lg:col-span-4">
              <Plus className="h-4 w-4" />
              {healthSaving ? '保存中' : '添加恢复数据'}
            </button>
          </div>
          <div className="divide-y">
            {healthMetrics.length === 0 ? (
              <div className="text-muted-foreground px-4 py-6 text-sm">暂无恢复数据。</div>
            ) : (
              healthMetrics.map(metric => (
                <div key={metric.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{metric.date}</p>
                    <p className="text-muted-foreground text-xs">
                      睡眠 {metric.sleepMinutes ?? '-'} · HRV {metric.hrv ?? '-'} · 静息心率 {metric.restingHr ?? '-'}
                    </p>
                  </div>
                  <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">{metric.recoveryLabel}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">生活观察</h3>
          <BookOpen className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          <div className="grid gap-2 border-b p-4 sm:grid-cols-[160px_1fr]">
            <select
              value={lifeDraft.type}
              onChange={(e) => setLifeDraft(prev => ({ ...prev, type: e.target.value }))}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="manual_note">手动备注</option>
              <option value="morning_photo">早起照片</option>
              <option value="meal_photo">饮食照片</option>
              <option value="gear_photo">装备照片</option>
              <option value="injury_photo">伤痛照片</option>
            </select>
            <input
              className="h-9 rounded-md border bg-background px-3 text-sm"
              placeholder="备注"
              value={lifeDraft.rawText}
              onChange={(e) => setLifeDraft(prev => ({ ...prev, rawText: e.target.value }))}
            />
            <input
              className="h-9 rounded-md border bg-background px-3 text-sm sm:col-span-2"
              placeholder="媒体 URL"
              value={lifeDraft.mediaUrl}
              onChange={(e) => setLifeDraft(prev => ({ ...prev, mediaUrl: e.target.value }))}
            />
            <button type="button" onClick={createLifeEvent} disabled={lifeSaving} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 sm:col-span-2">
              <Plus className="h-4 w-4" />
              {lifeSaving ? '保存中' : '添加生活观察'}
            </button>
          </div>
          <div className="divide-y">
            {lifeEvents.length === 0 ? (
              <div className="text-muted-foreground px-4 py-6 text-sm">暂无生活观察。</div>
            ) : (
              lifeEvents.map(event => (
                <article key={event.id} className="px-4 py-3 text-sm">
                  <p className="text-muted-foreground mb-1 text-xs">{event.type} · {event.occurredAt.slice(0, 10)}</p>
                  <p>{String(event.observation?.summary ?? event.rawText ?? '-')}</p>
                  {event.mediaUrl && <p className="text-muted-foreground mt-1 truncate text-xs">{event.mediaUrl}</p>}
                </article>
              ))
            )}
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">时段对比</h3>
        <div className="bg-card rounded-lg border overflow-hidden shadow-sm">
          <div className="bg-muted/50 grid grid-cols-4 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>时段</span><span className="text-right">活动数</span><span className="text-right">里程</span><span className="text-right">时长</span>
          </div>
          {stats && [
            { label: '本周', data: stats.thisWeek },
            { label: '上周', data: stats.lastWeek },
            { label: '本月', data: stats.thisMonth },
          ].map(row => (
            <div key={row.label} className="grid grid-cols-4 gap-4 border-t px-4 py-3 text-sm">
              <span className="font-medium">{row.label}</span>
              <span className="text-right tabular-nums">{row.data.activities}</span>
              <span className="text-right tabular-nums">{(row.data.distance / 1000).toFixed(1)} km</span>
              <span className="text-right tabular-nums">{formatDuration(row.data.duration)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Total Stats */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">累计数据</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Footprints} label="总活动" value={String(stats?.total.activities ?? 0)} />
          <StatCard icon={TrendingUp} label="总里程" value={`${((stats?.total.distance ?? 0) / 1000).toFixed(1)} km`} />
          <StatCard icon={Timer} label="总时长" value={formatDuration(stats?.total.duration ?? 0)} />
          <StatCard icon={MapIcon} label="平均配速" value={formatPace(stats?.total.averagePace ?? 0)} />
        </div>
      </section>

      {/* By Type */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">按类型</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="bg-card rounded-lg border p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Footprints className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">跑步</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">活动数</span><p className="font-semibold tabular-nums">{stats?.byType.running.total.activities ?? 0}</p></div>
              <div><span className="text-muted-foreground">里程</span><p className="font-semibold tabular-nums">{((stats?.byType.running.total.distance ?? 0) / 1000).toFixed(1)} km</p></div>
            </div>
          </div>
          <div className="bg-card rounded-lg border p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium">骑行</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">活动数</span><p className="font-semibold tabular-nums">{stats?.byType.cycling.total.activities ?? 0}</p></div>
              <div><span className="text-muted-foreground">里程</span><p className="font-semibold tabular-nums">{((stats?.byType.cycling.total.distance ?? 0) / 1000).toFixed(1)} km</p></div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">最近 PR 复盘</h3>
          <button
            type="button"
            onClick={fetchReviews}
            disabled={reviewsLoading}
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50"
            title="刷新复盘"
          >
            <RefreshCw className={`h-4 w-4 ${reviewsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          {reviewsLoading ? (
            <div className="text-muted-foreground px-4 py-6 text-sm">正在读取 PR 复盘...</div>
          ) : reviews.length === 0 ? (
            <div className="text-muted-foreground px-4 py-6 text-sm">暂无 PR 复盘。同步新活动后会自动生成。</div>
          ) : (
            <div className="divide-y">
              {reviews.map(review => (
                <article key={review.id} className="px-4 py-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {new Date(review.createdAt).toLocaleString()} · {review.provider ?? review.model}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => notifyReview(review.id)}
                        disabled={notifyingId === review.id}
                        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50"
                        title="发送复盘通知"
                      >
                        <Bell className={`h-4 w-4 ${notifyingId === review.id ? 'animate-pulse' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => regenerateReview(review.activityId)}
                        disabled={!review.activityId || regeneratingId === review.activityId}
                        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50"
                        title="重生成复盘"
                      >
                        <RefreshCw className={`h-4 w-4 ${regeneratingId === review.activityId ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>
                  <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-6 text-foreground">
                    {review.content}
                  </div>
                  {review.activityId && (
                    <div className="mt-4 grid gap-2 border-t pt-3 sm:grid-cols-[96px_1fr_auto]">
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={feedbackDrafts[review.activityId]?.rpe ?? ''}
                        onChange={(event) =>
                          setFeedbackDrafts(prev => ({
                            ...prev,
                            [review.activityId as string]: {
                              rpe: event.target.value,
                              note: prev[review.activityId as string]?.note ?? '',
                            },
                          }))
                        }
                        placeholder="RPE"
                        className="h-9 rounded-md border bg-background px-3 text-sm"
                      />
                      <input
                        type="text"
                        value={feedbackDrafts[review.activityId]?.note ?? ''}
                        onChange={(event) =>
                          setFeedbackDrafts(prev => ({
                            ...prev,
                            [review.activityId as string]: {
                              rpe: prev[review.activityId as string]?.rpe ?? '',
                              note: event.target.value,
                            },
                          }))
                        }
                        placeholder="补充体感、疼痛、备注"
                        className="h-9 rounded-md border bg-background px-3 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => submitFeedback(review.activityId)}
                        disabled={savingFeedbackId === review.activityId}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {savingFeedbackId === review.activityId ? '保存中' : '保存反馈'}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">周总结与老友日记</h3>
          <button
            type="button"
            onClick={generateWeekly}
            disabled={weeklyGenerating}
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <BookOpen className="h-3.5 w-3.5" />
            {weeklyGenerating ? '生成中' : '生成周总结'}
          </button>
        </div>
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          {diaryEntries.length === 0 ? (
            <div className="text-muted-foreground px-4 py-6 text-sm">暂无老友日记。</div>
          ) : (
            <div className="divide-y">
              {diaryEntries.map(entry => (
                <article key={entry.id} className="px-4 py-4">
                  <p className="text-muted-foreground mb-2 text-xs">
                    {entry.periodStart.slice(0, 10)} ~ {entry.periodEnd.slice(0, 10)} · {entry.model}
                  </p>
                  <div className="whitespace-pre-wrap text-sm leading-6">{entry.content}</div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">PR 记忆候选</h3>
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          {memories.length === 0 ? (
            <div className="text-muted-foreground px-4 py-6 text-sm">暂无候选或 active 记忆。</div>
          ) : (
            <div className="divide-y">
              {memories.slice(0, 8).map(memory => (
                <div key={memory.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm">{memory.content}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {memory.type} · {memory.status} · {(memory.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {memory.status !== 'active' && (
                      <button
                        type="button"
                        onClick={() => updateMemory(memory.id, 'confirm')}
                        disabled={memoryActionId === memory.id}
                        className="h-8 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        确认
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => updateMemory(memory.id, 'archive')}
                      disabled={memoryActionId === memory.id}
                      className="h-8 rounded-md border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      归档
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">PR 运行审计</h3>
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          {agentRuns.length === 0 ? (
            <div className="text-muted-foreground px-4 py-6 text-sm">暂无 PR 运行记录。</div>
          ) : (
            <div className="divide-y">
              {agentRuns.map(run => (
                <div key={run.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {run.trigger} · {run.subjectType ?? '-'}:{run.subjectId ?? '-'}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {run.status} · {run.lastStep ?? '-'} · {run.createdAt ? new Date(run.createdAt).toLocaleString() : '-'}
                    </p>
                    {run.errorMessage && (
                      <p className="mt-1 truncate text-xs text-red-600">{run.errorMessage}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => inspectRunContext(run.id)}
                    disabled={contextLoadingId === run.id}
                    className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    <Search className="h-3.5 w-3.5" />
                    {contextLoadingId === run.id ? '读取中' : '查看上下文'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {contextPreview && (
          <div className="mt-3 overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-medium">Context Snapshot</span>
              <button
                type="button"
                onClick={() => setContextPreview(null)}
                className="text-muted-foreground text-xs hover:text-foreground"
              >
                关闭
              </button>
            </div>
            <pre className="max-h-80 overflow-auto p-4 text-xs leading-5">{contextPreview.text}</pre>
          </div>
        )}
      </section>
    </div>
  )
}
