/**
 * admin.db 通用镜像:把配置/分析库整库增量镜像到**显式指定**的远程 libsql。
 *
 * 与 sync/mirror.ts(活动镜像)同属「本地真相源 + 异地活副本」策略,但 admin.db
 * 表多且会演进(配置/访问分析/审计/转化…),逐表手写镜像维护不起——这里做通用化:
 * 枚举 sqlite_master,小表全量覆写(捕获 UPDATE),大表按 rowid 游标增量
 * (page_views 这类只追加的表,旧行不改写,游标语义成立)。
 *
 * - 目标库表名加 admin_mirror_ 前缀,与主站自有表隔离;额外 _src_rowid 列作
 *   主键承载增量游标。镜像表只为灾难恢复,不服务查询,不复刻约束/索引
 * - 失败不抛错只落日志,下轮自愈;inFlight 防重入;单轮大表上限 5000 行,
 *   首次回填分轮吃完
 * - 目标**必须**由 ADMIN_MIRROR_DATABASE_URL 显式指定,不缺省复用主站库。
 *   Reason: 曾回落到 settings.DATABASE_URL,而那个键的用途是「活动数据镜像的目标」
 *   (见 sync/mirror.ts)。于是一填它去开活动镜像,admin.db 整库就被顺带 dump 到
 *   同一个远端 —— 包括 app_settings 里**加密的 Keep 手机号与密码**(SKIP_TABLES
 *   不排除它,那本是灾备的核心价值)。而防自镜像那道检查只比 CONFIG_DATABASE_URL,
 *   拦不住这条路。两个用途共用一个键会让「镜像运动数据」静默变成「连凭据一起外发」,
 *   所以此处不再回落:要镜像配置库,就显式配自己的目标。
 *   (admin.db 另有 B2 冷备,见 pr-agent 仓 scripts/backup/backup-to-b2.sh)
 * - 已知取舍:大表(>阈值)中旧行的 UPDATE/DELETE 不会同步——本库大表均为
 *   append-only 事件流,可接受;若将来出现大且可变的表,给它配 FULL_COPY 白名单
 */
import { createClient, type Client, type InStatement } from '@libsql/client'

import { getDb } from '@/lib/db'
import { getRuntimeSettings } from '@/lib/runtime-config'

export interface DbMirrorResult {
  ran: boolean
  tables: number
  rows: number
  /** 大表还有积压(本轮到上限),下轮继续。 */
  backlog: boolean
  errorMessage?: string
}

/** 行数 ≤ 此值的表走全量覆写(能捕获 UPDATE/DELETE);之上走 rowid 增量。 */
const FULL_COPY_MAX_ROWS = 2000
/** 单表单轮增量上限(控制单轮时长;首次回填分轮完成)。 */
const INCREMENTAL_BATCH_LIMIT = 5000
/** 单条 batch 语句组的行数。 */
const INSERT_CHUNK = 200

const SKIP_TABLES = /^(sqlite_|admin_mirror_|__drizzle|libsql_|_litestream)/

let targetCache: { client: Client; signature: string } | undefined
let inFlight = false

async function getTargetClient(): Promise<{ client: Client; url: string } | null> {
  const settings = await getRuntimeSettings()
  // 只认专用键,绝不回落 DATABASE_URL(那是活动镜像的目标,见文件头注释)
  const url = settings.ADMIN_MIRROR_DATABASE_URL
  if (!url) return null
  const authToken = settings.ADMIN_MIRROR_DATABASE_AUTH_TOKEN || undefined
  const signature = `${url}\n${authToken ?? ''}`
  if (!targetCache || targetCache.signature !== signature) {
    targetCache = { client: createClient({ url, authToken }), signature }
  }
  return { client: targetCache.client, url }
}

interface ColumnInfo {
  name: string
  type: string
}

