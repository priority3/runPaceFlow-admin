/**
 * Scheduler Configuration Service
 *
 * Stores and retrieves cron job configurations from the database.
 */

import { ensureSchema, getDb } from './db'

export interface SchedulerJob {
  id: string
  name: string
  cronExpression: string
  enabled: boolean
  lastRunAt: string | null
  lastResult: string | null
  updatedAt: string
}

// Reason: 只登记**本进程有 handler 的** job(JOB_HANDLERS)。PR 系任务(通知分发/周总结/
// 老友日记/每日反思/记忆维护)随 3fe14ef 移交 pr-agent,它用自己的静态 DEFAULT_JOBS +
// CRON_<ID> env 调度、完全不读 admin.db —— 这里再登记就会在面板上渲染成「已启用、可改
// cron、保存成功」但 setupJobs 里 `if (!handler) continue` 直接跳过的假开关。
// 手动触发这些 PR 任务仍可经 /api/cron(其 action 会转发 pr-agent)。
const DEFAULT_JOBS: Array<{ id: string; name: string; cronExpression: string }> = [
  { id: 'sync', name: '运动数据同步', cronExpression: '0 * * * *' },
  { id: 'strava_event_drain', name: 'Strava Webhook 事件处理', cronExpression: '*/5 * * * *' },
  { id: 'insights', name: 'AI 分析生成', cronExpression: '5 * * * *' },
  { id: 'daily_report', name: '每日训练报告', cronExpression: '0 21 * * *' },
  { id: 'retention_cleanup', name: '数据保留清理', cronExpression: '0 3 * * 0' }, // Weekly on Sunday at 3am
  // admin.db 通用镜像 → 远程 libsql(默认主站 Turso):配置/分析数据的异地活副本,半小时一轮。
  { id: 'admin_db_mirror', name: 'admin 库异地镜像', cronExpression: '*/30 * * * *' },
]

export async function ensureDefaultJobs() {
  await ensureSchema()
  const db = getDb()

  for (const job of DEFAULT_JOBS) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO scheduler_jobs (id, name, cron_expression, enabled, updated_at)
            VALUES (?, ?, ?, 1, unixepoch())`,
      args: [job.id, job.name, job.cronExpression],
    })
  }
}

export async function listJobs(): Promise<SchedulerJob[]> {
  await ensureDefaultJobs()
  const db = getDb()

  const result = await db.execute('SELECT * FROM scheduler_jobs ORDER BY id')

  return result.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    cronExpression: row.cron_expression as string,
    enabled: Boolean(row.enabled),
    lastRunAt: row.last_run_at ? new Date((row.last_run_at as number) * 1000).toISOString() : null,
    lastResult: row.last_result as string | null,
    updatedAt: new Date((row.updated_at as number) * 1000).toISOString(),
  }))
}

export async function updateJob(
  id: string,
  updates: { cronExpression?: string; enabled?: boolean },
): Promise<SchedulerJob | null> {
  await ensureSchema()
  const db = getDb()

  const existing = await db.execute({
    sql: 'SELECT * FROM scheduler_jobs WHERE id = ?',
    args: [id],
  })
  if (existing.rows.length === 0) return null

  const fields: string[] = []
  const args: (string | number)[] = []

  if (updates.cronExpression !== undefined) {
    fields.push('cron_expression = ?')
    args.push(updates.cronExpression)
  }
  if (updates.enabled !== undefined) {
    fields.push('enabled = ?')
    args.push(updates.enabled ? 1 : 0)
  }
  fields.push('updated_at = unixepoch()')
  args.push(id)

  await db.execute({
    sql: `UPDATE scheduler_jobs SET ${fields.join(', ')} WHERE id = ?`,
    args,
  })

  const updated = await db.execute({
    sql: 'SELECT * FROM scheduler_jobs WHERE id = ?',
    args: [id],
  })
  const row = updated.rows[0]
  if (!row) return null

  return {
    id: row.id as string,
    name: row.name as string,
    cronExpression: row.cron_expression as string,
    enabled: Boolean(row.enabled),
    lastRunAt: row.last_run_at ? new Date((row.last_run_at as number) * 1000).toISOString() : null,
    lastResult: row.last_result as string | null,
    updatedAt: new Date((row.updated_at as number) * 1000).toISOString(),
  }
}

export async function recordJobRun(id: string, result: string) {
  await ensureSchema()
  const db = getDb()

  await db.execute({
    sql: `UPDATE scheduler_jobs SET last_run_at = unixepoch(), last_result = ?, updated_at = unixepoch() WHERE id = ?`,
    args: [result, id],
  })
}
