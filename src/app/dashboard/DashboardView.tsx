'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  Brain,
  Clock,
  Footprints,
  Globe,
  LogOut,
  Settings,
  UserRound,
  Waypoints,
} from 'lucide-react'

import { logoutAction } from '@/app/actions'
import type { ActivityStats, SyncStatus } from '@/lib/activity/dashboard-stats'
import type { StoredSetting } from '@/lib/store'

import { ActivitiesPanel } from './components/ActivitiesPanel'
import { AnalyticsPanel } from './components/AnalyticsPanel'
import { MonitorPanel } from './components/MonitorPanel'
import { OverviewPanel } from './components/OverviewPanel'
import { PersonaPanel } from './components/PersonaPanel'
import { PrPanel } from './components/PrPanel'
import { SchedulerPanel } from './components/SchedulerPanel'
import { SettingsPanel } from './components/SettingsPanel'

type Tab = 'overview' | 'pr' | 'persona' | 'activities' | 'analytics' | 'scheduler' | 'monitor' | 'settings'

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
  const [statsError, setStatsError] = useState<string | null>(null)
  // Reason: 用 ref 记住"是否拿到过数据"。原写法在 setStats 的 updater 里再调
  // setLoadingStats(true) —— updater 在渲染阶段才执行,会把随后 setLoadingStats(false)
  // 覆盖成 true,概览页就永远停在骨架屏。
  const hasStatsRef = useRef(false)

  const fetchStats = async () => {
    // Reason: 仅首次（无数据）显示加载态；30s 轮询时保留已渲染内容，避免概览页周期性闪烁
    if (!hasStatsRef.current) setLoadingStats(true)
    try {
      const [statsRes, monitorRes] = await Promise.all([
        fetch('/api/stats', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/monitor', { cache: 'no-store' }).then(r => r.json()),
      ])
      setStats(statsRes.stats)
      hasStatsRef.current = true
      setSyncStatus(statsRes.syncStatus)
      setMonitor(monitorRes)
      setStatsError(null)
    } catch (e) {
      // Reason: 之前空 catch 会让加载失败和"真的没数据"无法区分，这里显式上报
      setStatsError(e instanceof Error ? e.message : '数据加载失败')
    }
    setLoadingStats(false)
  }

  useEffect(() => {
    void Promise.resolve().then(fetchStats)
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-dvh min-[520px]:pl-60">
      <aside className="border-b min-[520px]:fixed min-[520px]:inset-y-0 min-[520px]:left-0 min-[520px]:z-40 min-[520px]:flex min-[520px]:w-60 min-[520px]:flex-col min-[520px]:border-r min-[520px]:border-b-0" style={{ borderColor: 'var(--pr-line)' }}>
        {/* 品牌区:去掉深色方块 —— 最大的色块必须是内容,不是容器 */}
        <div className="border-b px-5 py-5" style={{ borderColor: 'var(--pr-line)' }}>
          <h1 className="pr-h1">RunPaceFlow</h1>
          <p className="pr-meta mt-1">运维控制台</p>
        </div>

        {/* 导航用专用 .pr-nav-item:无逐行横线、无独立状态点列。
            选中态交给 aria-current —— 字重 + 墨色 + 一条贴左缘的竖线。 */}
        <nav className="pr-nav pr-scroll min-[520px]:flex-1 min-[520px]:overflow-y-auto py-3">
          {([
            { id: 'overview' as Tab, icon: BarChart3, label: '概览' },
            { id: 'pr' as Tab, icon: Brain, label: 'PR 伙伴' },
            { id: 'persona' as Tab, icon: UserRound, label: '数字分身' },
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
              aria-current={tab === item.id ? 'page' : undefined}
              className="pr-nav-item"
            >
              <item.icon className="pr-nav-icon" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="pr-nav-tools border-t py-3" style={{ borderColor: 'var(--pr-line)' }}>
          {/* Phoenix 是独立子域(自带登录),新标签打开 */}
          <a
            href="https://phoenix.razet.me"
            target="_blank"
            rel="noopener noreferrer"
            className="pr-nav-item"
          >
            <Waypoints className="pr-nav-icon" />
            PR 链路追踪
          </a>
          <form action={logoutAction}>
            <button type="submit" className="pr-nav-item">
              <LogOut className="pr-nav-icon" />
              退出登录
            </button>
          </form>
        </div>
      </aside>

      <main className="pr-canvas-soft min-h-dvh">
        {statsError && (
          <div className="mx-4 mt-4 flex items-center justify-between gap-3 border-b py-3 text-sm sm:mx-6 lg:mx-8" style={{ borderColor: 'var(--pr-line)' }}>
            <span className="flex items-center gap-2">
              <span className="pr-status-dot pr-status-dot--warn" />
              数据加载失败：{statsError}
            </span>
            <button
              type="button"
              onClick={fetchStats}
              disabled={loadingStats}
              className="pr-btn pr-btn-danger h-8 shrink-0 text-xs"
            >
              {loadingStats ? '重试中...' : '重试'}
            </button>
          </div>
        )}
        {/* key 让切换 tab 时只做一次 8px 位移入场,不叠 scale */}
        <div key={tab} className="pr-enter">
          {tab === 'overview' && <OverviewPanel stats={stats} syncStatus={syncStatus} monitor={monitor} loading={loadingStats} />}
          {tab === 'pr' && <PrPanel />}
          {tab === 'persona' && <PersonaPanel onOpenPr={() => setTab('pr')} />}
          {tab === 'activities' && <ActivitiesPanel stats={stats} loading={loadingStats} />}
          {tab === 'analytics' && <AnalyticsPanel />}
          {tab === 'scheduler' && <SchedulerPanel />}
          {tab === 'monitor' && <MonitorPanel monitor={monitor} loading={loadingStats} />}
          {tab === 'settings' && <SettingsPanel settings={settings} />}
        </div>
      </main>
    </div>
  )
}
