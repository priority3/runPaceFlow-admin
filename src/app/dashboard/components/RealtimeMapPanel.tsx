'use client'

import { useEffect, useState } from 'react'
import { MapPin, Users } from 'lucide-react'

import { CollapsibleSection } from './shared'

interface RealtimeVisitor {
  visitorId: string
  path: string
  country: string | null
  city: string | null
  browser: string | null
  os: string | null
  deviceType: string | null
  lastSeen: number
}

interface RealtimeData {
  count: number
  visitors: RealtimeVisitor[]
}

export function RealtimeMapPanel() {
  const [data, setData] = useState<RealtimeData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/analytics/realtime-visitors', { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch {}
      setLoading(false)
    }

    fetchData()
    const interval = setInterval(fetchData, 10000) // Refresh every 10s
    return () => clearInterval(interval)
  }, [])

  if (loading) return null
  if (!data || data.count === 0) return null

  // Group visitors by country
  const byCountry = new Map<string, RealtimeVisitor[]>()
  for (const v of data.visitors) {
    const country = v.country || '未知'
    if (!byCountry.has(country)) byCountry.set(country, [])
    byCountry.get(country)!.push(v)
  }

  const sortedCountries = Array.from(byCountry.entries())
    .sort((a, b) => b[1].length - a[1].length)

  return (
    <CollapsibleSection title="实时访客" defaultOpen={true}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-sm font-medium">{data.count} 位访客在线</span>
        </div>

        {/* Country distribution */}
        <div className="grid gap-3 sm:grid-cols-2">
          {sortedCountries.slice(0, 6).map(([country, visitors]) => (
            <div key={country} className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium">{country}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{visitors.length}</span>
              </div>
              <div className="space-y-1">
                {visitors.slice(0, 3).map(v => (
                  <div key={v.visitorId} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <MapPin className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate max-w-[120px]">{v.city || '未知城市'}</span>
                    <span className="font-mono truncate max-w-[80px]">{v.path}</span>
                  </div>
                ))}
                {visitors.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{visitors.length - 3} 更多</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Active pages */}
        <div>
          <h4 className="text-xs font-medium mb-2">当前活跃页面</h4>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(new Map(data.visitors.map(v => [v.path, 0])).keys()).slice(0, 10).map(path => {
              const count = data.visitors.filter(v => v.path === path).length
              return (
                <span key={path} className="bg-muted inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-mono">
                  {path}
                  <span className="text-muted-foreground">({count})</span>
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </CollapsibleSection>
  )
}
