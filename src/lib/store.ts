import { randomUUID } from 'node:crypto'

import { decryptValue, encryptValue } from './crypto'
import { ensureSchema, getDb } from './db'
import { SETTING_DEFINITIONS, getSettingDefinition, isSensitiveSetting } from './settings'

export interface StoredSetting {
  key: string
  value: string
  isSensitive: boolean
  description: string | null
  updatedAt: string | null
  exists: boolean
}

interface SettingRow {
  key: string
  value: string
  is_sensitive: number
  description: string | null
  updated_at: number | null
}

function rowToSetting(row: SettingRow): StoredSetting {
  const isSensitive = Boolean(row.is_sensitive)

  return {
    key: row.key,
    value: isSensitive ? decryptValue(row.value) : row.value,
    isSensitive,
    description: row.description,
    updatedAt: row.updated_at ? new Date(row.updated_at * 1000).toISOString() : null,
    exists: true,
  }
}

export async function listSettings() {
  await ensureSchema()

  const db = getDb()
  const result = await db.execute('SELECT * FROM app_settings ORDER BY key')
  const rows = result.rows as unknown as SettingRow[]
  const stored = new Map(rows.map((row) => [row.key, rowToSetting(row)]))

  return SETTING_DEFINITIONS.map((definition) => {
    const existing = stored.get(definition.key)
    if (existing) return existing

    // Reason: 未配置的键 value 一律为空串,defaultValue 只留给 UI 层做展示兜底——
    // 否则默认值会经 getSettingsMap/exportSettings 冒充"已配置值"下发覆盖主站 env
    return {
      key: definition.key,
      value: '',
      isSensitive: definition.sensitive ?? false,
      description: definition.description,
      updatedAt: null,
      exists: false,
    }
  })
}

export async function getSettingsMap() {
  const settings = await listSettings()
  // 只投影有库行且非空的值,保证"库行才覆盖 env"的合并语义
  return Object.fromEntries(
    settings
      .filter((setting) => setting.exists && setting.value !== '')
      .map((setting) => [setting.key, setting.value]),
  )
}

export async function upsertSetting(key: string, value: string) {
  await ensureSchema()

  const definition = getSettingDefinition(key)
  const sensitive = isSensitiveSetting(key)
  const storedValue = sensitive && value ? encryptValue(value) : value
  const description = definition?.description ?? null

  await getDb().execute({
    sql: `INSERT INTO app_settings (key, value, is_sensitive, description, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        is_sensitive = excluded.is_sensitive,
        description = excluded.description,
        updated_at = unixepoch()`,
    args: [key, storedValue, sensitive ? 1 : 0, description],
  })

  await writeAuditLog('upsert', key)
}

export async function updateSettings(entries: Record<string, string>) {
  for (const [key, value] of Object.entries(entries)) {
    await upsertSetting(key, value)
  }
}

export async function importSettings(entries: Record<string, string>) {
  const knownEntries = Object.fromEntries(
    Object.entries(entries).filter(([key]) =>
      SETTING_DEFINITIONS.some((definition) => definition.key === key),
    ),
  )

  await updateSettings(knownEntries)
  await writeAuditLog('import')

  return Object.keys(knownEntries).length
}

export async function exportSettings({ includeEmpty = false } = {}) {
  const settings = await listSettings()
  // Reason: 导出只含有库行的键——未配置键(即便注册表带 defaultValue)不该进入分发通道
  return settings
    .filter((setting) => setting.exists && (includeEmpty || setting.value !== ''))
    .map((setting) => ({ key: setting.key, value: setting.value }))
}

async function writeAuditLog(action: string, key?: string) {
  await getDb().execute({
    sql: 'INSERT INTO app_setting_audit_logs (id, action, key, created_at) VALUES (?, ?, ?, unixepoch())',
    args: [randomUUID(), action, key ?? null],
  })
}
