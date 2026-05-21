'use client'

import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Clock,
  Eye,
  Globe,
  Users,
} from 'lucide-react'

import { cn } from '@/lib/utils'

interface SummaryData {
  today: {
    views: number
    visitors: number
    sessions: number
    avgLoadTime: number | null
  }
  yesterday: {
    views: number
    visitors: number
    sessions: number
  }
  week: {
    views: number
    visitors: number
    sessions: number
  }
}

export function AnalyticsSummary() {
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/analytics/summary', { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch {}
      setLoading(false)
    }
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading || !data) return null

  const viewsDelta = data.yesterday.views > 0
    ? ((data.today.views - data.yesterday.views) / data.yesterday.views * 100)
    : null
  const visitorsDelta = data.yesterday.visitors > 0
    ? ((data.today.visitors - data.yesterday.visitors) / data.yesterday.visitors * 100)
    : null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        icon={Eye}
        label="今日 PV"
        value={data.today.views}
        delta={viewsDelta}
      />
      <MetricCard
        icon={Users}
        label="今日 UV"
        value={data.today.visitors}
        delta={visitorsDelta}
      />
      <MetricCard
        icon={BarChart3}
        label="本周浏览"
        value={data.week.views}
        subtitle={`${data.week.visitors} 访客`}
      />
      <MetricCard
        icon={Clock}
        label="平均加载"
        value={data.today.avgLoadTime != null ? `${Math.round(data.today.avgLoadTime)}ms` : '-'}
        subtitle={data.today.avgLoadTime != null
          ? (data.today.avgLoadTime < 1000 ? '优秀' : data.today.avgLoadTime < 2000 ? '良好' : '偏慢')
          : undefined}
      />
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  delta,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | string
  delta?: number | null
  subtitle?: string
}) {
  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground text-xs">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {delta != null && (
          <span className={cn('flex items-center gap-0.5 text-xs font-medium',
            delta >= 0 ? 'text-emerald-600' : 'text-red-600'
          )}>
            {delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
      {subtitle && (
        <p className="text-muted-foreground text-[10px] mt-1">{subtitle}</p>
      )}
    </div>
  )
}
