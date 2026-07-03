import { desc, eq } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { agentRuns, conversationMessages, conversationThreads } from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'

import { getLatestHealthDailyMetrics } from './health'
import { applyMemoryPatch, extractMemoryPatchesFromText, listContextMemories } from './memory'
import { callPrModel } from './model'
import {
  buildChatSystemPrompt,
  buildChatUserPrompt,
  buildRuleBasedChatReply,
} from './prompts'
import { retrieveKnowledge } from './rag'

function serialize(value: unknown) {
  return JSON.stringify(value)
}

function titleFromMessage(message: string) {
  return message.trim().slice(0, 36) || 'PR 对话'
}

/**
 * Latest thread updated within `withinMs` (default 24h), else null.
 * Reason: WeChat has no per-message thread id; for this single-user companion we keep
 * a rolling conversation so multi-turn context carries across messages, but start fresh
 * after a long gap so an old topic doesn't bleed into a new one.
 */
export async function getRecentThreadId(withinMs = 24 * 60 * 60 * 1000): Promise<string | null> {
  const db = await getActivitiesDb()
  const [row] = await db
    .select()
    .from(conversationThreads)
    .orderBy(desc(conversationThreads.lastMessageAt))
    .limit(1)
  if (!row?.lastMessageAt) return null
  return Date.now() - row.lastMessageAt.getTime() <= withinMs ? row.id : null
}

export async function chatWithPr(input: { message: string; threadId?: string | null }) {
  const db = await getActivitiesDb()
  const now = new Date()
  let threadId = input.threadId ?? null

  if (!threadId) {
    threadId = generateId('thread')
    await db.insert(conversationThreads).values({
      id: threadId,
      title: titleFromMessage(input.message),
      lastMessageAt: now,
    })
  } else {
    await db
      .update(conversationThreads)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(conversationThreads.id, threadId))
  }

  const runId = generateId('run')
  await db.insert(agentRuns).values({
    id: runId,
    idempotencyKey: `chat:${threadId}:${Date.now().toString(36)}`,
    trigger: 'user_question',
    subjectType: 'conversation',
    subjectId: threadId,
    status: 'running',
    builderVersion: 'pr-chat-v1',
    attempts: 1,
    lastStep: 'build_context',
    startedAt: now,
  })

  const userMessageId = generateId('msg')
  await db.insert(conversationMessages).values({
    id: userMessageId,
    threadId,
    runId,
    role: 'user',
    content: input.message,
  })

  const memoryPatches = extractMemoryPatchesFromText({
    source: 'conversation_message',
    refId: userMessageId,
    text: input.message,
  })
  const learnedMemoryIds: string[] = []
  for (const [index, patch] of memoryPatches.entries()) {
    learnedMemoryIds.push(
      await applyMemoryPatch(patch, {
        actor: 'user',
        idempotencyKey: `chat:${userMessageId}:memory:${index}`,
        runId,
      }),
    )
  }

  const [memoryItems, knowledge, recentMessages, recentHealth] = await Promise.all([
    listContextMemories(6),
    retrieveKnowledge(input.message, 3),
    db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(6),
    getLatestHealthDailyMetrics(1).catch(() => []),
  ])

  // 历史(不含刚插入的这条),按时间正序;新消息单独作为"刚发来"传给模型。
  const history = recentMessages
    .filter(message => message.id !== userMessageId)
    .reverse()
    .map(message => ({ role: message.role, content: message.content }))
  const h = recentHealth[0]
  const healthLine = h
    ? `- ${h.date}：睡 ${h.sleepMinutes ?? '-'} 分、静息心率 ${h.restingHr ?? '-'}、HRV ${h.hrv ?? '-'}、步数 ${h.steps ?? '-'}、恢复 ${h.recoveryLabel}`
    : null

  let answer: string
  let model = 'rule-based-chat-v1'
  let provider = 'local-rule'
  try {
    const generated = await callPrModel(
      buildChatSystemPrompt(),
      buildChatUserPrompt({
        message: input.message,
        recentMessages: history,
        memories: memoryItems.map(memory => memory.content),
        knowledge: knowledge.map(item => item.content.slice(0, 220)),
        health: healthLine,
      }),
      { maxTokens: 500 },
    )
    const trimmed = generated.content.trim()
    if (trimmed.length >= 2) {
      answer = trimmed
      model = generated.model
      provider = generated.provider
    } else {
      answer = buildRuleBasedChatReply()
    }
  } catch (error) {
    console.warn('[pr-chat] AI 生成失败，回退兜底:', (error as Error).message)
    answer = buildRuleBasedChatReply()
  }

  await db.insert(conversationMessages).values({
    id: generateId('msg'),
    threadId,
    runId,
    role: 'assistant',
    content: answer,
    memoryRefsJson: serialize(memoryItems.map(memory => memory.id)),
    contextJson: serialize({
      memoryItems,
      learnedMemoryIds,
      knowledge,
      recentMessages: recentMessages.map(message => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
    }),
  })

  await db
    .update(agentRuns)
    .set({
      status: 'succeeded',
      model,
      lastStep: 'persist_output',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentRuns.id, runId))

  return { threadId, runId, answer, model, provider, learnedMemoryIds }
}

export async function listConversationMessages(threadId: string, limit = 30) {
  const db = await getActivitiesDb()
  const rows = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.threadId, threadId))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(limit)

  return rows.map(row => ({
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }))
}
