'use client'

import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  HardDrive,
  LogOut,
  RefreshCw,
  Server,
  Shield,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'

import { logoutAction } from '@/app/actions'
import type { MonitorData } from '@/lib/monitor'
import { cn, formatDateTime } from '@/lib/utils'

interface MonitorDashboardProps {
  initialData: MonitorData
}

export function MonitorDashboard({ initialData }: MonitorDashboardProps) {
  const [data, setData] = useState<MonitorData>(initialData)
  const [refreshing, startRefreshTransition] = useTransition()

  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/monitor', { cache: 'no-store' })
        .then((res) => res.json())
        .then((d) => setData(d))
        .catch(() => {})
    }, 10000)

    return () => clearInterval(interval)
  }, [])

  function handleRefresh() {
    startRefreshTransition(async () => {
      try {
        const res = await fetch('/api/monitor', { cache: 'no-store' })
        const d = await res.json()
        setData(d)
      } catch {}
    })
  }

  return (
    <div className="min-h-dvh min-[520px]:pl-60">
      <aside className="border-b min-[520px]:fixed min-[520px]:inset-y-0 min-[520px]:left-0 min-[520px]:z-40 min-[520px]:flex min-[520px]:w-60 min-[520px]:flex-col min-[520px]:border-r min-[520px]:border-b-0" style={{ borderColor: 'var(--pr-line)' }}>
        <div className="border-b px-5 py-5" style={{ borderColor: 'var(--pr-line)' }}>
          <h1 className="pr-h1">RunPaceFlow</h1>
          <p className="pr-meta mt-1">监控面板</p>
        </div>

        <div className="pr-scroll min-[520px]:flex-1 min-[520px]:overflow-y-auto px-5 py-3">
          <nav>
            <Link href="/" className="pr-row pr-nav-idle items-center gap-3 py-2.5 text-sm">
              <span className="h-1.5 w-1.5 shrink-0" />
              <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
              运维控制台
            </Link>
            <div className="pr-row items-center gap-3 py-2.5 text-sm font-medium">
              <span className="pr-status-dot" />
              <Activity className="h-4 w-4 shrink-0" />
              系统监控
            </div>
          </nav>
        </div>

        <div className="border-t px-5 py-3" style={{ borderColor: 'var(--pr-line)' }}>
          <form action={logoutAction}>
            <button type="submit" className="pr-row pr-nav-idle items-center gap-3 py-2.5 text-sm">
              <span className="h-1.5 w-1.5 shrink-0" />
              <LogOut className="h-4 w-4 shrink-0 text-muted-foreground" />
              退出登录
            </button>
          </form>
        </div>
      </aside>

      <main className="pr-canvas-soft min-h-dvh space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-start justify-between gap-4 pb-8 pt-2">
          <div>
            <h2 className="pr-h1">监控面板</h2>
            <p className="pr-meta mt-1">monitor</p>
          </div>
          <button type="button" onClick={handleRefresh} disabled={refreshing} className="pr-btn">
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            {refreshing ? '刷新中...' : '刷新'}
          </button>
        </header>

        {/* 服务状态 */}
        <section>
          <h3 className="pr-title mb-3 flex items-center gap-2"><Server className="h-3.5 w-3.5 text-muted-foreground" />服务状态</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.services.map((service) => (
              <ServiceCard key={service.name} service={service} />
            ))}
            <DatabaseCard database={data.database} />
          </div>
        </section>

        {/* 配置同步状态 */}
        <section>
          <h3 className="pr-title mb-3 flex items-center gap-2"><BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />配置同步</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <InfoCard label="最后同步" value={data.sync.lastSyncTime ? formatDateTime(data.sync.lastSyncTime) : '无记录'} icon={Clock} />
            <InfoCard label="总变更次数" value={String(data.sync.totalChanges)} icon={Activity} />
            <InfoCard
              label="失败次数"
              value={String(data.sync.recentFailures)}
              icon={data.sync.recentFailures > 0 ? XCircle : CheckCircle2}
              accent={data.sync.recentFailures > 0 ? 'red' : 'green'}
            />
          </div>
        </section>

        {/* 系统资源 */}
        <section>
          <h3 className="pr-title mb-3 flex items-center gap-2"><Cpu className="h-3.5 w-3.5 text-muted-foreground" />系统资源</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoCard label="Node.js" value={data.system.nodeVersion} icon={Server} />
            <InfoCard label="运行时间" value={data.system.uptimeFormatted} icon={Clock} />
            <InfoCard label="Heap 使用" value={`${data.system.memory.heapUsedFormatted} / ${data.system.memory.heapTotalFormatted}`} icon={HardDrive} />
            <InfoCard label="RSS 内存" value={data.system.memory.rssFormatted} icon={HardDrive} />
          </div>
        </section>

        {/* 操作审计日志 */}
        <section>
          <h3 className="pr-title mb-3 flex items-center gap-2"><Shield className="h-3.5 w-3.5 text-muted-foreground" />操作审计</h3>
          {data.auditLogs.length === 0 ? (
            <div className="pr-empty"><span className="pr-empty-line">还没有操作记录，改一次配置就会出现在这里。</span></div>
          ) : (
            <div className="divide-y">
              {data.auditLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="pr-tag font-mono">{log.action}</span>
                    <span className="text-muted-foreground font-mono text-xs">{log.key ?? '—'}</span>
                  </div>
                  <span className="pr-meta shrink-0">{formatDateTime(log.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

/** 状态用点 + 文字:在线实心讯号色,降级空心,离线警示色。灰度下也分得出。 */
function ServiceCard({ service }: { service: { name: string; status: string; responseTimeMs: number | null; url: string; error?: string } }) {
  const isOnline = service.status === 'online'
  const isDegraded = service.status === 'degraded'

  return (
    <div className="pr-row">
      <div className="pr-row-main">
        <div className="flex items-center gap-2">
          <span className={cn('pr-status-dot', isDegraded && 'pr-status-dot--off', !isOnline && !isDegraded && 'pr-status-dot--warn')} />
          <strong className="pr-body font-normal">{service.name}</strong>
        </div>
        <div className="pr-meta mt-1 block">
          {isOnline ? '在线' : isDegraded ? '降级' : '离线'}
          {' · 响应 '}
          {service.responseTimeMs !== null ? `${service.responseTimeMs}ms` : '—'}
          {' · '}
          <span className="font-mono">{service.url}</span>
        </div>
        {service.error && <p className="mt-2 text-xs" style={{ color: 'var(--pr-danger)' }}>{service.error}</p>}
      </div>
    </div>
  )
}

function DatabaseCard({ database }: { database: { connected: boolean; type: string; url: string; error?: string } }) {
  return (
    <div className="pr-row">
      <div className="pr-row-main">
        <div className="flex items-center gap-2">
          <span className={cn('pr-status-dot', !database.connected && 'pr-status-dot--warn')} />
          <strong className="pr-body font-normal">数据库</strong>
        </div>
        <div className="pr-meta mt-1 block">
          {database.connected ? '已连接' : '断开'}
          {` · ${database.type.toUpperCase()} · `}
          <span className="font-mono">{database.url}</span>
        </div>
        {database.error && <p className="mt-2 text-xs" style={{ color: 'var(--pr-danger)' }}>{database.error}</p>}
      </div>
    </div>
  )
}

function InfoCard({ label, value, icon: Icon, accent }: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  accent?: 'red' | 'green'
}) {
  return (
    <div className="border-b pb-5" style={{ borderColor: 'var(--pr-line)' }}>
      <div className="pr-kpi-label flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="pr-kpi mt-2 truncate">
        {value}
        {accent && (
          <span className="ml-2 align-middle text-base text-muted-foreground" aria-label={accent === 'green' ? '正常' : '失败'}>
            {accent === 'green' ? '✓' : '!'}
          </span>
        )}
      </p>
    </div>
  )
}
