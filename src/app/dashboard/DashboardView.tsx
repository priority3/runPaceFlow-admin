'use client'

import { useEffect, useState } from 'react'
import {
  Activity,
  BarChart3,
  Clock,
  Footprints,
  Globe,
  LayoutDashboard,
  LogOut,
  Settings,
} from 'lucide-react'

import { logoutAction } from '@/app/actions'
import type { StoredSetting } from '@/lib/store'
import { cn } from '@/lib/utils'

import { ActivitiesPanel } from './components/ActivitiesPanel'
import { AnalyticsPanel } from './components/AnalyticsPanel'
import { MonitorPanel } from './components/MonitorPanel'
import { OverviewPanel } from './components/OverviewPanel'
import { SchedulerPanel } from './components/SchedulerPanel'
import { SettingsPanel } from './components/SettingsPanel'

type Tab = 'overview' | 'activities' | 'analytics' | 'scheduler' | 'monitor' | 'settings'

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

export interface MonitorData {
  services: { name: string; status: string; responseTimeMs: number | null }[]
  system: { nodeVersion: string; uptimeFormatted: string; memory: { heapUsedFormatted: string; heapTotalFormatted: string; rssFormatted: string } }
  database: { connected: boolean; type: string; url: string }
  auditLogs: { id: string; action: string; key: string | null; createdAt: string }[]
}

interface DashboardViewProps {
  settings: StoredSetting[]
}

export function DashboardView({ settings }: DashboardViewProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<ActivityStats | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [monitor, setMonitor] = useState<MonitorData | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)

  const fetchStats = async () => {
    setLoadingStats(true)
    try {
      const [statsRes, monitorRes] = await Promise.all([
        fetch('/api/stats', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/monitor', { cache: 'no-store' }).then(r => r.json()),
      ])
      setStats(statsRes.stats)
      setSyncStatus(statsRes.syncStatus)
      setMonitor(monitorRes)
    } catch {}
    setLoadingStats(false)
  }

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="bg-muted/40 text-foreground min-h-dvh min-[520px]:pl-60">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border border-b min-[520px]:fixed min-[520px]:inset-y-0 min-[520px]:left-0 min-[520px]:z-40 min-[520px]:flex min-[520px]:w-60 min-[520px]:flex-col min-[520px]:border-r min-[520px]:border-b-0">
        <div className="border-sidebar-border flex h-16 items-center gap-3 border-b px-4">
          <span className="bg-primary text-primary-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
            <LayoutDashboard className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">RunPaceFlow</h1>
            <p className="text-muted-foreground truncate text-xs">运维控制台</p>
          </div>
        </div>

        <nav className="scrollbar-subtle min-[520px]:flex-1 min-[520px]:overflow-y-auto p-3 space-y-1">
          {([
            { id: 'overview' as Tab, icon: BarChart3, label: '概览' },
            { id: 'activities' as Tab, icon: Footprints, label: '运动数据' },
            { id: 'analytics' as Tab, icon: Globe, label: '访问分析' },
            { id: 'scheduler' as Tab, icon: Clock, label: '任务调度' },
            { id: 'monitor' as Tab, icon: Activity, label: '系统监控' },
            { id: 'settings' as Tab, icon: Settings, label: '配置管理' },
          ]).map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                'flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors',
                tab === item.id
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="border-sidebar-border border-t p-3">
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-10 w-full items-center gap-2 rounded-md px-3 text-sm transition-colors"
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </form>
        </div>
      </aside>

      <main>
        {tab === 'overview' && <OverviewPanel stats={stats} syncStatus={syncStatus} monitor={monitor} loading={loadingStats} />}
        {tab === 'activities' && <ActivitiesPanel stats={stats} loading={loadingStats} />}
        {tab === 'analytics' && <AnalyticsPanel />}
        {tab === 'scheduler' && <SchedulerPanel />}
        {tab === 'monitor' && <MonitorPanel monitor={monitor} loading={loadingStats} />}
        {tab === 'settings' && <SettingsPanel settings={settings} />}
      </main>
    </div>
  )
}
