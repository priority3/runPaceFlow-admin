'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Minus, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'
import { LoadingState } from './shared'

/**
 * 成长回放(P5):persona_events 时间轴 —— 分身的每个特征是何时长出来/变化/退场的。
 * 数据源:GET /api/persona/history(转发 pr-agent);放在折叠区里,展开才拉取。
 */

interface PersonaEvent {
  id: string
  kind: 'trait_added' | 'trait_changed' | 'trait_removed' | string
  traitKey: string
  before: unknown
  after: unknown
  sourceRef: string | null
  createdAt: string
}

const KIND_META: Record<string, { icon: typeof Plus; label: string; className: string }> = {
  trait_added: { icon: Plus, label: '新增', className: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  trait_changed: { icon: ArrowRight, label: '变化', className: 'border-sky-300 bg-sky-50 text-sky-800' },
  trait_removed: { icon: Minus, label: '移除', className: 'border-rose-300 bg-rose-50 text-rose-800' },
}

/** trait key → 可读名。带 id 后缀的族(goal.race.* / injury.watch.*)按前缀归类。 */
const KEY_LABELS: Array<[RegExp, string]> = [
  [/^identity\.nickname$/, '称呼'],
  [/^goal\.race\./, '赛事目标'],
  [/^state\.recovery$/, '恢复状态'],
  [/^state\.training_load$/, '训练负荷'],
  [/^injury\.watch\./, '伤病关注'],
  [/^body\.height_cm$/, '身高'],
  [/^body\.weight_kg$/, '体重'],
  [/^body\.build$/, '体型'],
  [/^hobby\./, '爱好'],
]

function traitLabel(key: string): string {
  for (const [pattern, label] of KEY_LABELS) {
    if (pattern.test(key)) return label
  }
  return key
}

/** 值 → 短文本:对象取 name(赛事目标),其余 JSON 截断。 */
function fmtValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value.length > 42 ? `${value.slice(0, 42)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const name = (value as { name?: unknown })?.name
  if (typeof name === 'string') return name
  const json = JSON.stringify(value)
  return json.length > 42 ? `${json.slice(0, 42)}…` : json
}

const VALUE_MAP: Record<string, string> = {
  good: '良好',
  okay: '一般',
  poor: '偏差',
  unknown: '未知',
  idle: '休整中',
  recovering: '恢复中',
  steady: '稳定',
  high: '高负荷',
  slim: '偏瘦',
  standard: '标准',
  strong: '健壮',
}

function fmtValueCn(value: unknown): string {
  const raw = fmtValue(value)
  return VALUE_MAP[raw] ?? raw
}

export function PersonaHistory() {
  const [events, setEvents] = useState<PersonaEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 组件随折叠区展开才挂载,挂载即拉取一次(回放是低频动作,不做轮询)。
    fetch('/api/persona/history?limit=100', { cache: 'no-store' })
      .then(res => res.json())
      .then(json => setEvents(Array.isArray(json.events) ? (json.events as PersonaEvent[]) : []))
      .catch(e => setError(e instanceof Error ? e.message : '加载失败'))
  }, [])

  if (error) return <p className="text-sm text-red-900">加载失败:{error}</p>
  if (!events) return <LoadingState />
  if (!events.length) return <p className="text-muted-foreground py-6 text-center text-sm">还没有特征变更记录。</p>

  return (
    <ol className="space-y-2">
      {events.map(event => {
        const meta = KIND_META[event.kind] ?? KIND_META.trait_changed
        const Icon = meta.icon
        return (
          <li key={event.id} className="flex items-start gap-3 text-sm">
            <span className="text-muted-foreground w-24 shrink-0 pt-0.5 font-mono text-xs">
              {new Date(event.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className={cn('flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-xs', meta.className)}>
              <Icon className="h-3 w-3" />
              {meta.label}
            </span>
            <span className="min-w-0">
              <span className="font-medium">{traitLabel(event.traitKey)}</span>
              <span className="text-muted-foreground">
                {event.kind === 'trait_changed'
                  ? `:${fmtValueCn(event.before)} → ${fmtValueCn(event.after)}`
                  : `:${fmtValueCn(event.kind === 'trait_removed' ? event.before : event.after)}`}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