/** 单表镜像;返回本轮写入行数与是否还有积压。WITHOUT ROWID 等异形表抛错由调用方跳过。 */
async function mirrorTable(source: Client, target: Client, table: string): Promise<{ rows: number; backlog: boolean }> {
  const info = await source.execute(`PRAGMA table_info(${JSON.stringify(table)})`)
  const columns: ColumnInfo[] = info.rows.map(row => ({ name: String(row.name), type: String(row.type || 'TEXT') }))
  if (!columns.length) return { rows: 0, backlog: false }

  const mirror = `admin_mirror_${table}`
  const colDefs = columns.map(col => `"${col.name}" ${col.type}`).join(', ')
  await target.execute(`CREATE TABLE IF NOT EXISTS "${mirror}" (_src_rowid INTEGER PRIMARY KEY, ${colDefs})`)

  const colNames = columns.map(col => `"${col.name}"`).join(', ')
  const placeholders = columns.map(() => '?').join(',')
  const insertSql = `INSERT OR REPLACE INTO "${mirror}" (_src_rowid, ${colNames}) VALUES (?,${placeholders})`

  const countResult = await source.execute(`SELECT count(*) AS n FROM "${table}"`)
  const total = Number(countResult.rows[0]?.n ?? 0)

  let cursor = 0
  let fullCopy = total <= FULL_COPY_MAX_ROWS
  if (fullCopy) {
    await target.execute(`DELETE FROM "${mirror}"`)
  } else {
    const cursorResult = await target.execute(`SELECT CAST(max(_src_rowid) AS INTEGER) AS c FROM "${mirror}"`)
    cursor = Number(cursorResult.rows[0]?.c ?? 0) || 0
  }

  const limit = fullCopy ? total : INCREMENTAL_BATCH_LIMIT
  const pending = await source.execute({
    sql: `SELECT rowid AS _src_rowid, ${colNames} FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
    args: [fullCopy ? 0 : cursor, limit + 1],
  })
  const backlog = !fullCopy && pending.rows.length > limit
  const rows = backlog ? pending.rows.slice(0, limit) : pending.rows

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const statements: InStatement[] = rows.slice(i, i + INSERT_CHUNK).map(row => ({
      sql: insertSql,
      args: [row._src_rowid, ...columns.map(col => row[col.name] ?? null)],
    }))
    await target.batch(statements, 'write')
  }
  return { rows: rows.length, backlog }
}

/** 整库镜像入口。幂等,可随时重跑;由调度 job 周期触发。 */
export async function mirrorAdminDb(): Promise<DbMirrorResult> {
  if (inFlight) return { ran: false, tables: 0, rows: 0, backlog: false }
  const resolved = await getTargetClient()
  if (!resolved) {
    console.info('[db-mirror] 未配置 ADMIN_MIRROR_DATABASE_URL,跳过配置库镜像')
    return { ran: false, tables: 0, rows: 0, backlog: false }
  }

  const settings = await getRuntimeSettings()
  const sourceUrl = settings.CONFIG_DATABASE_URL || ''
  if (sourceUrl && sourceUrl === resolved.url) {
    console.warn('[db-mirror] 镜像目标与源库同址,拒绝自镜像')
    return { ran: false, tables: 0, rows: 0, backlog: false }
  }

  inFlight = true
  try {
    const source = getDb()
    const tableResult = await source.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    let tables = 0
    let rows = 0
    let backlog = false
    for (const row of tableResult.rows) {
      const table = String(row.name)
      if (SKIP_TABLES.test(table)) continue
      try {
        const result = await mirrorTable(source, resolved.client, table)
        tables++
        rows += result.rows
        backlog = backlog || result.backlog
      } catch (error) {
        // 单表失败(如 WITHOUT ROWID 异形表)不拖累其他表;落日志人工排查。
        console.warn(`[db-mirror] 表 ${table} 镜像失败:`, (error as Error).message)
      }
    }
    if (rows > 0 || backlog) {
      console.info(`[db-mirror] admin 库镜像:${tables} 表 ${rows} 行${backlog ? ',大表仍有积压,下轮继续' : ''}`)
    }
    return { ran: true, tables, rows, backlog }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.warn('[db-mirror] admin 库镜像失败(下轮自愈):', errorMessage)
    return { ran: true, tables: 0, rows: 0, backlog: false, errorMessage }
  } finally {
    inFlight = false
  }
}
