import { and, desc, eq, inArray } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { friendProfile, memoryEvents, memoryItems } from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'
import { getLatestHealthDailyMetrics } from './health'
import { callPrModel } from './model'
import { buildMemoryCurationSystemPrompt, buildMemoryCurationUserPrompt } from './prompts'
import { getRaceGoalContext } from './race-goals'
import type { TrainingHabitSignal } from './context'

// 一条记忆晋升为 active 需要的独立证据条数(否则默认 candidate,只靠确认或多证据晋升)。
const EVIDENCE_PROMOTION_THRESHOLD = 3

export type MemoryItemType =
  | 'preference'
  | 'goal'
  | 'injury'
  | 'habit'
  | 'relationship_note'
  | 'correction'
  | 'risk_pattern'

export interface MemoryEvidence {
  source: string
  refId?: string
  quote?: string
  createdAt: string
}

export interface MemoryContext {
  id: string
  type: MemoryItemType
  status: string
  content: string
  confidence: number
  evidence: MemoryEvidence[]
  version: number
  lastSeenAt: string
}

export interface MemoryPatch {
  action: 'create' | 'confirm' | 'update' | 'decay' | 'archive'
  memoryId?: string
  type: MemoryItemType
  content: string
  evidence: MemoryEvidence[]
  confidence: number
  reason: string
}

export interface MemoryUpdateInput {
  type?: MemoryItemType
  content?: string
  evidence?: MemoryEvidence[]
  confidence?: number
  status?: 'candidate' | 'active' | 'decayed' | 'archived'
  reason: string
}

const MEMORY_TYPES = new Set<MemoryItemType>([
  'preference',
  'goal',
  'injury',
  'habit',
  'relationship_note',
  'correction',
  'risk_pattern',
])

function normalizeMemoryContent(content: string) {
  return content.trim().replace(/\s+/g, ' ').toLowerCase()
}

