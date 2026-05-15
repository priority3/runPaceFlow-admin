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
    ],
    'write',
  )

  initialized = true
}
