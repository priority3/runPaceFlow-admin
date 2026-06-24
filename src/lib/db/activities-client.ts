import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { createClient, type Client } from '@libsql/client'
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
  const url = process.env.ACTIVITIES_DATABASE_URL || 'file:./data/shared.db'

  if (url.startsWith('file:')) {
    const filePath = url.replace(/^file:/, '')
    const dir = path.dirname(path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath))
    mkdirSync(dir, { recursive: true })
  }

  return url
}

type DbInstance = ReturnType<typeof drizzle<typeof schema>>

let cachedDb: { db: DbInstance; signature: string } | undefined

async function ensureActivitiesSchema(client: Client) {
  await client.execute('PRAGMA foreign_keys = ON;')

  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS activities (
        id text PRIMARY KEY NOT NULL,
        title text NOT NULL,
        type text NOT NULL,
        source text NOT NULL,
        source_id text NOT NULL,
        start_time integer NOT NULL,
        end_time integer NOT NULL,
        duration integer NOT NULL,
        distance real NOT NULL,
        average_pace real,
        best_pace real,
        elevation_gain real,
        average_heart_rate integer,
        max_heart_rate integer,
        calories integer,
        gpx_data text,
        route_coordinates text,
        is_indoor integer DEFAULT false,
        race_name text,
        weather_data text,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS activity_insights (
        id text PRIMARY KEY NOT NULL,
        activity_id text NOT NULL,
        content text NOT NULL,
        generated_at integer NOT NULL,
        model text NOT NULL,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        FOREIGN KEY (activity_id) REFERENCES activities(id) ON UPDATE no action ON DELETE cascade
      )`,
      `CREATE TABLE IF NOT EXISTS splits (
        id text PRIMARY KEY NOT NULL,
        activity_id text NOT NULL,
        kilometer integer NOT NULL,
        duration integer NOT NULL,
        pace real NOT NULL,
        distance real NOT NULL,
        elevation_gain real,
        average_heart_rate integer,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        FOREIGN KEY (activity_id) REFERENCES activities(id) ON UPDATE no action ON DELETE cascade
      )`,
      `CREATE TABLE IF NOT EXISTS sync_logs (
        id text PRIMARY KEY NOT NULL,
        source text NOT NULL,
        status text NOT NULL,
        activities_count integer,
        error_message text,
        started_at integer NOT NULL,
        completed_at integer
      )`,
      `CREATE TABLE IF NOT EXISTS user_profile (
        id text PRIMARY KEY NOT NULL,
        name text,
        avatar text,
        sync_source text,
        nike_access_token text,
        strava_access_token text,
        garmin_secret_string text,
        last_sync_at integer,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL
      )`,
    ],
    'write',
  )

  const columns = await client.execute('PRAGMA table_info(activities)')
  const existingColumns = new Set(columns.rows.map((row) => String((row as { name?: string }).name)))
  if (!existingColumns.has('route_coordinates')) {
    await client.execute('ALTER TABLE activities ADD COLUMN route_coordinates text')
  }

  await client.execute('CREATE INDEX IF NOT EXISTS idx_activities_source_id ON activities(source, source_id)')
  await client.execute('CREATE INDEX IF NOT EXISTS idx_activities_source_start_time ON activities(source, start_time)')
  await client.execute('CREATE INDEX IF NOT EXISTS idx_splits_activity_id ON splits(activity_id)')
  await client.execute('CREATE INDEX IF NOT EXISTS idx_sync_logs_source_started_at ON sync_logs(source, started_at)')
}

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
        await client.execute('PRAGMA foreign_keys = ON;')
        await client.execute('PRAGMA journal_mode=WAL;')
        await client.execute('PRAGMA busy_timeout=5000;')
      } catch {
        // 忽略 PRAGMA 失败,不阻断连接
      }
    }
    await ensureActivitiesSchema(client)
    cachedDb = { db: drizzle(client, { schema }), signature }
  }

  return cachedDb.db
}

// 兼容别名:搬迁来的 processor.ts/service.ts 用 getDb()
export const getDb = getActivitiesDb
