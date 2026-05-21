import { ensureSchema, getDb } from './db'

export interface ServiceHealth {
  name: string
  status: 'online' | 'offline' | 'degraded'
  responseTimeMs: number | null
  url: string
  error?: string
}

export interface SystemInfo {
  nodeVersion: string
  uptime: number
  uptimeFormatted: string
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
    heapUsedFormatted: string
    heapTotalFormatted: string
    rssFormatted: string
  }
  platform: string
  arch: string
}

export interface DatabaseStatus {
  connected: boolean
  type: 'turso' | 'sqlite' | 'unknown'
  url: string
  error?: string
}

export interface AuditLogEntry {
  id: string
  action: string
  key: string | null
  createdAt: string
}

export interface SyncStatus {
  lastSyncTime: string | null
  totalChanges: number
  recentFailures: number
}

export interface MonitorData {
  services: ServiceHealth[]
  system: SystemInfo
  database: DatabaseStatus
  sync: SyncStatus
  auditLogs: AuditLogEntry[]
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}天 ${hours}小时`
  if (hours > 0) return `${hours}小时 ${minutes}分钟`
  return `${minutes}分钟`
}

export async function checkServiceHealth(
  name: string,
  url: string,
): Promise<ServiceHealth> {
  const start = Date.now()
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })
    const responseTimeMs = Date.now() - start

    return {
      name,
      status: response.ok ? 'online' : 'degraded',
      responseTimeMs,
      url,
    }
  } catch (error) {
    return {
      name,
      status: 'offline',
      responseTimeMs: null,
      url,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function checkFrontendHealth(): Promise<ServiceHealth> {
  const frontendUrl = process.env.RUNPACEFLOW_FRONTEND_URL || 'http://localhost:3000'
  return checkServiceHealth('Frontend', frontendUrl)
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const mem = process.memoryUsage()
  const uptimeSec = process.uptime()

  return {
    nodeVersion: process.version,
    uptime: uptimeSec,
    uptimeFormatted: formatUptime(uptimeSec),
    memory: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
      heapUsedFormatted: formatBytes(mem.heapUsed),
      heapTotalFormatted: formatBytes(mem.heapTotal),
      rssFormatted: formatBytes(mem.rss),
    },
    platform: process.platform,
    arch: process.arch,
  }
}

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  const url = process.env.CONFIG_DATABASE_URL || process.env.DATABASE_URL || 'file:./data/admin.db'

  try {
    await ensureSchema()
    const db = getDb()
    await db.execute('SELECT 1')

    let type: DatabaseStatus['type'] = 'unknown'
    if (url.startsWith('libsql://') || url.startsWith('http://') || url.startsWith('https://')) {
      type = 'turso'
    } else if (url.startsWith('file:')) {
      type = 'sqlite'
    }

    return {
      connected: true,
      type,
      url: url.replace(/\/\/.*@/, '//***@'), // 隐藏认证信息
    }
  } catch (error) {
    return {
      connected: false,
      type: 'unknown',
      url,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getSyncStatus(): Promise<SyncStatus> {
  await ensureSchema()
  const db = getDb()

  // 获取最近一次配置变更
  const lastChange = await db.execute(
    'SELECT created_at FROM app_setting_audit_logs ORDER BY created_at DESC LIMIT 1',
  )
  const lastSyncTime =
    lastChange.rows.length > 0
      ? new Date((lastChange.rows[0].created_at as number) * 1000).toISOString()
      : null

  // 获取总变更数
  const totalResult = await db.execute('SELECT COUNT(*) as count FROM app_setting_audit_logs')
  const totalChanges = Number(totalResult.rows[0]?.count ?? 0)

  // 获取失败数（action 包含 'fail' 或 'error' 的记录）
  const failureResult = await db.execute(
    "SELECT COUNT(*) as count FROM app_setting_audit_logs WHERE action LIKE '%fail%' OR action LIKE '%error%'",
  )
  const recentFailures = Number(failureResult.rows[0]?.count ?? 0)

  return {
    lastSyncTime,
    totalChanges,
    recentFailures,
  }
}

export async function getAuditLogs(limit = 20): Promise<AuditLogEntry[]> {
  await ensureSchema()
  const db = getDb()

  const result = await db.execute({
    sql: 'SELECT id, action, key, created_at FROM app_setting_audit_logs ORDER BY created_at DESC LIMIT ?',
    args: [limit],
  })

  return result.rows.map((row) => ({
    id: row.id as string,
    action: row.action as string,
    key: row.key as string | null,
    createdAt: new Date((row.created_at as number) * 1000).toISOString(),
  }))
}

export async function getMonitorData(): Promise<MonitorData> {
  const [frontendHealth, system, database, sync, auditLogs] = await Promise.all([
    checkFrontendHealth(),
    getSystemInfo(),
    getDatabaseStatus(),
    getSyncStatus(),
    getAuditLogs(),
  ])

  // Admin 自身健康
  const adminHealth: ServiceHealth = {
    name: 'Admin',
    status: 'online',
    responseTimeMs: 0,
    url: 'http://localhost:3030',
  }

  return {
    services: [adminHealth, frontendHealth],
    system,
    database,
    sync,
    auditLogs,
  }
}
