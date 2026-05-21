'use client'

import { useEffect, useState } from 'react'
import { Target } from 'lucide-react'

import { cn } from '@/lib/utils'

import { CollapsibleSection } from './shared'

interface ConversionGoal {
  id: string
  name: string
  path: string
  description: string
}

interface ConversionResult {
  goal: ConversionGoal
  totalVisitors: number
  conversions: number
  conversionRate: number
  dailyConversions: Array<{ date: string; count: number }>
}

export function ConversionGoalsPanel() {
  const [data, setData] = useState<ConversionResult[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/analytics/conversions?days=30', { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setData(json.data ?? [])
        }
      } catch {}
      setLoading(false)
    }
    fetchData()
  }, [])

  if (loading) return null
  if (data.length === 0) return null

  const maxDaily = Math.max(
    ...data.flatMap(d => d.dailyConversions.map(dc => dc.count)),
    1,
  )

  return (
    <CollapsibleSection title="转化目标" defaultOpen={false}>
      <div className="space-y-6">
        {data.map(item => (
          <div key={item.goal.id}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <div>
                  <h4 className="text-sm font-medium">{item.goal.name}</h4>
                  <p className="text-[10px] text-muted-foreground">{item.goal.description}</p>
                </div>
              </div>
              <div className="text-right">
                <span className={cn('text-sm font-medium tabular-nums',
                  item.conversionRate > 50 ? 'text-emerald-600' :
                  item.conversionRate > 20 ? 'text-amber-600' : 'text-red-600'
                )}>
                  {item.conversionRate.toFixed(1)}%
                </span>
                <p className="text-[10px] text-muted-foreground">
                  {item.conversions} / {item.totalVisitors}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="bg-muted h-2 rounded-full overflow-hidden mb-3">
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${Math.max(item.conversionRate, 1)}%` }}
              />
            </div>

            {/* Daily trend */}
            {item.dailyConversions.length > 0 && (
              <div className="flex items-end gap-0.5 h-12">
                {item.dailyConversions.map(d => (
                  <div key={d.date} className="flex-1 flex flex-col items-center group relative">
                    <div className="w-full flex justify-center">
                      <div className="hidden group-hover:block absolute bottom-full mb-1 bg-foreground text-background text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                        {d.date.slice(5)} — {d.count} 次
                      </div>
                    </div>
                    <div
                      className="bg-primary/70 rounded-t w-full"
                      style={{ height: `${Math.max((d.count / maxDaily) * 100, 2)}%`, minHeight: d.count > 0 ? '2px' : '1px' }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </CollapsibleSection>
  )
}
