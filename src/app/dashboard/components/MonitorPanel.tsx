'use client'

import { Database, ServerCog, Shield, Timer } from 'lucide-react'

import { cn, formatDateTime } from '@/lib/utils'

import type { MonitorData } from '../DashboardView'

import { LoadingState, ServiceCard, StatCard } from './shared'

export function MonitorPanel({ monitor, loading }: { monitor: MonitorData | null; loading: boolean }) {
  if (loading) return <LoadingState />

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4">
        <h2 className="text-xl font-semibold">系统监控</h2>
      </header>

      <section>
        <h3 className="mb-3 text-sm font-semibold">服务状态</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {monitor?.services.map(s => (
            <ServiceCard key={s.name} name={s.name} status={s.status} responseTime={s.responseTimeMs} />
          ))}
          <ServiceCard
            name="数据库"
            status={monitor?.database?.connected ? 'online' : 'offline'}
            type={monitor?.database?.type}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">系统资源</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={ServerCog} label="Node.js" value={monitor?.system.nodeVersion ?? '-'} />
          <StatCard icon={Timer} label="运行时间" value={monitor?.system.uptimeFormatted ?? '-'} />
          <StatCard icon={Database} label="Heap" value={`${monitor?.system.memory.heapUsedFormatted ?? '-'} / ${monitor?.system.memory.heapTotalFormatted ?? '-'}`} />
          <StatCard icon={Database} label="RSS" value={monitor?.system.memory.rssFormatted ?? '-'} />
        </div>
      </section>

      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Shield className="h-4 w-4" />
          操作审计
        </h3>
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          {!monitor?.auditLogs?.length ? (
            <div className="text-muted-foreground p-8 text-center text-sm">暂无操作记录</div>
          ) : (
            <div className="divide-y">
              {monitor.auditLogs.map(log => (
                <div key={log.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      'inline-flex h-6 items-center rounded px-2 text-xs font-medium',
                      log.action === 'upsert' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700',
                    )}>{log.action}</span>
                    <span className="text-muted-foreground font-mono text-xs">{log.key ?? '-'}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">{formatDateTime(log.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
