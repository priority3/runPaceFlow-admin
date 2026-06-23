import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

import * as schema from './activities-schema'

/**
 * 活动数据库连接（共享库 shared.db）
 *
 * Reason: admin 接管同步后,活动数据写入与主站 runPaceFlow 共享的同一个 SQLite 库。
 * 这是独立于 admin 配置库(src/lib/db.ts 的 admin.db)的第二个连接,专用于 activities/
 * splits/syncLogs/userProfile/activityInsights 这套表。
 *
 * 库路径由 ACTIVITIES_DATABASE_URL 指定(部署时指向共享卷的 shared.db),
 * 默认本地 file:./data/shared.db。开启 WAL 降低与主站只读访问的锁争用。
 */
const getDatabaseUrl = () => {
  return process.env.ACTIVITIES_DATABASE_URL || 'file:./data/shared.db'
}

type DbInstance = ReturnType<typeof drizzle<typeof schema>>

let cachedDb: { db: DbInstance; signature: string } | undefined

export async function getActivitiesDb() {
  const url = getDatabaseUrl()
  const authToken = process.env.ACTIVITIES_DATABASE_AUTH_TOKEN
  const signature = `${url}\n${authToken ?? ''}`

  if (!cachedDb || cachedDb.signature !== signature) {
    const client = createClient({ url, authToken })
    // Reason: WAL 模式允许主站只读与 admin 写并发,减少 SQLITE_BUSY 锁错误。
    // 仅对本地 file: 库执行(远程 libsql 不需要也不支持该 PRAGMA)。
    if (url.startsWith('file:')) {
      try {
        await client.execute('PRAGMA journal_mode=WAL;')
        await client.execute('PRAGMA busy_timeout=5000;')
      } catch {
        // 忽略 PRAGMA 失败,不阻断连接
      }
    }
    cachedDb = { db: drizzle(client, { schema }), signature }
  }

  return cachedDb.db
}

// 兼容别名:搬迁来的 processor.ts/service.ts 用 getDb()
export const getDb = getActivitiesDb
