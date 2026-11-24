'use client'

import { useEffect, useState } from 'react'
import { Footprints, Target, Timer, TrendingUp } from 'lucide-react'

import type { SyncStatus } from '@/lib/activity/dashboard-stats'
import type { MonitorData } from '../DashboardView'

import { ActivityPulse } from './ActivityPulse'
import { LoadingState, PanelHeader, ServiceCard, StatCard } from './shared'

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

function HealthScore({ monitor }: { monitor: MonitorData | null }) {
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

  // 数字第一,一条墨色进度线表比例。不用彩色分级 —— 颜色只留给"状态成立"。
  return (
    <div className="border-b pb-5" style={{ borderColor: 'var(--pr-line)' }}>
      <div className="pr-kpi-label">系统健康度</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="pr-kpi">{percentage}</span>
        <span className="pr-meta">/ 100 · {label}</span>
      </div>
      <div className="pr-bar mt-3">
        <i style={{ width: `${percentage}%` }} />
      </div>
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
      <PanelHeader title="概览" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Footprints} label="总活动" value={String(stats?.total.activities ?? 0)} />
        <StatCard icon={TrendingUp} label="总里程" value={`${totalDistanceKm} km`} />
        <StatCard icon={Timer} label="本周里程" value={`${weekDistanceKm} km`} accent={weekDelta ? (Number(weekDelta) >= 0 ? 'green' : 'red') : undefined} />
        <StatCard icon={Target} label="运动类型" value={`${stats?.byType.running.total.activities ?? 0} 跑 / ${stats?.byType.cycling.total.activities ?? 0} 骑`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HealthScore monitor={monitor} />
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
      </div>

      {/* 原来这里是「信标连接状态」(PV 次数,没人访问就误报故障)和
          「Strava 同步卡」(同步源早已切到 keep,永远显示未配置)。
          换成真实时间线:最近同步/聊天/运动时间 + 近 14 天活动热力图。 */}
      <ActivityPulse />
    </div>
  )
}
