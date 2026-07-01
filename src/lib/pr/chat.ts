import { desc, eq } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { agentRuns, conversationMessages, conversationThreads } from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'

import { listContextMemories } from './memory'
import { retrieveKnowledge } from './rag'

function serialize(value: unknown) {
  return JSON.stringify(value)
}

function titleFromMessage(message: string) {
  return message.trim().slice(0, 36) || 'PR 对话'
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

  await db.insert(conversationMessages).values({
    id: generateId('msg'),
    threadId,
    runId,
    role: 'user',
    content: input.message,
  })

  const [memoryItems, knowledge, recentMessages] = await Promise.all([
    listContextMemories(6),
    retrieveKnowledge(input.message, 3),
    db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(6),
  ])

  const answer = [
    '我先按现在已有事实来答。',
    memoryItems.length
      ? `我会参考这些长期上下文：${memoryItems.slice(0, 3).map(memory => memory.content).join('；')}。`
      : '目前可用的长期记忆还少，所以不会硬套偏好。',
    knowledge.length
      ? `训练知识库里有相关依据：${knowledge[0].content.slice(0, 160)}${knowledge[0].content.length > 160 ? '...' : ''}`
      : '这次没有命中训练知识库，因此建议只按活动事实和保守训练原则来给。',
    '如果这是训练安排问题，优先把恢复、最近负荷和目标日期放在第一位；如果身体有明确疼痛或异常，先降强度，不做医学判断。',
  ].join('\n\n')

  await db.insert(conversationMessages).values({
    id: generateId('msg'),
    threadId,
    runId,
    role: 'assistant',
    content: answer,
    memoryRefsJson: serialize(memoryItems.map(memory => memory.id)),
    contextJson: serialize({
      memoryItems,
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
      model: 'rule-based-chat-v1',
      lastStep: 'persist_output',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentRuns.id, runId))

  return { threadId, runId, answer }
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
