/**
 * app_settings 孤儿配置行清理脚本(默认 dry-run,--apply 才真删)。
 *
 * 场景:注册表(SETTING_DEFINITIONS)摘键后,app_settings 里对应行成为孤儿——
 * getSettingsMap 只投影已注册键,这些行永远不会被读取,但会误导「已配置」直觉。
 * 典型残留:本次配置瘦身摘除的 10 键(PORT / CONFIG_EXPORT_TOKEN / …)+ 微信测试号
 * 退役的 WECHAT_* 5 键旧值。
 *
 * 用法:
 *   bun run scripts/prune-orphan-settings.ts            # dry-run:仅打印孤儿行清单与统计
 *   bun run scripts/prune-orphan-settings.ts --apply    # 实际 DELETE 孤儿行,打印删除数
 *
 * 库连接与应用一致:CONFIG_DATABASE_URL || DATABASE_URL(复用 src/lib/db.ts 的 getDb)。
 * 本机跑需保证配置库可达(或 .env.local 提供等价 env,bun 自动加载)。
 */
import { getDb } from '@/lib/db'
import { SETTING_KEYS } from '@/lib/settings'

async function main() {
  const apply = process.argv.includes('--apply')
  const db = getDb()

  const registered = new Set(SETTING_KEYS)
  const result = await db.execute(
    'SELECT key, value, is_sensitive, updated_at FROM app_settings ORDER BY key',
  )

  const orphans = result.rows.filter((row) => !registered.has(String(row.key)))

  console.log(`app_settings 总行数:${result.rows.length},注册键数:${registered.size},孤儿行:${orphans.length}`)

  if (orphans.length === 0) {
    console.log('无孤儿行,无需清理。')
    return
  }

  console.log('\n孤儿行清单:')
  for (const row of orphans) {
    const value = String(row.value ?? '')
    // Reason: 敏感行不打印明文,只标记长度,避免凭据泄露到终端/日志
    const display = Number(row.is_sensitive) === 1 ? `[encrypted, len=${value.length}]` : `[value len=${value.length}] ${value}`
    const updatedAt = row.updated_at ? new Date(Number(row.updated_at) * 1000).toISOString() : '-'
    console.log(`  - ${String(row.key)}  ${display}  updated_at=${updatedAt}`)
  }

  if (!apply) {
    console.log(`\ndry-run:未删除任何行。人工核对清单后加 --apply 执行删除。`)
    return
  }

  // Reason: 按精确 key 列表删除,而非 NOT IN 子查询——防止并发写入新键被误删
  let deleted = 0
  for (const row of orphans) {
    const res = await db.execute({
      sql: 'DELETE FROM app_settings WHERE key = ?',
      args: [String(row.key)],
    })
    deleted += res.rowsAffected
  }
  console.log(`\n--apply:已删除 ${deleted} 行孤儿配置。`)
}

main().catch((error) => {
  console.error('prune-orphan-settings 执行失败:', error)
  process.exit(1)
})
