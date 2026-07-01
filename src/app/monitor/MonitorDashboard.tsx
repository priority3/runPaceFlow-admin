'use client'

import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Globe,
  HardDrive,
  LayoutDashboard,
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
    <div className="bg-muted/40 text-foreground min-h-dvh min-[520px]:pl-60">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border border-b min-[520px]:fixed min-[520px]:inset-y-0 min-[520px]:left-0 min-[520px]:z-40 min-[520px]:flex min-[520px]:w-60 min-[520px]:flex-col min-[520px]:border-r min-[520px]:border-b-0">
        <div className="border-sidebar-border flex h-16 items-center gap-3 border-b px-4">
          <span className="bg-primary text-primary-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
            <LayoutDashboard className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">RunPaceFlow Admin</h1>
            <p className="text-muted-foreground truncate text-xs">监控面板</p>
          </div>
        </div>

        <div className="scrollbar-subtle min-[520px]:flex-1 min-[520px]:overflow-y-auto">
          <nav className="space-y-1 p-3">
            <Link
              href="/"
              className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-10 w-full items-center gap-2 rounded-md px-3 text-sm transition-colors"
            >
              <Server className="h-4 w-4" />
              运维控制台
            </Link>
            <div className="bg-sidebar-accent text-sidebar-accent-foreground flex h-10 w-full items-center gap-2 rounded-md px-3 text-sm font-medium">
              <Activity className="h-4 w-4" />
              系统监控
            </div>
          </nav>
        </div>

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

      <header className="bg-background/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="flex min-h-16 flex-col justify-center gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">monitor</p>
            <h2 className="truncate text-xl font-semibold">监控面板</h2>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="bg-background hover:bg-accent hover:text-accent-foreground flex h-9 items-center gap-2 rounded-md border px-3 text-sm shadow-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            {refreshing ? '刷新中...' : '刷新'}
          </button>
        </div>
      </header>

      <main className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* 服务状态 */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Server className="h-4 w-4" />
            服务状态
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.services.map((service) => (
              <ServiceCard key={service.name} service={service} />
            ))}
            <DatabaseCard database={data.database} />
          </div>
        </section>

        {/* 配置同步状态 */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4" />
            配置同步
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <InfoCard
              label="最后同步"
              value={data.sync.lastSyncTime ? formatDateTime(data.sync.lastSyncTime) : '无记录'}
              icon={Clock}
            />
            <InfoCard
              label="总变更次数"
              value={String(data.sync.totalChanges)}
              icon={Activity}
            />
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
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Cpu className="h-4 w-4" />
            系统资源
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoCard
              label="Node.js"
              value={data.system.nodeVersion}
              icon={Server}
            />
            <InfoCard
              label="运行时间"
              value={data.system.uptimeFormatted}
              icon={Clock}
            />
            <InfoCard
              label="Heap 使用"
              value={`${data.system.memory.heapUsedFormatted} / ${data.system.memory.heapTotalFormatted}`}
              icon={HardDrive}
            />
            <InfoCard
              label="RSS 内存"
              value={data.system.memory.rssFormatted}
              icon={HardDrive}
            />
          </div>
        </section>

        {/* 操作审计日志 */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4" />
            操作审计
          </h3>
          <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
            {data.auditLogs.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-sm">暂无操作记录</div>
            ) : (
              <div className="divide-y">
                {data.auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          'inline-flex h-6 items-center rounded px-2 text-xs font-medium',
                          log.action === 'upsert'
                            ? 'bg-blue-50 text-blue-700'
                            : log.action === 'import'
                              ? 'bg-purple-50 text-purple-700'
                              : 'bg-gray-50 text-gray-700',
                        )}
                      >
                        {log.action}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {log.key ?? '-'}
                      </span>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatDateTime(log.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function ServiceCard({ service }: { service: { name: string; status: string; responseTimeMs: number | null; url: string; error?: string } }) {
  const isOnline = service.status === 'online'
  const isDegraded = service.status === 'degraded'

  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">{service.name}</span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            isOnline
              ? 'bg-emerald-50 text-emerald-700'
              : isDegraded
                ? 'bg-amber-50 text-amber-700'
                : 'bg-red-50 text-red-700',
          )}
        >
          {isOnline ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          {isOnline ? '在线' : isDegraded ? '降级' : '离线'}
        </span>
      </div>
      <dl className="space-y-1 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">响应时间</dt>
          <dd className="tabular-nums">
            {service.responseTimeMs !== null ? `${service.responseTimeMs}ms` : '-'}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">地址</dt>
          <dd className="text-muted-foreground truncate font-mono">{service.url}</dd>
        </div>
        {service.error && (
          <div className="mt-2 rounded bg-red-50 p-2 text-red-700">{service.error}</div>
        )}
      </dl>
    </div>
  )
}

function DatabaseCard({ database }: { database: { connected: boolean; type: string; url: string; error?: string } }) {
  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">数据库</span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            database.connected
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700',
          )}
        >
          {database.connected ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          {database.connected ? '已连接' : '断开'}
        </span>
      </div>
      <dl className="space-y-1 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">类型</dt>
          <dd className="font-medium uppercase">{database.type}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">地址</dt>
          <dd className="text-muted-foreground truncate font-mono">{database.url}</dd>
        </div>
        {database.error && (
          <div className="mt-2 rounded bg-red-50 p-2 text-red-700">{database.error}</div>
        )}
      </dl>
    </div>
  )
}

function InfoCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  accent?: 'red' | 'green'
}) {
  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className="text-muted-foreground h-4 w-4" />
        <span className="text-muted-foreground text-xs">{label}</span>
      </div>
      <p
        className={cn(
          'mt-2 truncate text-sm font-semibold tabular-nums',
          accent === 'red' && 'text-red-600',
          accent === 'green' && 'text-emerald-600',
        )}
      >
        {value}
      </p>
    </div>
  )
}
