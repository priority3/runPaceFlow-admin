'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, Footprints, MapIcon, Plus, Timer, TrendingUp } from 'lucide-react'

import { EmptyState, LoadingState, PanelHeader, StatCard } from './shared'

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

interface RaceGoal {
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
}

interface LifeEvent {
  id: string
  type: string
  occurredAt: string
  mediaUrl: string | null
  rawText: string | null
  observation: Record<string, unknown> | null
  createdAt: string
}

/**
 * 运动数据页只管「运动」：统计、比赛目标、生活观察。
 * PR 域的记忆 / 复盘 / 恢复 / 飞轮 / 周总结 / 运行审计全部归到「PR 伙伴」,
 * 这里只留一条入口，不再把同一份数据渲染第二遍。
 */
export function ActivitiesPanel({ stats, loading, onOpenPr }: {
  stats: ActivityStats | null
  loading: boolean
  onOpenPr: () => void
}) {
  const [raceGoals, setRaceGoals] = useState<RaceGoal[]>([])
  const [goalDraft, setGoalDraft] = useState({ name: '', raceDate: '', distanceMeters: '', targetType: 'time', targetTimeSec: '', notes: '' })
  const [goalSaving, setGoalSaving] = useState(false)
  const [lifeEvents, setLifeEvents] = useState<LifeEvent[]>([])
  const [lifeDraft, setLifeDraft] = useState({ type: 'manual_note', rawText: '', mediaUrl: '' })
  const [lifeSaving, setLifeSaving] = useState(false)

  const fetchRaceGoals = async () => {
    try {
      const res = await fetch('/api/race-goals?status=active', { cache: 'no-store' })
      const data = await res.json()
      setRaceGoals(data.goals ?? [])
    } catch {
      setRaceGoals([])
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
      fetchRaceGoals()
      fetchLifeEvents()
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
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-8">
      <PanelHeader
        title="运动数据"
        description="活动统计、比赛目标与生活观察 · PR 的记忆、复盘、恢复在「PR 伙伴」里"
      />

      <section>
        <h3 className="pr-title mb-4">累计数据</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Footprints} label="总活动" value={String(stats?.total.activities ?? 0)} />
          <StatCard icon={TrendingUp} label="总里程" value={`${((stats?.total.distance ?? 0) / 1000).toFixed(1)} km`} />
          <StatCard icon={Timer} label="总时长" value={formatDuration(stats?.total.duration ?? 0)} />
          <StatCard icon={MapIcon} label="平均配速" value={formatPace(stats?.total.averagePace ?? 0)} />
        </div>
      </section>

      <section>
        <h3 className="pr-title mb-3">时段对比</h3>
        <div>
          <div className="pr-meta grid grid-cols-4 gap-4 border-b pb-2" style={{ borderColor: 'var(--pr-line)' }}>
            <span>时段</span><span className="text-right">活动数</span><span className="text-right">里程</span><span className="text-right">时长</span>
          </div>
          {stats && [
            { label: '本周', data: stats.thisWeek },
            { label: '上周', data: stats.lastWeek },
            { label: '本月', data: stats.thisMonth },
          ].map(row => (
            <div key={row.label} className="grid grid-cols-4 gap-4 border-b py-2.5 text-sm" style={{ borderColor: 'var(--pr-line)' }}>
              <span className="font-medium">{row.label}</span>
              <span className="text-right tabular-nums">{row.data.activities}</span>
              <span className="text-right tabular-nums">{(row.data.distance / 1000).toFixed(1)} km</span>
              <span className="text-right tabular-nums">{formatDuration(row.data.duration)}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="pr-title mb-3">按类型</h3>
        <div className="grid gap-6 sm:grid-cols-2">
          {[
            { label: '跑步', icon: Footprints, data: stats?.byType.running.total },
            { label: '骑行', icon: TrendingUp, data: stats?.byType.cycling.total },
          ].map(({ label, icon: Icon, data }) => (
            <div key={label} className="border-b pb-4" style={{ borderColor: 'var(--pr-line)' }}>
              <div className="mb-3 flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="pr-title">{label}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="pr-kpi-label">活动数</p>
                  <p className="pr-kpi mt-1">{data?.activities ?? 0}</p>
                </div>
                <div>
                  <p className="pr-kpi-label">里程</p>
                  <p className="pr-kpi mt-1">{((data?.distance ?? 0) / 1000).toFixed(1)} km</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="pr-title">比赛目标</h3>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="grid gap-2 border-b pb-4 sm:grid-cols-2 lg:grid-cols-3" style={{ borderColor: 'var(--pr-line)' }}>
          <input className="pr-field h-9 px-3 text-sm outline-none" placeholder="目标名称" value={goalDraft.name} onChange={(e) => setGoalDraft(prev => ({ ...prev, name: e.target.value }))} />
          <input className="pr-field h-9 px-3 text-sm outline-none" placeholder="比赛日期 YYYY-MM-DD" value={goalDraft.raceDate} onChange={(e) => setGoalDraft(prev => ({ ...prev, raceDate: e.target.value }))} />
          <input className="pr-field h-9 px-3 text-sm outline-none" placeholder="距离米数" value={goalDraft.distanceMeters} onChange={(e) => setGoalDraft(prev => ({ ...prev, distanceMeters: e.target.value }))} />
          <input className="pr-field h-9 px-3 text-sm outline-none" placeholder="目标类型" value={goalDraft.targetType} onChange={(e) => setGoalDraft(prev => ({ ...prev, targetType: e.target.value }))} />
          <input className="pr-field h-9 px-3 text-sm outline-none" placeholder="目标时间(秒)" value={goalDraft.targetTimeSec} onChange={(e) => setGoalDraft(prev => ({ ...prev, targetTimeSec: e.target.value }))} />
          <input className="pr-field h-9 px-3 text-sm outline-none" placeholder="备注" value={goalDraft.notes} onChange={(e) => setGoalDraft(prev => ({ ...prev, notes: e.target.value }))} />
          <button type="button" onClick={createRaceGoal} disabled={goalSaving} className="pr-btn pr-btn-primary sm:col-span-2 lg:col-span-3">
            <Plus className="h-4 w-4" />
            {goalSaving ? '保存中' : '添加目标'}
          </button>
        </div>
        {raceGoals.length === 0 ? (
          <EmptyState line="还没有比赛目标。加一个想跑的比赛，PR 排训练计划时会用上。" />
        ) : (
          <div>
            {raceGoals.map(goal => (
              <div key={goal.id} className="pr-row items-start py-3 text-sm">
                <div className="pr-row-main">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{goal.name}</span>
                    <span className="pr-meta">{goal.daysUntilRace} 天后</span>
                  </div>
                  <p className="pr-meta mt-1">{(goal.distanceMeters / 1000).toFixed(1)} km · {goal.raceDate.slice(0, 10)} · {goal.targetType}</p>
                  {goal.notes && <p className="mt-1 text-xs">{goal.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="pr-title mb-3">生活观察</h3>
        <div className="grid gap-2 border-b pb-4 sm:grid-cols-[160px_1fr]" style={{ borderColor: 'var(--pr-line)' }}>
          <select
            value={lifeDraft.type}
            onChange={(e) => setLifeDraft(prev => ({ ...prev, type: e.target.value }))}
            className="pr-field h-9 px-3 text-sm outline-none"
          >
            <option value="manual_note">手动备注</option>
            <option value="morning_photo">早起照片</option>
            <option value="meal_photo">饮食照片</option>
            <option value="gear_photo">装备照片</option>
            <option value="injury_photo">伤痛照片</option>
          </select>
          <input
            className="pr-field h-9 px-3 text-sm outline-none"
            placeholder="备注"
            value={lifeDraft.rawText}
            onChange={(e) => setLifeDraft(prev => ({ ...prev, rawText: e.target.value }))}
          />
          <input
            className="pr-field h-9 px-3 text-sm outline-none sm:col-span-2"
            placeholder="媒体 URL"
            value={lifeDraft.mediaUrl}
            onChange={(e) => setLifeDraft(prev => ({ ...prev, mediaUrl: e.target.value }))}
          />
          <button type="button" onClick={createLifeEvent} disabled={lifeSaving} className="pr-btn pr-btn-primary sm:col-span-2">
            <Plus className="h-4 w-4" />
            {lifeSaving ? '保存中' : '添加生活观察'}
          </button>
        </div>
        {lifeEvents.length === 0 ? (
          <EmptyState line="还没有生活观察。随手记一条，PR 写日记时会引用。" />
        ) : (
          <div>
            {lifeEvents.map(event => (
              <div key={event.id} className="pr-row py-3 text-sm">
                <div className="pr-row-main">
                  <p className="pr-meta mb-1">{event.type} · {event.occurredAt.slice(0, 10)}</p>
                  <p>{String(event.observation?.summary ?? event.rawText ?? '—')}</p>
                  {event.mediaUrl && <p className="pr-meta mt-1 truncate">{event.mediaUrl}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 同一份 PR 数据不再渲染第二遍，只留一个去处 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5" style={{ borderColor: 'var(--pr-line)' }}>
        <p className="pr-meta">记忆、复盘、恢复、周总结与运行审计都归在 PR 伙伴里。</p>
        <button type="button" onClick={onOpenPr} className="pr-btn">
          查看 PR 伙伴
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
