import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { createClient, type Client } from '@libsql/client'

let client: Client | null = null
let initialized = false

function getDatabaseUrl() {
  const url = process.env.CONFIG_DATABASE_URL || process.env.DATABASE_URL || 'file:./data/admin.db'

  if (url.startsWith('file:')) {
    const filePath = url.replace(/^file:/, '')
    const dir = path.dirname(path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath))
    mkdirSync(dir, { recursive: true })
  }

  return url
}

export function getDb() {
  if (!client) {
    client = createClient({
      url: getDatabaseUrl(),
      authToken: process.env.CONFIG_DATABASE_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN,
    })
  }

  return client
}

export async function ensureSchema() {
  if (initialized) return

  const db = getDb()
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        is_sensitive INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      `CREATE TABLE IF NOT EXISTS app_setting_audit_logs (
        id TEXT PRIMARY KEY NOT NULL,
        action TEXT NOT NULL,
        key TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      `CREATE TABLE IF NOT EXISTS page_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        referrer TEXT,
        user_agent TEXT,
        ip_hash TEXT,
        visitor_id TEXT,
        session_id TEXT,
        browser TEXT,
        os TEXT,
        device_type TEXT,
        country TEXT,
        city TEXT,
        region TEXT,
        language TEXT,
        timezone TEXT,
        load_time INTEGER,
        scroll_depth INTEGER,
        ab_tests TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      `CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path)`,
      `CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_page_views_visitor ON page_views(visitor_id)`,
      `CREATE INDEX IF NOT EXISTS idx_page_views_session ON page_views(session_id)`,
      `CREATE TABLE IF NOT EXISTS click_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        selector TEXT,
        path TEXT NOT NULL,
        visitor_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      `CREATE INDEX IF NOT EXISTS idx_click_events_path ON click_events(path)`,
      `CREATE INDEX IF NOT EXISTS idx_click_events_created_at ON click_events(created_at)`,
      `CREATE TABLE IF NOT EXISTS scheduler_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER,
        last_result TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
    ],
    'write',
  )

  // Migration: add new columns to existing page_views table
  await migratePageViews(db)

  initialized = true
}

async function migratePageViews(db: ReturnType<typeof getDb>) {
  const columnsToAdd = [
    { name: 'browser', type: 'TEXT' },
    { name: 'os', type: 'TEXT' },
    { name: 'device_type', type: 'TEXT' },
    { name: 'country', type: 'TEXT' },
    { name: 'city', type: 'TEXT' },
    { name: 'region', type: 'TEXT' },
    { name: 'language', type: 'TEXT' },
    { name: 'timezone', type: 'TEXT' },
    { name: 'load_time', type: 'INTEGER' },
    { name: 'scroll_depth', type: 'INTEGER' },
    { name: 'ab_tests', type: 'TEXT' },
  ]

  try {
    const result = await db.execute("PRAGMA table_info(page_views)")
    const existingColumns = new Set(result.rows.map(r => r.name))

    for (const col of columnsToAdd) {
      if (!existingColumns.has(col.name)) {
        await db.execute(`ALTER TABLE page_views ADD COLUMN ${col.name} ${col.type}`)
      }
    }

    // Add session index if not exists
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_page_views_session ON page_views(session_id)`)
  } catch {
    // Table might not exist yet, skip migration
  }
}
