'use client'

import { Footprints, MapIcon, Timer, TrendingUp } from 'lucide-react'

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

      {/* Period Comparison */}
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
          <StatCard icon={TrendingUp} label="总里程" value={`${(stats?.total.distance ?? 0 / 1000).toFixed(1)} km`} />
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
    </div>
  )
}
