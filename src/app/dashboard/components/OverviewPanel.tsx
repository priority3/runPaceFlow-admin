'use client'

import { Footprints, Target, Timer, TrendingUp } from 'lucide-react'

import { ActivityPulse } from './ActivityPulse'
import { LoadingState, PanelHeader, StatCard } from './shared'

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

/**
 * 概览只回答两件事:运动得怎么样、系统最近在忙什么。
 * 服务在线状态 / 系统资源 / 健康度全部归「系统监控」一处,这里不再重复摆一遍。
 */
export function OverviewPanel({ stats, loading }: {
  stats: ActivityStats | null
  loading: boolean
}) {
  if (loading) return <LoadingState />

  const totalDistanceKm = stats ? (stats.total.distance / 1000).toFixed(1) : '0'
  const weekDistanceKm = stats ? (stats.thisWeek.distance / 1000).toFixed(1) : '0'
  const weekDelta = stats && stats.lastWeek.distance > 0
    ? ((stats.thisWeek.distance - stats.lastWeek.distance) / stats.lastWeek.distance * 100).toFixed(0)
    : null

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <PanelHeader
        title="概览"
        description="运动概况与最近活动 · 服务状态在系统监控里看"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Footprints} label="总活动" value={String(stats?.total.activities ?? 0)} />
        <StatCard icon={TrendingUp} label="总里程" value={`${totalDistanceKm} km`} />
        <StatCard icon={Timer} label="本周里程" value={`${weekDistanceKm} km`} accent={weekDelta ? (Number(weekDelta) >= 0 ? 'green' : 'red') : undefined} />
        <StatCard icon={Target} label="运动类型" value={`${stats?.byType.running.total.activities ?? 0} 跑 / ${stats?.byType.cycling.total.activities ?? 0} 骑`} />
      </div>

      <ActivityPulse />
    </div>
  )
}
