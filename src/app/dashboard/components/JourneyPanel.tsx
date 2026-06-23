'use client'

import { useEffect, useState } from 'react'
import { Route, ArrowRight } from 'lucide-react'

import { CollapsibleSection, CollapsibleSkeleton } from './shared'

interface JourneyPath {
  from: string
  to: string
  count: number
  percentage: number
}

interface JourneyData {
  paths: JourneyPath[]
  totalTransitions: number
}

export function JourneyPanel() {
  const [journey, setJourney] = useState<JourneyData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/analytics/journey?days=30', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setJourney(data)
        }
      } catch {}
      setLoading(false)
    }
    fetchData()
  }, [])

  if (loading) return <CollapsibleSkeleton />
  if (!journey || journey.paths.length === 0) return null

  return (
    <CollapsibleSection title="用户路径分析" defaultOpen={false}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Route className="h-3.5 w-3.5" />
          <span>共 {journey.totalTransitions} 次页面跳转</span>
        </div>

        <div className="space-y-2">
          {journey.paths.slice(0, 15).map((path, i) => (
            <div key={`${path.from}-${path.to}-${i}`} className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs mb-2">
                <span className="font-mono truncate max-w-[200px]">{path.from}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="font-mono truncate max-w-[200px]">{path.to}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-background flex-1 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${path.percentage}%` }}
                  />
                </div>
                <span className="text-xs font-medium tabular-nums shrink-0">
                  {path.count} ({path.percentage.toFixed(1)}%)
                </span>
              </div>
            </div>
          ))}
        </div>

        {journey.paths.length > 15 && (
          <p className="text-muted-foreground text-xs text-center">
            显示前 15 条，共 {journey.paths.length} 条路径
          </p>
        )}
      </div>
    </CollapsibleSection>
  )
}
