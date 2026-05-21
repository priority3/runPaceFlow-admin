'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Brain,
  CheckCircle2,
  Info,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

import { cn } from '@/lib/utils'

interface Insight {
  id: string
  type: 'traffic' | 'performance' | 'audience' | 'content' | 'warning'
  severity: 'info' | 'positive' | 'negative' | 'critical'
  title: string
  description: string
  metric?: string
  value?: string
  trend?: 'up' | 'down' | 'stable'
}

const TYPE_ICONS: Record<Insight['type'], React.ComponentType<{ className?: string }>> = {
  traffic: TrendingUp,
  performance: RefreshCw,
  audience: Brain,
  content: Info,
  warning: AlertTriangle,
}

const SEVERITY_STYLES: Record<Insight['severity'], string> = {
  info: 'border-blue-200 bg-blue-50/50',
  positive: 'border-emerald-200 bg-emerald-50/50',
  negative: 'border-amber-200 bg-amber-50/50',
  critical: 'border-red-200 bg-red-50/50',
}

const SEVERITY_ICON_COLORS: Record<Insight['severity'], string> = {
  info: 'text-blue-500',
  positive: 'text-emerald-500',
  negative: 'text-amber-500',
  critical: 'text-red-500',
}

export function InsightsPanel() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchInsights = async () => {
      try {
        const res = await fetch('/api/analytics/insights', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setInsights(data.insights ?? [])
        }
      } catch {}
      setLoading(false)
    }

    fetchInsights()
    const interval = setInterval(fetchInsights, 60_000) // Refresh every minute
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="bg-card rounded-lg border p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm font-medium">智能洞察</span>
        </div>
      </div>
    )
  }

  if (insights.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">智能洞察</h3>
        <span className="text-muted-foreground text-xs">({insights.length})</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {insights.map(insight => {
          const Icon = TYPE_ICONS[insight.type]
          return (
            <div
              key={insight.id}
              className={cn('rounded-lg border p-3 shadow-sm transition-colors hover:shadow-md', SEVERITY_STYLES[insight.severity])}
            >
              <div className="flex items-start gap-2.5">
                <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', SEVERITY_ICON_COLORS[insight.severity])} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{insight.title}</span>
                    {insight.trend && (
                      <span className={cn('shrink-0',
                        insight.trend === 'up' ? 'text-emerald-600' : insight.trend === 'down' ? 'text-red-600' : 'text-muted-foreground'
                      )}>
                        {insight.trend === 'up' ? <ArrowUp className="h-3 w-3" /> : insight.trend === 'down' ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs mt-0.5">{insight.description}</p>
                  {insight.metric && insight.value && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-muted-foreground text-[10px]">{insight.metric}</span>
                      <span className="text-xs font-semibold tabular-nums">{insight.value}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
