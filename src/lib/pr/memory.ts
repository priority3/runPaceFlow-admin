import { and, desc, eq, inArray } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { friendProfile, memoryEvents, memoryItems } from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'
import { getLatestHealthDailyMetrics } from './health'
import { getRaceGoalContext } from './race-goals'

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

export function extractMemoryPatchesFromFeedback(input: {
  feedbackId: string
  activityId: string
  note?: string | null
  pain?: unknown
}) {
  const patches: MemoryPatch[] = []
  const createdAt = new Date().toISOString()
  const note = input.note?.trim()

  if (note && /(喜欢|偏好|希望|以后|提醒|别再|不要|纠正|其实)/.test(note)) {
    patches.push({
      action: 'create',
      type: /(别再|不要|纠正|其实)/.test(note) ? 'correction' : 'relationship_note',
      content: note,
      evidence: [{ source: 'subjective_feedback', refId: input.feedbackId, quote: note, createdAt }],
      confidence: 0.55,
      reason: '用户在活动反馈里表达了偏好或纠正，先作为候选记忆待确认。',
    })
  }

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

export async function applyMemoryPatch(
  patch: MemoryPatch,
  options: { actor: 'user' | 'agent'; idempotencyKey: string; runId?: string | null },
) {
  const db = await getActivitiesDb()

  if (patch.action !== 'create' && !patch.memoryId) {
    throw new Error('memoryId is required for non-create memory patch')
  }

  if (patch.action === 'create') {
    const memoryId = generateId('mem')
    await db.insert(memoryItems).values({
      id: memoryId,
      type: patch.type,
      status: options.actor === 'user' && patch.type === 'correction' ? 'active' : 'candidate',
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
    .where(and(inArray(memoryItems.status, ['active']), inArray(memoryItems.type, ['correction', 'goal', 'injury', 'habit', 'preference', 'relationship_note'])))
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
        injuryWatchlistJson: JSON.stringify(injuryWatchlist.map(memory => memory.content)),
        recentStateJson: JSON.stringify(recentState),
        doNotAssumeJson: JSON.stringify(doNotAssume.map(memory => memory.content)),
        updatedAt: new Date(),
      },
    })
}
