import { desc, eq, sql } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import {
  agentRuns,
  agentStateSnapshots,
  conversationMessages,
  conversationThreads,
} from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'

import { buildCompanionProfileContext, getLatestActivityPerType, getRecentActivityContext } from './context'
import { evaluateChatReply, type ChatEvalContext } from './evaluator'
import { getLatestHealthDailyMetrics } from './health'
import { applyMemoryPatch, curateMemoryPatches, listContextMemories } from './memory'
import { callPrModel, parseModelJson } from './model'
import {
  buildChatSystemPrompt,
  buildChatUserPrompt,
  buildRuleBasedChatReply,
  buildThreadSummarySystemPrompt,
  buildThreadSummaryUserPrompt,
} from './prompts'
import { getRaceGoalContext } from './race-goals'
import { retrieveKnowledge } from './rag'
import { executePrChatTool, PR_CHAT_TOOLS } from './tools'
import { readImageUpload, uploadNameFromUrl } from './uploads'

type ChatImage = { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }

const PR_CHAT_BUILDER_VERSION = 'pr-chat-v2'

function serialize(value: unknown) {
  return JSON.stringify(value)
}

function titleFromMessage(message: string) {
  return message.trim().slice(0, 36) || 'PR 对话'
}

async function writeSnapshot(runId: string, step: string, state: unknown) {
  const db = await getActivitiesDb()
  await db.insert(agentStateSnapshots).values({
    id: generateId('snap'),
    runId,
    step,
    stateJson: serialize(state),
  })
}

/**
 * MemoryCurator 后台任务:把本轮用户消息交给 LLM 蒸馏成候选记忆并落库。
 * 独立于回复路径运行(见 chatWithPr 里的 void 调用),失败只记日志、不影响对话。
 */
async function curateChatMemoryInBackground(
  runId: string,
  userMessageId: string,
  message: string,
  history: Array<{ role: string; content: string }>,
) {
  const context = history.length
    ? history.map(turn => `${turn.role === 'assistant' ? 'PR' : '用户'}：${turn.content}`).join('\n')
    : null
  const patches = await curateMemoryPatches({
    source: 'conversation_message',
    refId: userMessageId,
    text: message,
    context,
  })
  const learnedMemoryIds: string[] = []
  for (const [index, patch] of patches.entries()) {
    try {
      learnedMemoryIds.push(
        await applyMemoryPatch(patch, {
          actor: 'user',
          idempotencyKey: `chat:${userMessageId}:memory:${index}`,
          runId,
        }),
      )
    } catch (error) {
      console.warn('[pr-chat] 记忆写入失败:', (error as Error).message)
    }
  }
  await writeSnapshot(runId, 'curate_memory', { learnedMemoryIds, patchCount: patches.length })
}

const THREAD_SUMMARY_REFRESH_EVERY = 10

/**
 * 会话标题/摘要后台任务:首轮结束后生成一次,之后每 5 轮(10 条消息)随话题漂移刷新,
 * 写回 conversation_threads.title/summary。失败只记日志——列表兜底显示首句截断标题。
 */
