'use client'

import { useEffect, useState } from 'react'
import { FlaskConical, Plus, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'

import { CollapsibleSection } from './shared'

interface ABTest {
  id: string
  name: string
  variants: string[]
  traffic: number // percentage 0-100
  enabled: boolean
  createdAt: string
}

export function ABTestConfigPanel() {
  const [tests, setTests] = useState<ABTest[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newTest, setNewTest] = useState({ name: '', variants: 'control,variant-a' })

  useEffect(() => {
    fetchTests()
  }, [])

  const fetchTests = async () => {
    try {
      const res = await fetch('/api/analytics/ab-test-config', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setTests(data.tests ?? [])
      }
    } catch {}
    setLoading(false)
  }

  const handleCreate = async () => {
    if (!newTest.name || !newTest.variants) return

    const variants = newTest.variants.split(',').map(v => v.trim()).filter(Boolean)
    if (variants.length < 2) return

    try {
      const res = await fetch('/api/analytics/ab-test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTest.name, variants }),
      })
      if (res.ok) {
        setNewTest({ name: '', variants: 'control,variant-a' })
        setShowCreate(false)
        fetchTests()
      }
    } catch {}
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetch('/api/analytics/ab-test-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      })
      fetchTests()
    } catch {}
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch('/api/analytics/ab-test-config', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      fetchTests()
    } catch {}
  }

  if (loading) return null

  return (
    <CollapsibleSection title="A/B 测试配置" defaultOpen={false}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{tests.length} 个测试</span>
          <button
            type="button"
            onClick={() => setShowCreate(!showCreate)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium shadow-sm transition-colors"
          >
            <Plus className="h-3 w-3" />
            新建测试
          </button>
        </div>

        {showCreate && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <input
              type="text"
              value={newTest.name}
              onChange={(e) => setNewTest(p => ({ ...p, name: e.target.value }))}
              placeholder="测试名称"
              className="border-input bg-background placeholder:text-muted-foreground focus:border-ring h-8 w-full rounded-md border px-2 text-xs shadow-sm outline-none focus:ring-[3px]"
            />
            <input
              type="text"
              value={newTest.variants}
              onChange={(e) => setNewTest(p => ({ ...p, variants: e.target.value }))}
              placeholder="变体 (逗号分隔)"
              className="border-input bg-background placeholder:text-muted-foreground focus:border-ring h-8 w-full rounded-md border px-2 text-xs shadow-sm outline-none focus:ring-[3px]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCreate}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium shadow-sm transition-colors"
              >
                创建
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="bg-background hover:bg-accent flex h-7 items-center gap-1 rounded-md border px-2 text-xs shadow-sm transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {tests.map(test => (
            <div key={test.id} className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">{test.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggle(test.id, !test.enabled)}
                    className={cn(
                      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                      test.enabled ? 'bg-primary' : 'bg-muted',
                    )}
                  >
                    <span className={cn(
                      'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                      test.enabled ? 'translate-x-4.5' : 'translate-x-0.5',
                    )} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(test.id)}
                    className="text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {test.variants.map(v => (
                  <span key={v} className="bg-background rounded px-1.5 py-0.5 text-[10px] font-mono">
                    {v}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {tests.length === 0 && (
          <p className="text-muted-foreground text-xs text-center py-4">
            暂无 A/B 测试，点击上方按钮创建
          </p>
        )}
      </div>
    </CollapsibleSection>
  )
}
