'use client'

import { Footprints, Target, Timer, TrendingUp } from 'lucide-react'

import type { MonitorData } from '../DashboardView'

import { ConnectionHealthPanel } from './ConnectionHealthPanel'
import { LoadingState, ServiceCard, StatCard, SyncCard } from './shared'

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

interface SyncStatus {
  nike: { hasToken: boolean; hasRefreshToken: boolean; latestSync: { startedAt: string; completedAt: string; activitiesSynced: number } | null }
  strava: { hasCredentials: boolean; latestSync: { startedAt: string; completedAt: string; activitiesSynced: number } | null }
}

export function OverviewPanel({
  stats,
  syncStatus,
  monitor,
  loading,
}: {
  stats: ActivityStats | null
  syncStatus: SyncStatus | null
  monitor: MonitorData | null
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
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4">
        <h2 className="text-xl font-semibold">概览</h2>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Footprints} label="总活动" value={String(stats?.total.activities ?? 0)} />
        <StatCard icon={TrendingUp} label="总里程" value={`${totalDistanceKm} km`} />
        <StatCard icon={Timer} label="本周里程" value={`${weekDistanceKm} km`} accent={weekDelta ? (Number(weekDelta) >= 0 ? 'green' : 'red') : undefined} />
        <StatCard icon={Target} label="运动类型" value={`${stats?.byType.running.total.activities ?? 0} 跑 / ${stats?.byType.cycling.total.activities ?? 0} 骑`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ServiceCard
          name="前端"
          status={monitor?.services.find(s => s.name === 'Frontend')?.status ?? 'unknown'}
          responseTime={monitor?.services.find(s => s.name === 'Frontend')?.responseTimeMs}
        />
        <ServiceCard
          name="Admin"
          status={monitor?.services.find(s => s.name === 'Admin')?.status ?? 'online'}
          responseTime={monitor?.services.find(s => s.name === 'Admin')?.responseTimeMs}
        />
        <ServiceCard
          name="数据库"
          status={monitor?.database?.connected ? 'online' : 'offline'}
          type={monitor?.database?.type}
        />
        <ConnectionHealthPanel />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SyncCard
          source="Nike Run Club"
          configured={syncStatus?.nike.hasToken ?? false}
          lastSync={syncStatus?.nike.latestSync}
        />
        <SyncCard
          source="Strava"
          configured={syncStatus?.strava.hasCredentials ?? false}
          lastSync={syncStatus?.strava.latestSync}
        />
      </div>
    </div>
  )
}
