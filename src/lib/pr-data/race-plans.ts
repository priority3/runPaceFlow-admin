import { createHash } from 'node:crypto'

import { asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { memoryEvents, memoryItems, raceGoals, racePlans } from '@/lib/db/activities-schema'

const evidenceSchema = z.object({
  messageId: z.string().min(1), messageCreatedAt: z.string().min(1), originalText: z.string(),
  quote: z.string().min(1), source: z.enum(['user_text', 'user_image']), imageUrl: z.string().nullable(),
  dateText: z.string().nullable(), dateReference: z.string().nullable(),
})
const planSchema = z.object({
  id: z.string().min(1).max(100).optional(), goalId: z.string().nullable().optional(), name: z.string().min(2).max(120),
  city: z.string().nullable(), raceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  distanceMeters: z.number().positive().max(1_000_000).nullable(),
  status: z.enum(['active', 'needs_confirmation', 'archived']), evidence: evidenceSchema,
})
export const racePlanSyncSchema = z.object({ plans: z.array(planSchema).max(20), runId: z.string().nullable().optional() })

function normalized(value: string) {
  return value.replace(/\s|\d{4}年?/g, '').replace(/半马/g, '半程马拉松').replace(/全马/g, '马拉松').toLowerCase()
}

function content(plan: { status: string; name: string; raceDate: string | null; city: string | null; distanceMeters: number | null }) {
  const label = plan.status === 'active' ? '计划参加' : plan.status === 'needs_confirmation' ? '提到待确认赛事' : '赛事计划已结束或取消'
  return `用户${label}：${plan.name}；日期：${plan.raceDate ?? '待确认'}；地点：${plan.city ?? '待确认'}；距离：${plan.distanceMeters == null ? '待确认' : `${plan.distanceMeters / 1000} 公里`}。赛事官方资料另存，用户陈述不等于官方核验。`
}

export async function syncRacePlans(input: z.infer<typeof racePlanSyncSchema>) {
  const db = await getActivitiesDb()
  const ids: string[] = []
  await db.transaction(async tx => {
    for (const plan of input.plans) {
      const rows = await tx.select().from(racePlans)
      const same = rows.filter(row => normalized(row.name) === normalized(plan.name))
      const current = same.find(row => row.raceDate === plan.raceDate && row.distanceMeters === plan.distanceMeters)
      const pending = same.find(row => row.status === 'needs_confirmation' && (!row.raceDate || row.raceDate === plan.raceDate))
      const match = current ?? (plan.status === 'active' ? pending : undefined)
      const id = match?.id ?? `race_${createHash('sha256').update(JSON.stringify([normalized(plan.name), plan.raceDate, plan.distanceMeters])).digest('hex').slice(0, 24)}`
      const evidence = match ? [...(JSON.parse(match.evidenceJson) as Array<z.infer<typeof evidenceSchema>>), plan.evidence] : [plan.evidence]
      const status = match?.status === 'active' ? 'active' : plan.status
      let goalId = match?.goalId ?? plan.goalId ?? null
      if (status === 'active' && plan.raceDate && plan.distanceMeters && !goalId) {
        const goals = await tx.select().from(raceGoals)
        const existingGoal = goals.find(goal => normalized(goal.name) === normalized(plan.name) && goal.status === 'active' && goal.distanceMeters === plan.distanceMeters && goal.raceDate.toISOString().slice(0, 10) === plan.raceDate)
        goalId = existingGoal?.id ?? `goal_${id}`
        if (!existingGoal) await tx.insert(raceGoals).values({ id: goalId, name: plan.name, raceDate: new Date(`${plan.raceDate}T00:00:00+08:00`), distanceMeters: plan.distanceMeters, targetType: 'participate', priority: 'secondary', notes: '来自聊天的参赛计划；未指定成绩目标及主次。' })
      }
      await tx.insert(racePlans).values({ id, goalId, name: plan.name, raceDate: plan.raceDate, city: plan.city, distanceMeters: plan.distanceMeters, status, evidenceJson: JSON.stringify(evidence) }).onConflictDoUpdate({ target: racePlans.id, set: { goalId, city: plan.city, raceDate: plan.raceDate, distanceMeters: plan.distanceMeters, status, evidenceJson: JSON.stringify(evidence), ...(current && current.raceDate !== plan.raceDate ? { researchJson: null } : {}), updatedAt: new Date() } })
      const memoryId = `mem_${id}`
      const memoryEvidence = evidence.map(item => ({ source: item.source === 'user_image' ? 'conversation_image' : 'conversation_message', refId: item.messageId, quote: item.quote, createdAt: item.messageCreatedAt }))
      await tx.insert(memoryItems).values({ id: memoryId, type: 'goal', status: status === 'active' ? 'active' : 'candidate', content: content({ ...plan, status }), evidenceJson: JSON.stringify(memoryEvidence), confidence: status === 'active' ? 0.9 : 0.6, source: 'user', dedupeKey: `race-plan:${id}` }).onConflictDoUpdate({ target: memoryItems.id, set: { status: status === 'active' ? 'active' : 'candidate', content: content({ ...plan, status }), evidenceJson: JSON.stringify(memoryEvidence), confidence: status === 'active' ? 0.9 : 0.6, lastSeenAt: new Date(), updatedAt: new Date() } })
      await tx.insert(memoryEvents).values({ id: `mevt_${id}_${plan.evidence.messageId}`, memoryId, runId: input.runId ?? null, idempotencyKey: `race-plan:${id}:${plan.evidence.messageId}`, action: match ? 'update' : 'create', status: 'applied', patchJson: JSON.stringify(plan), actor: 'user', resultingVersion: 1, reason: 'admin 数据服务保存赛事计划及用户证据。' }).onConflictDoNothing()
      ids.push(id)
    }
  })
  return listRacePlansByIds(ids)
}

export async function listRacePlansByIds(ids?: string[]) {
  const db = await getActivitiesDb()
  const rows = ids?.length ? await db.select().from(racePlans).where(inArray(racePlans.id, [...new Set(ids)])) : await db.select().from(racePlans).where(inArray(racePlans.status, ['active', 'needs_confirmation'])).orderBy(asc(racePlans.raceDate))
  return rows.map(row => ({ ...row, evidence: JSON.parse(row.evidenceJson), research: row.researchJson ? JSON.parse(row.researchJson) : null }))
}

export async function saveRaceResearch(id: string, research: unknown) {
  const db = await getActivitiesDb()
  await db.update(racePlans).set({ researchJson: JSON.stringify(research), updatedAt: new Date() }).where(eq(racePlans.id, id))
  const [row] = await db.select().from(racePlans).where(eq(racePlans.id, id))
  return row ? { ...row, evidence: JSON.parse(row.evidenceJson), research: row.researchJson ? JSON.parse(row.researchJson) : null } : null
}

export async function syncRacePlanGoal(goalId: string, archived = false) {
  const db = await getActivitiesDb()
  const [goal] = await db.select().from(raceGoals).where(eq(raceGoals.id, goalId))
  const linked = await db.select().from(racePlans).where(eq(racePlans.goalId, goalId))
  for (const plan of linked) {
    const changed = Boolean(goal && (plan.name !== goal.name || plan.distanceMeters !== goal.distanceMeters || plan.raceDate !== goal.raceDate.toISOString().slice(0, 10)))
    await db.update(racePlans).set({
      ...(goal ? { name: goal.name, raceDate: goal.raceDate.toISOString().slice(0, 10), distanceMeters: goal.distanceMeters } : {}),
      status: archived || !goal || goal.status !== 'active' ? 'archived' : 'active',
      ...(changed ? { researchJson: null } : {}), updatedAt: new Date(),
    }).where(eq(racePlans.id, plan.id))
    await db.update(memoryItems).set({
      status: archived || !goal || goal.status !== 'active' ? 'archived' : 'active',
      content: content({ name: goal?.name ?? plan.name, raceDate: goal ? goal.raceDate.toISOString().slice(0, 10) : plan.raceDate, distanceMeters: goal?.distanceMeters ?? plan.distanceMeters, city: plan.city, status: archived || !goal || goal.status !== 'active' ? 'archived' : 'active' }),
      updatedAt: new Date(),
    }).where(eq(memoryItems.dedupeKey, `race-plan:${plan.id}`))
  }
}