function mergeEvidence(existing: MemoryEvidence[], next: MemoryEvidence[]) {
  const seen = new Set<string>()
  const merged: MemoryEvidence[] = []
  for (const item of [...existing, ...next]) {
    const key = [item.source, item.refId ?? '', item.quote ?? ''].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged.slice(-12)
}

function parseEvidence(value: string): MemoryEvidence[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizeType(type: string): MemoryItemType {
  return MEMORY_TYPES.has(type as MemoryItemType) ? (type as MemoryItemType) : 'relationship_note'
}

function rowToMemory(row: typeof memoryItems.$inferSelect): MemoryContext {
  return {
    id: row.id,
    type: normalizeType(row.type),
    status: row.status,
    content: row.content,
    confidence: Number(row.confidence ?? 0),
    evidence: parseEvidence(row.evidenceJson),
    version: Number(row.version ?? 1),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }
}

/** 独立证据条数(按 source|refId|quote 去重),用于多证据晋升判定。 */
function distinctEvidenceCount(evidence: MemoryEvidence[]) {
  return new Set(evidence.map(item => [item.source, item.refId ?? '', item.quote ?? ''].join('|'))).size
}

function clampConfidence(value: number) {
  return Number.isFinite(value) ? Math.min(0.95, Math.max(0.1, value)) : 0.5
}

/** 从模型输出里稳健地取出 JSON(容忍 ```json 包裹或前后杂字)。 */
function parseCurationJson(text: string): { memories?: unknown } {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  return JSON.parse(slice)
}

/**
 * MemoryCurator(LLM 蒸馏 + 结构化判断)。把一段用户文字交给模型判断有没有值得长期
 * 记住的、关于用户的持久事实,并蒸馏成干净的原子记忆候选(type/durable/confidence)。
 *
 * 替代原来的关键词正则:不再把瞬时状态/疑问句/原话直接落库(那是之前脏记忆的根因)。
 * 失败或无产出时返回 [](不回退正则),记忆非实时,可后续再学。所有产出都是 create 候选,
 * 是否晋升为 active 交给 applyMemoryPatch 的证据阈值或用户确认。
 */
export async function curateMemoryPatches(input: {
  source: string
  refId: string
  text?: string | null
  context?: string | null
  createdAt?: string
}): Promise<MemoryPatch[]> {
  const raw = input.text?.trim()
  if (!raw) return []

  let parsed: { memories?: unknown }
  try {
    const generated = await callPrModel(
      buildMemoryCurationSystemPrompt(),
      buildMemoryCurationUserPrompt(raw, input.source, input.context),
      { maxTokens: 500 },
    )
    parsed = parseCurationJson(generated.content)
  } catch (error) {
    console.warn('[memory-curator] LLM 蒸馏失败，跳过本次(不回退正则):', (error as Error).message)
    return []
  }

  const items = Array.isArray(parsed?.memories) ? (parsed.memories as Array<Record<string, unknown>>) : []
  const createdAt = input.createdAt ?? new Date().toISOString()
  const patches: MemoryPatch[] = []
  for (const item of items.slice(0, 3)) {
    const content = typeof item?.content === 'string' ? item.content.trim() : ''
    // durable 必须显式为 true;拿不准的不记。
    if (!content || item?.durable !== true) continue
    const type = normalizeType(String(item?.type ?? 'relationship_note'))
    patches.push({
      action: 'create',
      type,
      content: content.length > 140 ? `${content.slice(0, 139)}…` : content,
      evidence: [{ source: input.source, refId: input.refId, quote: raw.slice(0, 180), createdAt }],
      confidence: clampConfidence(Number(item?.confidence)),
      reason:
        typeof item?.reason === 'string' && item.reason.trim()
          ? item.reason.trim()
          : 'MemoryCurator 蒸馏出的候选记忆，等待用户确认或多证据晋升。',
    })
  }
  return patches
}

export async function curateMemoryFromFeedback(input: {
  feedbackId: string
  activityId: string
  note?: string | null
  pain?: unknown
}): Promise<MemoryPatch[]> {
  const createdAt = new Date().toISOString()
  const patches = await curateMemoryPatches({
    source: 'subjective_feedback',
    refId: input.feedbackId,
    text: input.note,
    createdAt,
  })

  if (input.pain) {
    patches.push({
      action: 'create',
      type: 'injury',
      content: `用户反馈本次活动存在不适: ${JSON.stringify(input.pain)}`,
      evidence: [{ source: 'subjective_feedback', refId: input.feedbackId, createdAt }],
      confidence: 0.45,
      reason: '疼痛反馈属于敏感信息，只作为候选观察，等待多证据或用户确认。',
    })
  }

  return patches
}

export function buildMemoryPatchesFromHabitSignals(input: {
  runId: string
  activityId: string
  signals: TrainingHabitSignal[]
}) {
  return input.signals
    .filter(signal => signal.confidence >= 0.7)
    .map((signal): MemoryPatch => ({
      action: 'create',
      type: signal.type === 'recovery_risk' ? 'risk_pattern' : 'habit',
      content: signal.content,
      evidence: signal.evidence.map(item => ({
        source: item.source,
        refId: item.refId ?? input.activityId,
        quote: item.quote,
        createdAt: item.createdAt,
      })),
      confidence: signal.confidence,
      reason: `从本次 PR 上下文抽取到「${signal.label}」信号，先沉淀为候选记忆，等待后续事实或用户确认。`,
    }))
}

export async function applyMemoryPatch(
  patch: MemoryPatch,
  options: { actor: 'user' | 'agent'; idempotencyKey: string; runId?: string | null },
) {
  const db = await getActivitiesDb()
  const existingEventRows = await db
    .select()
    .from(memoryEvents)
    .where(eq(memoryEvents.idempotencyKey, options.idempotencyKey))
    .limit(1)
  if (existingEventRows[0]?.memoryId) return existingEventRows[0].memoryId

  if (patch.action !== 'create' && !patch.memoryId) {
    throw new Error('memoryId is required for non-create memory patch')
  }

  if (patch.action === 'create') {
    const normalizedContent = normalizeMemoryContent(patch.content)
    const similarRows = await db
      .select()
      .from(memoryItems)
      .where(and(eq(memoryItems.type, patch.type), inArray(memoryItems.status, ['candidate', 'active', 'decayed'])))
      .limit(100)
    const similar = similarRows.find(row => normalizeMemoryContent(row.content) === normalizedContent)

    if (similar) {
      const nextVersion = similar.version + 1
      const nextEvidence = mergeEvidence(parseEvidence(similar.evidenceJson), patch.evidence)
      // 多证据晋升:已 active 保持 active;否则累计独立证据够阈值才晋升;decayed 遇新证据先回 candidate。
      const nextStatus =
        similar.status === 'active'
          ? 'active'
          : distinctEvidenceCount(nextEvidence) >= EVIDENCE_PROMOTION_THRESHOLD
            ? 'active'
            : similar.status === 'decayed'
              ? 'candidate'
              : similar.status
      const nextConfidence = Math.max(Number(similar.confidence ?? 0), patch.confidence)
      await db
        .update(memoryItems)
        .set({
          evidenceJson: JSON.stringify(nextEvidence),
          confidence: nextConfidence,
          status: nextStatus,
          version: nextVersion,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(memoryItems.id, similar.id))
      await db
        .insert(memoryEvents)
        .values({
          id: generateId('mevt'),
          memoryId: similar.id,
          runId: options.runId ?? null,
          idempotencyKey: options.idempotencyKey,
          action: 'update',
          status: 'applied',
          patchJson: JSON.stringify({ ...patch, action: 'update', deduplicatedFrom: 'create' }),
          actor: options.actor,
          expectedVersion: similar.version,
          resultingVersion: nextVersion,
          reason: `${patch.reason} 已合并到同内容记忆，避免重复候选。`,
        })
        .onConflictDoNothing()
      await projectFriendProfile()
      return similar.id
    }

    const memoryId = generateId('mem')
    await db.insert(memoryItems).values({
      id: memoryId,
      type: patch.type,
      // 新记忆一律先落 candidate;只有自带足够独立证据(如多样本习惯信号)才直接 active。
      // 单条聊天/反馈只有 1 条证据 → candidate,晋升靠用户确认或后续多证据累计。
      status: distinctEvidenceCount(patch.evidence) >= EVIDENCE_PROMOTION_THRESHOLD ? 'active' : 'candidate',
      content: patch.content,
      evidenceJson: JSON.stringify(patch.evidence),
      confidence: patch.confidence,
      source: options.actor,
    })
    await db
      .insert(memoryEvents)
      .values({
        id: generateId('mevt'),
        memoryId,
        runId: options.runId ?? null,
        idempotencyKey: options.idempotencyKey,
        action: patch.action,
        status: 'applied',
        patchJson: JSON.stringify(patch),
        actor: options.actor,
        resultingVersion: 1,
        reason: patch.reason,
      })
      .onConflictDoNothing()
    await projectFriendProfile()
    return memoryId
  }

  const rows = await db.select().from(memoryItems).where(eq(memoryItems.id, patch.memoryId!)).limit(1)
  const existing = rows[0]
  if (!existing) throw new Error('Memory not found')

  const nextStatus =
    patch.action === 'confirm'
      ? 'active'
      : patch.action === 'archive'
        ? 'archived'
        : patch.action === 'decay'
          ? 'decayed'
          : existing.status
  const nextVersion = existing.version + 1
  await db
    .update(memoryItems)
    .set({
      type: patch.type,
      content: patch.content,
      evidenceJson: JSON.stringify(patch.evidence),
      confidence: patch.confidence,
      status: nextStatus,
      version: nextVersion,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(memoryItems.id, existing.id))

  await db
    .insert(memoryEvents)
    .values({
      id: generateId('mevt'),
      memoryId: existing.id,
      runId: options.runId ?? null,
      idempotencyKey: options.idempotencyKey,
      action: patch.action,
      status: 'applied',
      patchJson: JSON.stringify(patch),
      actor: options.actor,
      expectedVersion: existing.version,
      resultingVersion: nextVersion,
      reason: patch.reason,
    })
    .onConflictDoNothing()
  await projectFriendProfile()
  return existing.id
}

export async function listMemories(statuses: string[] = ['candidate', 'active'], limit = 50) {
  const db = await getActivitiesDb()
  const rows = await db
    .select()
    .from(memoryItems)
    .where(inArray(memoryItems.status, statuses))
    .orderBy(desc(memoryItems.lastSeenAt))
    .limit(limit)

  return rows.map(rowToMemory)
}

export async function listContextMemories(limit = 8) {
  const db = await getActivitiesDb()
  const rows = await db
    .select()
    .from(memoryItems)
    .where(and(inArray(memoryItems.status, ['active']), inArray(memoryItems.type, ['correction', 'goal', 'injury', 'habit', 'preference', 'relationship_note', 'risk_pattern'])))
    .orderBy(desc(memoryItems.lastSeenAt))
    .limit(limit)

  return rows.map(rowToMemory)
}

export async function confirmMemory(memoryId: string) {
  const rows = await listMemories(['candidate', 'confirmed', 'active'], 100)
  const memory = rows.find(item => item.id === memoryId)
  if (!memory) return null
  await applyMemoryPatch(
    {
      action: 'confirm',
      memoryId,
      type: memory.type,
      content: memory.content,
      evidence: memory.evidence,
      confidence: Math.max(memory.confidence, 0.8),
      reason: '用户确认候选记忆。',
    },
    { actor: 'user', idempotencyKey: `confirm:${memoryId}:${Date.now()}` },
  )
  return memoryId
}

export async function archiveMemory(memoryId: string) {
  const rows = await listMemories(['candidate', 'active', 'decayed'], 100)
  const memory = rows.find(item => item.id === memoryId)
  if (!memory) return null
  await applyMemoryPatch(
    {
      action: 'archive',
      memoryId,
      type: memory.type,
      content: memory.content,
      evidence: memory.evidence,
      confidence: memory.confidence,
      reason: '用户归档记忆。',
    },
    { actor: 'user', idempotencyKey: `archive:${memoryId}:${Date.now()}` },
  )
  return memoryId
}

export async function updateMemory(
  memoryId: string,
  input: MemoryUpdateInput,
  options: { actor: 'user' | 'agent'; idempotencyKey: string; runId?: string | null },
) {
  const db = await getActivitiesDb()
  const rows = await db.select().from(memoryItems).where(eq(memoryItems.id, memoryId)).limit(1)
  const existing = rows[0]
  if (!existing) return null

  const nextVersion = existing.version + 1
  await db
    .update(memoryItems)
    .set({
      type: input.type ?? normalizeType(existing.type),
      content: input.content ?? existing.content,
      evidenceJson: JSON.stringify(input.evidence ?? parseEvidence(existing.evidenceJson)),
      confidence: input.confidence ?? Number(existing.confidence ?? 0),
      status: input.status ?? existing.status,
      version: nextVersion,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(memoryItems.id, existing.id))

  await db
    .insert(memoryEvents)
    .values({
      id: generateId('mevt'),
      memoryId: existing.id,
      runId: options.runId ?? null,
      idempotencyKey: options.idempotencyKey,
      action: 'update',
      status: 'applied',
      patchJson: JSON.stringify(input),
      actor: options.actor,
      expectedVersion: existing.version,
      resultingVersion: nextVersion,
      reason: input.reason,
    })
    .onConflictDoNothing()
  await projectFriendProfile()
  return existing.id
}

export async function getFriendProfile() {
  const db = await getActivitiesDb()
  const rows = await db.select().from(friendProfile).limit(1)
  const profile = rows[0]
  if (!profile) return null

  return {
    id: profile.id,
    displayName: profile.displayName,
    companionStyleJson: profile.companionStyleJson,
    activeGoalsJson: profile.activeGoalsJson,
    trainingPreferencesJson: profile.trainingPreferencesJson,
    injuryWatchlistJson: profile.injuryWatchlistJson,
    recentStateJson: profile.recentStateJson,
    doNotAssumeJson: profile.doNotAssumeJson,
    projectionVersion: profile.projectionVersion,
    sourceDiaryId: profile.sourceDiaryId,
    updatedAt: profile.updatedAt.toISOString(),
  }
}

export async function projectFriendProfile() {
  const active = await listMemories(['active'], 100)
  const injuryWatchlist = active.filter(memory => memory.type === 'injury')
  // 例外(doc:correction 永远进入上下文,防止重复犯错):纠错类记忆在 candidate 阶段也投影进
  // doNotAssume,不必等晋升 active。其余类型仍只取 active。经 LLM MemoryCurator 把关,
  // 不再会有"要不要"这类子串误判的假纠错混入。
  const candidateCorrections = (await listMemories(['candidate'], 200)).filter(
    memory => memory.type === 'correction',
  )
  const doNotAssumeContents = Array.from(
    new Set(
      [...active.filter(memory => memory.type === 'correction'), ...candidateCorrections].map(
        memory => memory.content,
      ),
    ),
  )
  const preferences = active.filter(memory => memory.type === 'preference' || memory.type === 'relationship_note')
  const goals = active.filter(memory => memory.type === 'goal')
  const habits = active.filter(memory => memory.type === 'habit' || memory.type === 'risk_pattern')
  const activeRaceGoals = await getRaceGoalContext(3)
  const healthMetrics = await getLatestHealthDailyMetrics(3)
  const recentState = {
    latestHealth: healthMetrics[0] ?? null,
    activeRaceGoals,
  }

  const db = await getActivitiesDb()
  await db
    .insert(friendProfile)
    .values({
      id: 'default',
      companionStyleJson: JSON.stringify(preferences.map(memory => memory.content)),
      activeGoalsJson: JSON.stringify([
        ...goals.map(memory => memory.content),
        ...activeRaceGoals.map(goal => `${goal.name}（${goal.daysUntilRace} 天后）`),
      ]),
      trainingPreferencesJson: JSON.stringify(habits.map(memory => memory.content)),
      injuryWatchlistJson: JSON.stringify(injuryWatchlist.map(memory => memory.content)),
      recentStateJson: JSON.stringify(recentState),
      doNotAssumeJson: JSON.stringify(doNotAssumeContents),
      projectionVersion: 1,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: friendProfile.id,
      set: {
        companionStyleJson: JSON.stringify(preferences.map(memory => memory.content)),
        activeGoalsJson: JSON.stringify([
          ...goals.map(memory => memory.content),
          ...activeRaceGoals.map(goal => `${goal.name}（${goal.daysUntilRace} 天后）`),
        ]),
        trainingPreferencesJson: JSON.stringify(habits.map(memory => memory.content)),
        injuryWatchlistJson: JSON.stringify(injuryWatchlist.map(memory => memory.content)),
        recentStateJson: JSON.stringify(recentState),
        doNotAssumeJson: JSON.stringify(doNotAssumeContents),
        updatedAt: new Date(),
      },
    })
}
