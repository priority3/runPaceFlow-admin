'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Wifi, WifiOff } from 'lucide-react'

import { cn } from '@/lib/utils'

interface HealthData {
  status: 'healthy' | 'warning' | 'critical' | 'no_data'
  message: string
  beacons: {
    last5min: number
    last1h: number
    last1d: number
    lastTimestamp: string | null
  }
  errors: { last1h: number }
  clicks: { last1h: number }
  timestamp: string
}

function formatTime(iso: string | null): string {
  if (!iso) return '无'
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return d.toLocaleDateString('zh-CN')
}

export function ConnectionHealthPanel() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/analytics/health', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed')
      setHealth(await res.json())
      setError(false)
    } catch {
      setError(true)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 15_000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="bg-card rounded-lg border p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm font-medium">信标连接状态</span>
        </div>
      </div>
    )
  }

  if (error || !health) {
    return (
      <div className="bg-card rounded-lg border p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <WifiOff className="h-4 w-4 text-red-500" />
          <span className="text-sm font-medium">信标连接状态</span>
        </div>
        <p className="text-xs text-muted-foreground">无法获取连接状态</p>
      </div>
    )
  }

  const statusConfig = {
    healthy: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', label: '正常' },
    warning: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', label: '警告' },
    critical: { icon: WifiOff, color: 'text-red-500', bg: 'bg-red-50', text: 'text-red-700', label: '异常' },
    no_data: { icon: WifiOff, color: 'text-red-500', bg: 'bg-red-50', text: 'text-red-700', label: '无数据' },
  }

  const cfg = statusConfig[health.status]
  const StatusIcon = cfg.icon

  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">信标连接状态</span>
        </div>
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', cfg.bg, cfg.text)}>
          <StatusIcon className="h-3 w-3" />
          {cfg.label}
        </span>
      </div>

      <p className="text-xs text-muted-foreground mb-3">{health.message}</p>

      <dl className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">最近5分钟</dt>
          <dd className="tabular-nums font-medium">{health.beacons.last5min} 次</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">最近1小时</dt>
          <dd className="tabular-nums font-medium">{health.beacons.last1h} 次</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">今日总计</dt>
          <dd className="tabular-nums font-medium">{health.beacons.last1d} 次</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">最后信标</dt>
          <dd>{formatTime(health.beacons.lastTimestamp)}</dd>
        </div>
        {health.errors.last1h > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">最近1h错误</dt>
            <dd className="tabular-nums text-red-600 font-medium">{health.errors.last1h}</dd>
          </div>
        )}
        {health.clicks.last1h > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">最近1h点击</dt>
            <dd className="tabular-nums">{health.clicks.last1h}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}
