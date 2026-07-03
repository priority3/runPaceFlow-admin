import { and, desc, eq, inArray } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { friendProfile, memoryEvents, memoryItems } from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'
import { getLatestHealthDailyMetrics } from './health'
import { getRaceGoalContext } from './race-goals'
import type { TrainingHabitSignal } from './context'

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

function classifyFeedbackNote(note: string): MemoryItemType {
  if (/(别再|不要|纠正|其实|不是|别把|别说|别默认)/.test(note)) return 'correction'
  if (/(目标|比赛|破|PB|pb|马拉松|半马|全马|10k|5k)/.test(note)) return 'goal'
  if (/(喜欢|偏好|希望|提醒|建议|语气|直接|温和|鼓励|调侃)/.test(note)) return 'preference'
  if (/(通常|经常|习惯|一般|固定|早上|晚上|夜跑|晨跑|路线|补给)/.test(note)) return 'habit'
  return 'relationship_note'
}

export function extractMemoryPatchesFromText(input: {
  source: string
  refId: string
  text?: string | null
  createdAt?: string
}): MemoryPatch[] {
  const raw = input.text?.trim()
  if (!raw) return []

  if (!/(喜欢|偏好|希望|以后|提醒|建议|语气|直接|温和|鼓励|调侃|别再|不要|纠正|其实|不是|别把|别说|别默认|通常|经常|习惯|一般|固定|早上|晚上|夜跑|晨跑|路线|补给|目标|比赛|PB|pb|马拉松|半马|全马|10k|5k)/.test(raw)) {
    return []
  }

  // One patch per note (single primary type) to avoid storing the same sentence as
  // multiple candidates; cap content so a long/rambling message doesn't dump a
  // paragraph into the memory store.
  const content = raw.length > 140 ? `${raw.slice(0, 139)}…` : raw
  const type = classifyFeedbackNote(raw)
  return [{
    action: 'create' as const,
    type,
    content,
    evidence: [{
      source: input.source,
      refId: input.refId,
      quote: content,
      createdAt: input.createdAt ?? new Date().toISOString(),
    }],
    confidence: type === 'correction' ? 0.82 : 0.62,
    reason: '用户明确表达了偏好、习惯、目标或纠正，作为可审核记忆进入长期学习队列。',
  }]
}

export function extractMemoryPatchesFromFeedback(input: {
  feedbackId: string
  activityId: string
  note?: string | null
  pain?: unknown
}) {
  const patches: MemoryPatch[] = []
  const createdAt = new Date().toISOString()
  const note = input.note?.trim()

  patches.push(...extractMemoryPatchesFromText({
    source: 'subjective_feedback',
    refId: input.feedbackId,
    text: note,
    createdAt,
  }))

  if (input.pain) {
    patches.push({
      action: 'create',
      type: 'injury',
      content: `用户反馈本次活动存在不适: ${JSON.stringify(input.pain)}`,
      evidence: [{ source: 'subjective_feedback', refId: input.feedbackId, createdAt }],
      confidence: 0.45,
      reason: '疼痛反馈属于敏感信息，只作为候选观察，不直接进入长期画像。',
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
      const nextStatus =
        similar.status === 'decayed'
          ? 'candidate'
          : patch.type === 'correction' && patch.confidence >= 0.8
            ? 'active'
            : similar.status
      const nextEvidence = mergeEvidence(parseEvidence(similar.evidenceJson), patch.evidence)
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
      status:
        (options.actor === 'user' || patch.confidence >= 0.8) && patch.type === 'correction'
          ? 'active'
          : 'candidate',
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
  const doNotAssume = active.filter(memory => memory.type === 'correction')
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
      doNotAssumeJson: JSON.stringify(doNotAssume.map(memory => memory.content)),
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
        doNotAssumeJson: JSON.stringify(doNotAssume.map(memory => memory.content)),
        updatedAt: new Date(),
      },
    })
}
