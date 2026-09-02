/**
 * scheduler_jobs 孤儿任务行清理脚本(默认 dry-run,--apply 才真删)。
 *
 * 场景:PR 系定时任务随 3fe14ef 移交 pr-agent 后,本进程已无对应 handler,
 * DEFAULT_JOBS 也已摘除;但 scheduler_jobs 表里的旧行仍在,且 listJobs 直接
 * `SELECT * FROM scheduler_jobs` 全量返回 —— 面板会把它们渲染成「已启用、可改
 * cron、保存成功」的假开关,而 setupJobs 的 `if (!handler) continue` 根本不注册。
 *
 * 注意:ensureDefaultJobs 的 INSERT OR IGNORE 只播种 DEFAULT_JOBS 里的 id,
 * 摘除后不会再把这些行写回来,所以删除是一次性的、不会复发。
 *
 * 用法:
 *   bun run scripts/prune-orphan-jobs.ts            # dry-run:打印孤儿行(含最后执行记录)
 *   bun run scripts/prune-orphan-jobs.ts --apply    # 实际 DELETE
 *
 * 权衡:这些行携带 8/27 移交之前的真实 last_run_at / last_result 执行历史,
 * 删除即丢弃。dry-run 会完整打印出来,需要留档就先复制。
 */
import { ensureSchema, getDb } from '@/lib/db'

/** 本进程真正会注册的 job id —— 与 scheduler.ts 的 JOB_HANDLERS 一一对应。 */
const HANDLED_JOB_IDS = new Set([
  'sync',
  'strava_event_drain',
  'insights',
  'daily_report',
  'retention_cleanup',
  'admin_db_mirror',
])

async function main() {
  const apply = process.argv.includes('--apply')
  await ensureSchema() // 空库/首次运行也能跑
  const db = getDb()

  const result = await db.execute('SELECT id, name, enabled, last_run_at, last_result FROM scheduler_jobs ORDER BY id')
  const orphans = result.rows.filter(row => !HANDLED_JOB_IDS.has(String(row.id)))

  console.log(`scheduler_jobs 总行数:${result.rows.length},有 handler:${HANDLED_JOB_IDS.size},孤儿行:${orphans.length}`)
  if (orphans.length === 0) {
    console.log('无孤儿任务行,无需清理。')
    return
  }

  console.log('\n孤儿任务(面板显示为已启用但永不执行):')
  for (const row of orphans) {
    const lastRun = row.last_run_at ? new Date(Number(row.last_run_at) * 1000).toISOString() : '从未执行'
    console.log(`  - ${row.id} | ${row.name} | enabled=${row.enabled} | 最后执行:${lastRun}`)
    if (row.last_result) console.log(`      last_result: ${row.last_result}`)
  }

  if (!apply) {
    console.log('\ndry-run:未删除任何行。执行历史如上,需要留档请先复制,再加 --apply 删除。')
    return
  }

  for (const row of orphans) {
    await db.execute({ sql: 'DELETE FROM scheduler_jobs WHERE id = ?', args: [String(row.id)] })
  }
  console.log(`\n已删除 ${orphans.length} 行。`)
}

main().catch(error => {
  console.error('清理失败:', error)
  process.exit(1)
})
