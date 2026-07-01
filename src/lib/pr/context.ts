import { createHash } from 'node:crypto'

import {
  buildActivityReviewFeatures,
  buildRecentTrainingContext,
  type ActivityReviewFeatures,
  type RecentTrainingContext,
} from '@/lib/activity/review-features'

import { getLatestHealthDailyMetrics, type HealthDailyMetricContext } from './health'
import { listSubjectiveFeedbackForActivity, type SubjectiveFeedbackContext } from './feedback'
import { getRaceGoalContext, type RaceGoalContext } from './race-goals'
import { retrieveKnowledge, type KnowledgeContext } from './rag'
import { listContextMemories, type MemoryContext } from './memory'

export const PR_CONTEXT_BUILDER_VERSION = 'pr-context-v1'

export interface PrContext {
  activity: ActivityReviewFeatures
  recentTraining: RecentTrainingContext
  raceGoals: RaceGoalContext[]
  healthDailyMetrics: HealthDailyMetricContext[]
  subjectiveFeedback: SubjectiveFeedbackContext[]
  retrievedKnowledge: KnowledgeContext[]
  memoryItems: MemoryContext[]
  stateSnapshot: {
    builderVersion: string
    inputHash: string
    memoryVersion: number
    generatedAt: string
  }
  discardedContext: Array<{ type: string; reason: string }>
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

export function hashPrInput(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export async function buildPrContext(activityId: string): Promise<PrContext | null> {
  const activity = await buildActivityReviewFeatures(activityId)
  if (!activity) return null

  const knowledgeQuery = [
    activity.pace.trend,
    activity.effort.fatigueSignal,
    activity.summary.type,
    activity.moments.map(moment => moment.type).join(' '),
  ].filter(Boolean).join(' ')

  const [recentTraining, subjectiveFeedback, memoryItems, raceGoals, healthDailyMetrics, retrievedKnowledge] =
    await Promise.all([
      buildRecentTrainingContext(activityId, 14),
      listSubjectiveFeedbackForActivity(activityId, 5),
      listContextMemories(8),
      getRaceGoalContext(3),
      getLatestHealthDailyMetrics(7),
      retrieveKnowledge(knowledgeQuery, 3),
    ])

  const hashPayload = {
    activity,
    recentTraining,
    raceGoals,
    healthDailyMetrics,
    retrievedKnowledge,
    subjectiveFeedback,
    memoryItems,
    builderVersion: PR_CONTEXT_BUILDER_VERSION,
  }
  const inputHash = hashPrInput(hashPayload)
  const memoryVersion = memoryItems.reduce((max, item) => Math.max(max, item.version), 0)

  return {
    activity,
    recentTraining,
    raceGoals,
    healthDailyMetrics,
    subjectiveFeedback,
    retrievedKnowledge,
    memoryItems,
    discardedContext: [
      ...(memoryItems.length === 0
        ? [{ type: 'memory', reason: '暂无 active 长期记忆，避免伪造上下文' }]
        : []),
      ...(raceGoals.length === 0
        ? [{ type: 'race_goal', reason: '暂无 active 比赛目标，避免编造备赛目标' }]
        : []),
      ...(healthDailyMetrics.length === 0
        ? [{ type: 'health', reason: '暂无恢复数据，避免编造睡眠/HRV/静息心率状态' }]
        : []),
      ...(retrievedKnowledge.length === 0
        ? [{ type: 'rag', reason: '暂无命中的训练知识库条目，训练建议仅基于活动事实' }]
        : []),
    ],
    stateSnapshot: {
      builderVersion: PR_CONTEXT_BUILDER_VERSION,
      inputHash,
      memoryVersion,
      generatedAt: new Date().toISOString(),
    },
  }
}
