'use client'

import { useEffect, useState } from 'react'
import { Brain, Check, Pencil, Archive, RefreshCw, X } from 'lucide-react'

import { cn, formatDateTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

import { LoadingState } from './shared'

interface MemoryItem {
  id: string
  type: string
  status: string
  content: string
  confidence: number
  evidence: unknown[]
  version: number
  lastSeenAt: string
}

const TYPE_LABEL: Record<string, string> = {
  preference: '偏好',
  habit: '习惯',
  goal: '目标',
  injury: '伤病',
  correction: '纠正',
  risk_pattern: '风险',
  relationship_note: '关系',
}

const TYPE_OPTIONS = Object.keys(TYPE_LABEL)

// Reason: 面板早期按深色皮肤写死了 white/* 与 *-300 文字色,但本项目只有浅色一套
// 主题(globals.css 仅 :root + color-scheme: light),结果白字白底整段读不出来。
// 统一改用语义 token,徽章取浅底深字。
function typeClass(type: string) {
  switch (type) {
    case 'correction':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    case 'injury':
    case 'risk_pattern':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'goal':
      return 'border-sky-200 bg-sky-50 text-sky-700'
    default:
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
}

export function MemoryPanel() {
  const { success, error: toastError } = useToast()
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editType, setEditType] = useState('preference')

  const fetchMemories = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/pr/memories?status=candidate,active', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setMemories(data.memories ?? [])
        setLoadError(null)
      } else {
        setLoadError(`加载记忆失败 (HTTP ${res.status})`)
      }
    } catch (e) {
      setLoadError(`加载记忆失败: ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setLoading(false)
  }

  useEffect(() => {
    void Promise.resolve().then(fetchMemories)
  }, [])

  async function act(id: string, path: string, label: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/pr/memories/${id}/${path}`, { method: 'POST' })
      if (res.ok) {
        success(`已${label}`)
        await fetchMemories()
      } else {
        toastError(`${label}失败 (HTTP ${res.status})`)
      }
    } catch (e) {
      toastError(`${label}失败: ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setBusyId(null)
  }

  function startEdit(memory: MemoryItem) {
    setEditing(memory.id)
    setEditContent(memory.content)
    setEditType(memory.type)
  }

  async function saveEdit(id: string) {
    if (!editContent.trim()) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/pr/memories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.trim(), type: editType, reason: '用户在面板编辑记忆。' }),
      })
      if (res.ok) {
        success('已保存')
        setEditing(null)
        await fetchMemories()
      } else {
        toastError(`保存失败 (HTTP ${res.status})`)
      }
    } catch (e) {
      toastError(`保存失败: ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setBusyId(null)
  }

  const candidates = memories.filter(m => m.status === 'candidate')
  const actives = memories.filter(m => m.status === 'active')

  function renderRow(memory: MemoryItem) {
    const isEditing = editing === memory.id
    const busy = busyId === memory.id
    return (
      <div key={memory.id} className="bg-card rounded-lg border p-3 shadow-sm">
        <div className="flex items-start gap-2">
          <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-xs', typeClass(memory.type))}>
            {TYPE_LABEL[memory.type] ?? memory.type}
          </span>
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={2}
                  className="bg-background w-full rounded border px-2 py-1 text-sm"
                />
                <select
                  value={editType}
                  onChange={e => setEditType(e.target.value)}
                  className="bg-background rounded border px-2 py-1 text-xs"
                >
                  {TYPE_OPTIONS.map(t => (
                    <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="break-words text-sm">{memory.content}</p>
            )}
            <p className="text-muted-foreground mt-1 text-xs">
              置信 {memory.confidence.toFixed(2)} · 证据 {memory.evidence?.length ?? 0} · {formatDateTime(memory.lastSeenAt)}
            </p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {isEditing ? (
            <>
              <button type="button" disabled={busy} onClick={() => saveEdit(memory.id)}
                className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-200 disabled:opacity-50">
                <Check className="h-3 w-3" /> 保存
              </button>
              <button type="button" onClick={() => setEditing(null)}
                className="bg-muted text-muted-foreground hover:bg-accent inline-flex items-center gap-1 rounded px-2 py-1 text-xs">
                <X className="h-3 w-3" /> 取消
              </button>
            </>
          ) : (
            <>
              {memory.status === 'candidate' && (
                <button type="button" disabled={busy} onClick={() => act(memory.id, 'confirm', '确认')}
                  className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-200 disabled:opacity-50">
                  <Check className="h-3 w-3" /> 确认
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => startEdit(memory)}
                className="bg-muted text-muted-foreground hover:bg-accent inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50">
                <Pencil className="h-3 w-3" /> 编辑
              </button>
              <button type="button" disabled={busy} onClick={() => act(memory.id, 'archive', '归档/纠正')}
                className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-rose-100 hover:text-rose-700 disabled:opacity-50">
                <Archive className="h-3 w-3" /> 归档
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  if (loading) return <LoadingState />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Brain className="h-4 w-4" /> PR 的记忆
        </h3>
        <button type="button" onClick={fetchMemories}
          className="bg-muted text-muted-foreground hover:bg-accent inline-flex items-center gap-1 rounded px-2 py-1 text-xs">
          <RefreshCw className="h-3 w-3" /> 刷新
        </button>
      </div>

      {loadError && <p className="text-sm text-rose-600">{loadError}</p>}

      <div>
        <p className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
          待确认候选（{candidates.length}）· 确认后才会影响 PR 对你的判断
        </p>
        {candidates.length ? (
          <div className="space-y-2">{candidates.map(renderRow)}</div>
        ) : (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
            暂无候选记忆。等你和 PR 聊天或反馈时，它会蒸馏出候选放这里。
          </p>
        )}
      </div>

      <div>
        <p className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">已生效（{actives.length}）</p>
        {actives.length ? (
          <div className="space-y-2">{actives.map(renderRow)}</div>
        ) : (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
            还没有生效记忆。确认候选或多次证据累积后会出现在这里。
          </p>
        )}
      </div>
    </div>
  )
}
