'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

import { CollapsibleSection, CollapsibleSkeleton } from './shared'

interface FunnelStep {
  path: string
  label: string
  visitors: number
  dropoffRate: number
}

interface FunnelResult {
  name: string
  steps: FunnelStep[]
  conversionRate: number
  totalVisitors: number
}

export function FunnelSection() {
  const [funnels, setFunnels] = useState<FunnelResult[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchFunnels = async () => {
      try {
        const res = await fetch('/api/analytics/funnels?days=30', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setFunnels(data.funnels)
        }
      } catch {}
      setLoading(false)
    }
    fetchFunnels()
  }, [])

  if (loading) return <CollapsibleSkeleton />
  if (funnels.length === 0) return null

  return (
    <CollapsibleSection title="转化漏斗" defaultOpen={false}>
      <div className="space-y-6">
        {funnels.map(funnel => (
          <div key={funnel.name}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium">{funnel.name}</h4>
              <span className={cn('text-xs font-medium',
                funnel.conversionRate > 50 ? 'text-emerald-600' :
                funnel.conversionRate > 20 ? 'text-amber-600' : 'text-red-600'
              )}>
                转化率 {funnel.conversionRate}%
              </span>
            </div>
            <div className="space-y-2">
              {funnel.steps.map((step, i) => {
                const widthPct = funnel.totalVisitors > 0
                  ? (step.visitors / funnel.totalVisitors) * 100
                  : 0
                return (
                  <div key={step.path}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{step.label}</span>
                      <div className="flex items-center gap-2">
                        {i > 0 && step.dropoffRate > 0 && (
                          <span className="text-red-500">-{step.dropoffRate}%</span>
                        )}
                        <span className="font-medium tabular-nums">{step.visitors} UV</span>
                      </div>
                    </div>
                    <div className="bg-muted h-6 rounded overflow-hidden">
                      <div
                        className="bg-primary/70 h-full rounded flex items-center px-2"
                        style={{ width: `${Math.max(widthPct, 2)}%` }}
                      >
                        <span className="text-primary-foreground text-[10px] font-medium whitespace-nowrap">
                          {widthPct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  )
}
