import { desc, eq } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import {
  agentRuns,
  agentStateSnapshots,
  conversationMessages,
  conversationThreads,
} from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'

import { buildCompanionProfileContext } from './context'
import { evaluateChatReply, type ChatEvalContext } from './evaluator'
import { getLatestHealthDailyMetrics } from './health'
import { applyMemoryPatch, curateMemoryPatches, listContextMemories } from './memory'
import { callPrModel } from './model'
import {
  buildChatSystemPrompt,
  buildChatUserPrompt,
  buildRuleBasedChatReply,
} from './prompts'
import { getRaceGoalContext } from './race-goals'
import { retrieveKnowledge } from './rag'
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
    const [memoryItems, knowledge, recentMessages, recentHealth, raceGoals, companionProfile] =
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
    const persona = (constraints?: string[]) =>
      callPrModel(
        buildChatSystemPrompt(),
        buildChatUserPrompt({
          message: input.message,
          recentMessages: history,
          memories: memoryItems.map(memory => memory.content),
          knowledge: knowledge.map(item => item.content.slice(0, 220)),
          health: healthLine,
          raceGoals: goalLines,
          profile: profileBlock,
          hasImage: images.length > 0,
          constraints,
        }),
        { maxTokens: 500, images },
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
      }),
    })
    await writeSnapshot(runId, 'persist_output', { model, provider, warnings, attempts })

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
