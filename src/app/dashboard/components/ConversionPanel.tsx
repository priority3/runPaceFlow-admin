'use client'

import { useEffect, useState } from 'react'
import { Target, TrendingUp } from 'lucide-react'

import { cn } from '@/lib/utils'

import { CollapsibleSection, CollapsibleSkeleton } from './shared'

interface ABTestVariant {
  name: string
  visitors: number
  conversions: number
  conversionRate: number
}

interface ABTestResult {
  testName: string
  variants: ABTestVariant[]
  totalVisitors: number
}

export function ConversionPanel() {
  const [abTests, setABTests] = useState<ABTestResult[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/analytics/ab-tests?days=30', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setABTests(data.tests ?? [])
        }
      } catch {}
      setLoading(false)
    }
    fetchData()
  }, [])

  if (loading) return <CollapsibleSkeleton />
  if (abTests.length === 0) return null

  return (
    <CollapsibleSection title="A/B 测试与转化" defaultOpen={false}>
      <div className="space-y-6">
        {abTests.map(test => (
          <div key={test.testName}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-medium">{test.testName}</h4>
              </div>
              <span className="text-muted-foreground text-xs tabular-nums">
                {test.totalVisitors} 访客
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {test.variants.map(variant => (
                <div key={variant.name} className="bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium">{variant.name}</span>
                    <div className="flex items-center gap-1">
                      <TrendingUp className={cn('h-3 w-3',
                        variant.conversionRate > 50 ? 'text-emerald-500' :
                        variant.conversionRate > 20 ? 'text-amber-500' : 'text-red-500'
                      )} />
                      <span className={cn('text-xs font-medium tabular-nums',
                        variant.conversionRate > 50 ? 'text-emerald-600' :
                        variant.conversionRate > 20 ? 'text-amber-600' : 'text-red-600'
                      )}>
                        {variant.conversionRate.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="bg-background h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${Math.max(variant.conversionRate, 1)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span>{variant.visitors} 访客</span>
                    <span>{variant.conversions} 转化</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  )
}
