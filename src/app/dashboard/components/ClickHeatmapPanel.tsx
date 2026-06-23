'use client'

import { useEffect, useState } from 'react'
import { MousePointerClick } from 'lucide-react'

import { CollapsibleSection, CollapsibleSkeleton } from './shared'

interface ClickData {
  x: number
  y: number
  selector: string
  count: number
}

interface ClickStats {
  totalClicks: number
  uniqueSelectors: number
}

export function ClickHeatmapPanel() {
  const [clicks, setClicks] = useState<ClickData[]>([])
  const [stats, setStats] = useState<ClickStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPath, setSelectedPath] = useState('/')

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/analytics/clicks?path=${encodeURIComponent(selectedPath)}&days=7`, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setClicks(data.clicks ?? [])
          setStats(data.stats ?? null)
        }
      } catch {}
      setLoading(false)
    }
    fetchData()
  }, [selectedPath])

  if (loading) return <CollapsibleSkeleton />
  if (!stats || stats.totalClicks === 0) return null

  const maxCount = Math.max(...clicks.map(c => c.count), 1)

  return (
    <CollapsibleSection title="点击热力图" defaultOpen={false}>
      <div className="space-y-4">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MousePointerClick className="h-3.5 w-3.5" />
            {stats.totalClicks} 次点击
          </span>
          <span>{stats.uniqueSelectors} 个元素</span>
          <input
            type="text"
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            placeholder="输入页面路径"
            className="border-input bg-background placeholder:text-muted-foreground focus:border-ring h-7 w-40 rounded-md border px-2 text-xs shadow-sm outline-none focus:ring-[3px]"
          />
        </div>

        {/* Heatmap visualization */}
        <div className="bg-muted relative rounded-lg overflow-hidden" style={{ height: '400px' }}>
          {clicks.slice(0, 50).map((click, i) => {
            const size = Math.max(8, Math.min(32, (click.count / maxCount) * 32))
            const opacity = 0.3 + (click.count / maxCount) * 0.7
            return (
              <div
                key={`${click.x}-${click.y}-${i}`}
                className="absolute rounded-full bg-red-500 group cursor-pointer"
                style={{
                  left: `${click.x}%`,
                  top: `${click.y}%`,
                  width: `${size}px`,
                  height: `${size}px`,
                  opacity,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="hidden group-hover:block absolute bottom-full mb-1 bg-foreground text-background text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                  {click.selector} — {click.count} 次
                </div>
              </div>
            )
          })}
        </div>

        {/* Top clicked elements */}
        <div>
          <h4 className="text-xs font-medium mb-2">热门点击元素</h4>
          <div className="space-y-1.5">
            {clicks.slice(0, 10).map((click, i) => (
              <div key={`${click.selector}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="font-mono truncate max-w-[300px]">{click.selector}</span>
                <div className="bg-muted flex-1 h-1 rounded-full overflow-hidden">
                  <div
                    className="bg-red-500 h-full rounded-full"
                    style={{ width: `${(click.count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="tabular-nums shrink-0">{click.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CollapsibleSection>
  )
}
