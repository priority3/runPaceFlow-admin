/**
 * 数字分身面板的类型契约与纯展示 helper(无状态、无副作用)。
 * 从 PersonaPanel 抽出以守住单文件 500 行约束;类型对应 pr-agent 的 persona.v1 payload。
 */
import type React from 'react'

export interface PersonaTrait {
  key: string
  value: unknown
  confidence: number
  source: { kind: string; refId?: string }
}
export interface PersonaTag {
  id: string
  type: string
  label: string
  content: string
  confidence: number
}
export interface PersonaPayload {
  traits: PersonaTrait[]
  renderManifest: {
    user: { model: string; scale: number; expression: 'neutral' | 'happy' | 'tired'; props: string[] }
    companion: { sprite: 'happy' | 'worried' | 'cheering' | 'neutral'; bubble: string | null }
    tags: PersonaTag[]
  }
  updatedAt: string
}
/** 实时状态(P3,pr-agent 已做词表映射;enabled=false 表示上游未配置,整条隐藏)。 */
export interface PersonaLive {
  enabled: boolean
  online: boolean
  doing: string | null
  app: string | null
  listening: string | null
}

/** 模型变体 → 静态资源;变体文件缺失时加载侧回落 base。 */
export const MODEL_FILES: Record<string, string> = {
  base: '/persona/avatar-c.vrm',
  'body-slim': '/persona/avatar-c-slim.vrm',
  'body-strong': '/persona/avatar-c-strong.vrm',
}

export const TAG_TYPE_CLASS: Record<string, string> = {
  injury: 'border-amber-300 bg-amber-50 text-amber-800',
  correction: 'border-rose-300 bg-rose-50 text-rose-800',
  goal: 'border-sky-300 bg-sky-50 text-sky-800',
  habit: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  risk_pattern: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  preference: 'border-violet-300 bg-violet-50 text-violet-800',
  relationship_note: 'border-violet-300 bg-violet-50 text-violet-800',
}
export const TAG_TYPE_LABEL: Record<string, string> = {
  injury: '伤病',
  correction: '纠正',
  goal: '目标',
  habit: '习惯',
  risk_pattern: '风险',
  preference: '偏好',
  relationship_note: '关系',
}

/** 气泡槽位:左右交替、错落分布,最多 10 个(与投影端 tags 上限一致)。 */
export const TAG_SLOTS: Array<React.CSSProperties> = [
  { top: '6%', left: '2%' },
  { top: '12%', right: '2%' },
  { top: '28%', left: '1%' },
  { top: '34%', right: '1%' },
  { top: '50%', left: '2%' },
  { top: '56%', right: '2%' },
  { top: '70%', left: '4%' },
  { top: '74%', right: '4%' },
  { top: '86%', left: '8%' },
  { top: '88%', right: '8%' },
]

export function traitValue(traits: PersonaTrait[], key: string): unknown {
  return traits.find(t => t.key === key)?.value
}

/** 第一条赛事目标名(号码布道具的文案);无目标返回 null。 */
export function raceGoalName(traits: PersonaTrait[]): string | null {
  const goal = traits.find(t => t.key.startsWith('goal.race.'))?.value as { name?: string } | undefined
  return goal?.name ?? null
}

/** 底部身体档案 chips:只显示已有的特征,缺省不占位。 */
export function buildChips(traits: PersonaTrait[]): string[] {
  const chips: string[] = []
  const height = Number(traitValue(traits, 'body.height_cm'))
  if (Number.isFinite(height) && height > 0) chips.push(`身高 ${height}cm`)
  const weight = Number(traitValue(traits, 'body.weight_kg'))
  if (Number.isFinite(weight) && weight > 0) chips.push(`体重 ${weight}kg`)
  const build = String(traitValue(traits, 'body.build') ?? '')
  if (build) chips.push(`体型 ${{ slim: '偏瘦', standard: '标准', strong: '健壮' }[build] ?? build}`)
  const recovery = String(traitValue(traits, 'state.recovery') ?? '')
  if (recovery) chips.push(`恢复 ${{ good: '良好', okay: '一般', poor: '偏差' }[recovery] ?? recovery}`)
  const load = String(traitValue(traits, 'state.training_load') ?? '')
  if (load) chips.push(`训练 ${{ idle: '休整中', recovering: '恢复中', steady: '稳定', high: '高负荷' }[load] ?? load}`)
  return chips
}
