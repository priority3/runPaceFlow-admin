'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Save, Sparkles, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

/**
 * PR Agent 模型网关卡片:经 /api/pr-agent-settings 代理读写 pr-agent 的运行时配置。
 * 改完即生效、免重启;存储/白名单/加密的 owner 在 pr-agent 侧,这里只是 UI 壳。
 * 与下方分类设置里的 ANTHROPIC 键不是一回事——那份只喂本仓的 AI 洞察。
 */

interface OverrideView {
  key: string
  source: 'override' | 'env' | 'unset'
  preview: string | null
}

const KEY_LABELS: Record<string, string> = {
  ANTHROPIC_API_KEY: 'API Key(主链路)',
  ANTHROPIC_BASE_URL: 'Base URL',
  ANTHROPIC_MODEL: '模型',
  ANTHROPIC_VISION_MODEL: '视觉模型(可选)',
  OPENAI_API_KEY: 'API Key(备用链路)',
  OPENAI_BASE_URL: 'Base URL',
  OPENAI_MODEL: '模型',
  OPENAI_API_FORMAT: '请求格式(chat|responses)',
}

const SOURCE_BADGE: Record<OverrideView['source'], { label: string; className: string }> = {
  override: { label: '面板覆盖', className: 'border-violet-300 bg-violet-50 text-violet-700' },
  env: { label: 'env', className: 'border-slate-300 bg-slate-50 text-slate-600' },
  unset: { label: '未设', className: 'border-amber-300 bg-amber-50 text-amber-700' },
}

export function PrGatewayCard() {
  const [views, setViews] = useState<OverrideView[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pr-agent-settings', { cache: 'no-store' })
      if (!res.ok) throw new Error(`pr-agent 不可达(${res.status})`)
      const json = await res.json()
      setViews(json.settings as OverrideView[])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
      setViews([])
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载即拉外部状态
    void load()
  }, [load])

  const put = useCallback(
    async (payload: Record<string, string>, okMessage: string) => {
      setBusy(true)
      try {
        const res = await fetch('/api/pr-agent-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || `保存失败(${res.status})`)
        setViews(json.settings as OverrideView[])
        setDrafts(prev => {
          const next = { ...prev }
          for (const key of Object.keys(payload)) delete next[key]
          return next
        })
        toast.success(okMessage)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '保存失败')
      }
      setBusy(false)
    },
    [toast],
  )

  const dirty = Object.entries(drafts).filter(([, value]) => value.trim() !== '')

  return (
    <div className="bg-card rounded-lg border shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" />
          <h3 className="text-sm font-semibold">PR Agent 模型网关</h3>
          <span className="text-muted-foreground text-xs">改完即生效,免重启 · 存储在 pr-agent(密文)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="text-muted-foreground hover:bg-muted rounded-md border px-2 py-1 text-xs transition-colors"
          >
            <RefreshCw className="inline h-3 w-3" /> 刷新
          </button>
          <button
            type="button"
            disabled={busy || dirty.length === 0}
            onClick={() => void put(Object.fromEntries(dirty), `已保存 ${dirty.length} 项,立即生效`)}
            className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
          >
            <Save className="inline h-3 w-3" /> 保存修改{dirty.length ? `(${dirty.length})` : ''}
          </button>
        </div>
      </div>

      {error && <p className="px-4 pt-3 text-xs text-red-700">{error} —— 检查 PR_AGENT_URL / PR_AGENT_TOKEN</p>}

      <div className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
        {(views ?? []).map(view => (
          <div key={view.key}>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-medium">{KEY_LABELS[view.key] ?? view.key}</span>
              <span className={cn('rounded border px-1 py-0.5 text-[10px]', SOURCE_BADGE[view.source].className)}>
                {SOURCE_BADGE[view.source].label}
              </span>
              {view.source === 'override' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void put({ [view.key]: '' }, '已清除覆盖,回落 env')}
                  className="text-muted-foreground hover:text-red-700 text-[10px] underline-offset-2 hover:underline"
                  title="清除面板覆盖,回落环境变量"
                >
                  <X className="inline h-2.5 w-2.5" />
                  清除
                </button>
              )}
            </div>
            <input
              type="text"
              value={drafts[view.key] ?? ''}
              onChange={e => setDrafts(prev => ({ ...prev, [view.key]: e.target.value }))}
              placeholder={view.preview ?? '(未配置)'}
              className="bg-background w-full rounded border px-2 py-1 font-mono text-xs"
            />
            <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">{view.key}</p>
          </div>
        ))}
      </div>
      {views === null && <p className="text-muted-foreground px-4 pb-4 text-xs">加载中…</p>}
    </div>
  )
}
