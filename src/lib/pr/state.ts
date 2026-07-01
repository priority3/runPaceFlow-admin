import { desc, eq } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { activityReviews, agentRuns, agentStateSnapshots } from '@/lib/db/activities-schema'

function toIso(value: Date | string | number | null) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export async function listAgentRuns(limit = 30) {
  const db = await getActivitiesDb()
  const rows = await db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(limit)
  return rows.map(row => ({
    id: row.id,
    trigger: row.trigger,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    status: row.status,
    inputHash: row.inputHash,
    builderVersion: row.builderVersion,
    model: row.model,
    attempts: row.attempts,
    lastStep: row.lastStep,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    createdAt: toIso(row.createdAt),
  }))
}

export async function getAgentRunDetail(runId: string) {
  const db = await getActivitiesDb()
  const runs = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1)
  const run = runs[0]
  if (!run) return null

  const snapshots = await db
    .select()
    .from(agentStateSnapshots)
    .where(eq(agentStateSnapshots.runId, runId))
    .orderBy(desc(agentStateSnapshots.createdAt))

  const reviews = await db
    .select()
    .from(activityReviews)
    .where(eq(activityReviews.runId, runId))
    .orderBy(desc(activityReviews.createdAt))

  return {
    run: {
      id: run.id,
      trigger: run.trigger,
      subjectType: run.subjectType,
      subjectId: run.subjectId,
      status: run.status,
      inputHash: run.inputHash,
      builderVersion: run.builderVersion,
      model: run.model,
      attempts: run.attempts,
      lastStep: run.lastStep,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      startedAt: toIso(run.startedAt),
      completedAt: toIso(run.completedAt),
      createdAt: toIso(run.createdAt),
    },
    snapshots: snapshots.map(snapshot => ({
      id: snapshot.id,
      step: snapshot.step,
      state: JSON.parse(snapshot.stateJson),
      createdAt: toIso(snapshot.createdAt),
    })),
    reviews: reviews.map(review => ({
      id: review.id,
      kind: review.kind,
      activityId: review.activityId,
      status: review.status,
      isCurrent: review.isCurrent,
      inputHash: review.inputHash,
      createdAt: toIso(review.createdAt),
    })),
  }
}

export async function getContextSnapshotForRun(runId: string) {
  const db = await getActivitiesDb()
  const reviews = await db.select().from(activityReviews).where(eq(activityReviews.runId, runId)).limit(1)
  const review = reviews[0]
  if (!review?.contextJson) return null

  return {
    runId,
    reviewId: review.id,
    context: JSON.parse(review.contextJson),
    features: JSON.parse(review.featuresJson),
  }
}
