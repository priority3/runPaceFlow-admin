import { and, eq } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import {
  activityReviews,
  agentRuns,
  agentStateSnapshots,
  notificationDeliveries,
} from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'

import { buildDailyContext, PR_DAILY_BUILDER_VERSION } from './context'
import { callPrModel } from './model'
import {
  PR_DAILY_PROMPT_VERSION,
  buildDailyReviewSystemPrompt,
  buildDailyReviewUserPrompt,
  buildRuleBasedDailyReview,
} from './prompts'

function serialize(value: unknown) {
  return JSON.stringify(value)
}

/** Today's date as YYYY-MM-DD in Asia/Shanghai (matches how health data is keyed). */
function todayShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
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
 * Generate the daily recovery reflection (AI, health-driven) and enqueue a WeChat
 * notification. Append-only: a regenerate supersedes the previous current review.
 */
export async function generateDailyReview(options: {
  date?: string
  force?: boolean
  enqueueNotification?: boolean
} = {}) {
  const db = await getActivitiesDb()
  const subjectId = options.date ?? todayShanghai()
  const context = await buildDailyContext(subjectId)
  const inputHash = context.stateSnapshot.inputHash

  const currentRows = await db
    .select()
    .from(activityReviews)
    .where(
      and(
        eq(activityReviews.kind, 'pr_recovery_review'),
        eq(activityReviews.subjectType, 'recovery_day'),
        eq(activityReviews.subjectId, subjectId),
        eq(activityReviews.isCurrent, true),
      ),
    )
    .limit(1)

  if (currentRows[0] && !options.force && currentRows[0].inputHash === inputHash) {
    return { reviewId: currentRows[0].id, generated: false, subjectId }
  }

  const runId = generateId('run')
  const runInputHash = options.force ? `${inputHash}:regenerated:${Date.now().toString(36)}` : inputHash
  await db
    .insert(agentRuns)
    .values({
      id: runId,
      idempotencyKey: `daily_review:recovery_day:${subjectId}:${runInputHash}`,
      trigger: 'weekly_review',
      subjectType: 'recovery_day',
      subjectId,
      status: 'running',
      inputHash,
      builderVersion: PR_DAILY_BUILDER_VERSION,
      attempts: 1,
      lastStep: 'build_context',
      startedAt: new Date(),
    })
    .onConflictDoNothing()

  await writeSnapshot(runId, 'build_context', { context, inputHash: runInputHash })

  try {
    let content: string
    let model = 'rule-based-daily-v1'
    let provider = 'local-rule'
    try {
      const generated = await callPrModel(
        buildDailyReviewSystemPrompt(),
        buildDailyReviewUserPrompt(context),
        { maxTokens: 700 },
      )
      const trimmed = generated.content.trim()
      if (trimmed.length >= 40) {
        content = trimmed
        model = generated.model
        provider = generated.provider
      } else {
        content = buildRuleBasedDailyReview(context)
      }
    } catch (aiError) {
      console.warn('[daily-review] AI 生成失败，回退规则模板:', (aiError as Error).message)
      content = buildRuleBasedDailyReview(context)
    }

    await writeSnapshot(runId, 'draft_response', { provider, model, contentLength: content.length })

    const reviewId = generateId('review')
    for (const row of currentRows) {
      await db
        .update(activityReviews)
        .set({ isCurrent: false, supersededBy: reviewId, updatedAt: new Date() })
        .where(eq(activityReviews.id, row.id))
    }

    await db.insert(activityReviews).values({
      id: reviewId,
      runId,
      subjectType: 'recovery_day',
      subjectId,
      kind: 'pr_recovery_review',
      status: 'generated',
      featuresJson: serialize(context.todayHealth ?? {}),
      contextJson: serialize(context),
      content,
      model,
      provider,
      inputHash: runInputHash,
      builderVersion: PR_DAILY_BUILDER_VERSION,
      promptVersion: PR_DAILY_PROMPT_VERSION,
      isCurrent: true,
    })

    if (options.enqueueNotification !== false) {
      await db
        .insert(notificationDeliveries)
        .values({
          id: generateId('noti'),
          reviewId,
          channel: 'wechat_test_account',
          recipient: 'default',
          title: `PR 今日状态：${subjectId}`,
          content,
          payloadJson: serialize({ subjectId, inputHash: runInputHash }),
          status: 'pending',
        })
        .onConflictDoNothing()
    }

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

    await writeSnapshot(runId, 'persist_output', { reviewId, provider, model })
    return { reviewId, generated: true, subjectId, provider, model }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await db
      .update(agentRuns)
      .set({
        status: 'failed',
        errorCode: 'daily_review_failed',
        errorMessage,
        lastStep: 'persist_output',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, runId))
    await writeSnapshot(runId, 'failed', { errorMessage })
    throw error
  }
}