async function refreshThreadSummaryInBackground(runId: string, threadId: string) {
  const db = await getActivitiesDb()
  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(conversationMessages)
    .where(eq(conversationMessages.threadId, threadId))
  const total = Number(countRow?.total ?? 0)
  // Reason: 每条消息都调 LLM 太贵;首轮(2 条)先给准确标题,其后仅在整刷新周期时重算。
  if (total !== 2 && (total === 0 || total % THREAD_SUMMARY_REFRESH_EVERY !== 0)) return

  const rows = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.threadId, threadId))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(12)
  const transcript = rows
    .reverse()
    .map(message => `${message.role === 'assistant' ? 'PR' : '用户'}：${message.content.slice(0, 160)}`)
    .join('\n')
  if (!transcript) return

  const generated = await callPrModel(
    buildThreadSummarySystemPrompt(),
    buildThreadSummaryUserPrompt(transcript),
    { maxTokens: 160 },
  )
  const parsed = parseModelJson(generated.content) as { title?: unknown; summary?: unknown }
  const title = typeof parsed.title === 'string' ? parsed.title.trim().replace(/["「」『』]/g, '').slice(0, 16) : ''
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 60) : ''
  if (!title && !summary) return

  await db
    .update(conversationThreads)
    .set({
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
      updatedAt: new Date(),
    })
    .where(eq(conversationThreads.id, threadId))
  await writeSnapshot(runId, 'summarize_thread', { total, title, summary })
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

export async function chatWithPr(input: { message: string; threadId?: string | null; imageUrl?: string | null }) {
  const db = await getActivitiesDb()
  const now = new Date()
  let threadId = input.threadId ?? null

  // 图片附件(如有):读盘 → base64 供视觉模型;imageUrl 存进消息 contextJson 以便历史重现。
  const imageUrl = input.imageUrl || null
  let images: ChatImage[] = []
  if (imageUrl) {
    const name = uploadNameFromUrl(imageUrl)
    const img = name ? await readImageUpload(name) : null
    if (img) images = [{ base64: img.bytes.toString('base64'), mediaType: img.mediaType as ChatImage['mediaType'] }]
  }

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
    builderVersion: PR_CHAT_BUILDER_VERSION,
    attempts: 1,
    lastStep: 'load_facts',
    startedAt: now,
  })

  const userMessageId = generateId('msg')
  await db.insert(conversationMessages).values({
    id: userMessageId,
    threadId,
    runId,
    role: 'user',
    content: input.message.trim() || '[图片]',
    contextJson: imageUrl ? serialize({ imageUrl }) : null,
  })

  try {
    // ── build_context (FactLoader + FeatureBuilder + MemoryRetriever + KnowledgeRetriever) ──
    // 每个来源独立降级:RAG/记忆/健康/目标/画像任一失败都不该让对话挂掉。
    const [memoryItems, knowledge, recentMessages, recentHealth, raceGoals, companionProfile, recentActivities, latestPerType] =
      await Promise.all([
        listContextMemories(6).catch(() => []),
        retrieveKnowledge(input.message, 3).catch(() => []),
        db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.threadId, threadId))
          .orderBy(desc(conversationMessages.createdAt))
          .limit(6),
        getLatestHealthDailyMetrics(1).catch(() => []),
        getRaceGoalContext(3).catch(() => []),
        buildCompanionProfileContext().catch(() => null),
        getRecentActivityContext(5).catch(() => []),
        getLatestActivityPerType().catch(() => []),
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
    const goalLines = raceGoals.map(goal => `${goal.name}（还有 ${goal.daysUntilRace} 天）`)
    const activityTypeLabel: Record<string, string> = { running: '跑步', cycling: '骑行', walking: '步行' }
    const daysAgoLabel = (days: number) => (days === 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`)
    const activityLine = (act: (typeof recentActivities)[number]) =>
      `- ${act.date}（${daysAgoLabel(act.daysAgo)}）：${activityTypeLabel[act.type] ?? act.type} ${act.distanceKm} km，用时 ${act.durationMin} 分钟${act.paceText ? `，配速 ${act.paceText}/km` : ''}${act.avgHeartRate ? `，平均心率 ${act.avgHeartRate}` : ''}`
    const runLines = recentActivities.map(activityLine)
    // 「最近 N 条」窗口可能全被单一类型占满(比如连续骑行),把每种类型的最近一次补进来,
    // 并显式给出"距上次跑步 N 天"——跑步搭子最关键的事实,不能让模型自己推。
    const lastRun = latestPerType.find(act => act.type === 'running')
    if (lastRun) runLines.unshift(`- 距上次跑步已 ${lastRun.daysAgo} 天`)
    const extraPerType = latestPerType.filter(
      act => !recentActivities.some(recent => recent.date === act.date && recent.type === act.type),
    )
    if (extraPerType.length) {
      runLines.push('（更早的,各类型最近一次）', ...extraPerType.map(activityLine))
    }
    const profileBlock = companionProfile
      ? {
          displayName: companionProfile.displayName,
          companionStyle: companionProfile.companionStyle,
          trainingPreferences: companionProfile.trainingPreferences,
          injuryWatchlist: companionProfile.injuryWatchlist,
          doNotAssume: companionProfile.doNotAssume,
        }
      : undefined

    await writeSnapshot(runId, 'build_context', {
      memoryIds: memoryItems.map(memory => memory.id),
      knowledgeCount: knowledge.length,
      historyTurns: history.length,
      hasHealth: Boolean(h),
      recentActivityCount: recentActivities.length,
      lastRunDaysAgo: lastRun?.daysAgo ?? null,
      raceGoals: goalLines,
      profileVersion: companionProfile?.projectionVersion ?? null,
    })

    // ── draft_response (FriendPersona) + evaluate_response (Evaluator, 最多重写一次) ──
    const evalCtx: ChatEvalContext = {
      hasHealth: Boolean(h),
      hasMemoryOrHabit:
        memoryItems.length > 0 || (companionProfile?.trainingPreferences.length ?? 0) > 0,
      doNotAssume: companionProfile?.doNotAssume ?? [],
    }
    // FriendPersona 带只读工具:快照不够时自己查库(每次调用写 tool_use 快照可回放)
    const toolCalls: Array<{ name: string; input: unknown }> = []
    const persona = (constraints?: string[]) =>
      callPrModel(
        buildChatSystemPrompt(),
        buildChatUserPrompt({
          message: input.message,
          recentMessages: history,
          memories: memoryItems.map(memory => memory.content),
          knowledge: knowledge.map(item => item.content.slice(0, 220)),
          health: healthLine,
          recentRuns: runLines,
          raceGoals: goalLines,
          profile: profileBlock,
          hasImage: images.length > 0,
          constraints,
        }),
        {
          maxTokens: 500,
          images,
          tools: PR_CHAT_TOOLS,
          executeTool: executePrChatTool,
          onToolCall: (name, toolInput, result) => {
            toolCalls.push({ name, input: toolInput })
            void writeSnapshot(runId, 'tool_use', { name, input: toolInput, result: result.slice(0, 600) }).catch(() => {})
          },
        },
      )

    let answer = buildRuleBasedChatReply()
    let model = 'rule-based-chat-v1'
    let provider = 'local-rule'
    let warnings: string[] = []
    let attempts = 0

    try {
      const first = await persona()
      attempts = 1
      answer = first.content.trim() || buildRuleBasedChatReply()
      model = first.model
      provider = first.provider
      const firstEval = evaluateChatReply(answer, evalCtx)
      warnings = firstEval.warnings
      await writeSnapshot(runId, 'draft_response', { attempt: 1, model, provider, length: answer.length })
      await writeSnapshot(runId, 'evaluate_response', { attempt: 1, passed: firstEval.passed, warnings: firstEval.warnings })

      if (!firstEval.passed) {
        // Evaluator 不合格 → FriendPersona 带约束重写一次(doc: 最多重试一次)。
        try {
          const second = await persona(firstEval.warnings)
          const rewritten = second.content.trim()
          const secondEval = evaluateChatReply(rewritten, evalCtx)
          attempts = 2
          await writeSnapshot(runId, 'draft_response', { attempt: 2, model: second.model, length: rewritten.length })
          await writeSnapshot(runId, 'evaluate_response', { attempt: 2, passed: secondEval.passed, warnings: secondEval.warnings })
          if (rewritten) {
            answer = rewritten
            model = second.model
            provider = second.provider
            warnings = secondEval.warnings
          }
        } catch (rewriteError) {
          console.warn('[pr-chat] 重写失败，沿用初版:', (rewriteError as Error).message)
        }
      }
    } catch (personaError) {
      console.warn('[pr-chat] FriendPersona 生成失败，回退兜底:', (personaError as Error).message)
      answer = buildRuleBasedChatReply()
      model = 'rule-based-chat-v1'
      provider = 'local-rule'
      await writeSnapshot(runId, 'draft_response', { fallback: true, error: (personaError as Error).message })
    }

    // ── persist_output (assistant message + context_json 可追溯) ──
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
        raceGoals: goalLines,
        evaluatorWarnings: warnings,
        attempts,
        model,
        provider,
        toolCalls,
      }),
    })
    await writeSnapshot(runId, 'persist_output', { model, provider, warnings, attempts, toolCallCount: toolCalls.length })

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

    // ── curate_memory (MemoryCurator, LLM 蒸馏) ──
    // 回复落库后作为后台任务跑:既满足"输出之后再固化记忆"(不污染当前回复),又不让
    // 第二次模型调用拖慢用户拿到回复(微信/前端都不等它)。产出一律候选,晋升靠确认或多证据。
    void curateChatMemoryInBackground(runId, userMessageId, input.message, history).catch(error =>
      console.warn('[pr-chat] 后台记忆蒸馏失败:', (error as Error).message),
    )

    // ── summarize_thread (会话标题/摘要,后台,按轮次节流) ──
    void refreshThreadSummaryInBackground(runId, threadId).catch(error =>
      console.warn('[pr-chat] 会话摘要失败:', (error as Error).message),
    )

    return { threadId, runId, answer, model, provider, warnings, learnedMemoryIds: [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[pr-chat] 编排失败:', message)
    await writeSnapshot(runId, 'failed', { error: message }).catch(() => {})
    await db
      .update(agentRuns)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentRuns.id, runId))
      .catch(() => {})
    // 对话必须有回复:即便编排出错,也返回兜底话,让微信/前端能给用户一个响应。
    const answer = buildRuleBasedChatReply()
    return { threadId, runId, answer, model: 'rule-based-chat-v1', provider: 'local-rule', warnings: ['orchestration_failed'], learnedMemoryIds: [] }
  }
}

export async function listConversationMessages(threadId: string, limit = 30) {
  const db = await getActivitiesDb()
  const rows = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.threadId, threadId))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(limit)

  return rows.map(row => {
    let imageUrl: string | null = null
    if (row.contextJson) {
      try {
        const ctx = JSON.parse(row.contextJson) as { imageUrl?: string }
        if (typeof ctx.imageUrl === 'string') imageUrl = ctx.imageUrl
      } catch {
        /* ignore */
      }
    }
    return {
      id: row.id,
      threadId: row.threadId,
      role: row.role,
      content: row.content,
      imageUrl,
      createdAt: row.createdAt.toISOString(),
    }
  })
}

/** 列出会话(用于 H5 会话列表);按最近活动排序。 */
export async function listConversationThreads(limit = 50) {
  const db = await getActivitiesDb()
  const rows = await db
    .select()
    .from(conversationThreads)
    .orderBy(desc(conversationThreads.lastMessageAt))
    .limit(limit)
  return rows.map(row => ({
    id: row.id,
    title: row.title ?? 'PR 对话',
    summary: row.summary ?? null,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }))
}

/** 删除一个会话及其消息(硬删,不依赖 FK 级联)。 */
export async function deleteConversationThread(id: string): Promise<boolean> {
  const db = await getActivitiesDb()
  const existing = await db.select({ id: conversationThreads.id }).from(conversationThreads).where(eq(conversationThreads.id, id)).limit(1)
  if (!existing[0]) return false
  await db.delete(conversationMessages).where(eq(conversationMessages.threadId, id))
  await db.delete(conversationThreads).where(eq(conversationThreads.id, id))
  return true
}
