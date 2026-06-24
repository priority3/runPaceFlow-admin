'use client'

import { useEffect, useState } from 'react'
import { Activity, Footprints, Shield, Target, Timer, TrendingUp } from 'lucide-react'

import type { SyncStatus } from '@/lib/activity/dashboard-stats'
import type { MonitorData } from '../DashboardView'
import { cn } from '@/lib/utils'

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

function HealthScore({ monitor, syncStatus }: { monitor: MonitorData | null; syncStatus: SyncStatus | null }) {
  const [healthData, setHealthData] = useState<{ status: string; beacons: { last1h: number } } | null>(null)

  useEffect(() => {
    fetch('/api/analytics/health', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(setHealthData)
      .catch(() => {})
  }, [])

  // Calculate health score (0-100)
  let score = 0
  let checks = 0

  // Database (25 points)
  if (monitor?.database?.connected !== undefined) {
    checks++
    if (monitor.database.connected) score += 25
  }

  // Admin service (25 points)
  const adminService = monitor?.services.find(s => s.name === 'Admin')
  if (adminService) {
    checks++
    if (adminService.status === 'online') score += 25
  }

  // Frontend service (25 points)
  const frontendService = monitor?.services.find(s => s.name === 'Frontend')
  if (frontendService) {
    checks++
    if (frontendService.status === 'online') score += 25
  }

  // Beacon health (25 points)
  if (healthData) {
    checks++
    if (healthData.status === 'healthy') score += 25
    else if (healthData.status === 'warning') score += 12
  }

  const percentage = checks > 0 ? Math.round((score / (checks * 25)) * 100) : 0
  const label = percentage === 100 ? '健康' : percentage >= 75 ? '良好' : percentage >= 50 ? '一般' : percentage > 0 ? '异常' : '检测中'
  const color = percentage === 100 ? 'text-emerald-600' : percentage >= 75 ? 'text-emerald-500' : percentage >= 50 ? 'text-amber-500' : 'text-red-500'

  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">系统健康度</span>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className={cn('text-3xl font-bold tabular-nums', color)}>{percentage}</span>
        <span className="text-muted-foreground text-sm">/ 100</span>
      </div>
      <div className="bg-muted h-2 rounded-full overflow-hidden mb-2">
        <div
          className={cn('h-full rounded-full transition-all duration-500',
            percentage === 100 ? 'bg-emerald-500' : percentage >= 75 ? 'bg-emerald-400' : percentage >= 50 ? 'bg-amber-400' : 'bg-red-400'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  )
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <HealthScore monitor={monitor} syncStatus={syncStatus} />
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
