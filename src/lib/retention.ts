/**
 * Data Retention Policy
 *
 * Automatically cleans up old analytics data to manage database size.
 * Configurable retention period via ANALYTICS_RETENTION_DAYS setting.
 */

import { ensureSchema, getDb } from './db'

const DEFAULT_RETENTION_DAYS = 90

export interface RetentionResult {
  deleted: number
  retentionDays: number
}

export async function cleanupOldData(): Promise<RetentionResult> {
  await ensureSchema()
  const db = getDb()

  // Get retention setting
  const settingsResult = await db.execute({
    sql: `SELECT value FROM app_settings WHERE key = 'ANALYTICS_RETENTION_DAYS'`,
    args: [],
  })
  const retentionDays = Number(settingsResult.rows[0]?.value ?? DEFAULT_RETENTION_DAYS)

  const cutoffTime = Math.floor(Date.now() / 1000) - retentionDays * 86400

  const result = await db.execute({
    sql: `DELETE FROM page_views WHERE created_at < ?`,
    args: [cutoffTime],
  })

  return {
    deleted: result.rowsAffected ?? 0,
    retentionDays,
  }
}

export async function getRetentionStats(): Promise<{
  totalRows: number
  oldestDate: string | null
  estimatedSizeMB: number
}> {
  await ensureSchema()
  const db = getDb()

  const [countResult, oldestResult] = await Promise.all([
    db.execute(`SELECT COUNT(*) as count FROM page_views`),
    db.execute(`SELECT MIN(created_at) as oldest FROM page_views`),
  ])

  const totalRows = Number(countResult.rows[0]?.count ?? 0)
  const oldestTimestamp = Number(oldestResult.rows[0]?.oldest ?? 0)
  const oldestDate = oldestTimestamp > 0
    ? new Date(oldestTimestamp * 1000).toISOString()
    : null

  // Rough estimate: ~500 bytes per row
  const estimatedSizeMB = Math.round((totalRows * 500) / (1024 * 1024) * 100) / 100

  return { totalRows, oldestDate, estimatedSizeMB }
}
