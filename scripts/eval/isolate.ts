/**
 * 库隔离守卫 —— 必须在任何 `@/lib/*` DB 调用前 import。
 *
 * 把 activities/agent 相关的全部读写(会话、agent_runs、快照、候选记忆、健康、活动……)
 * 定向到本地 eval.db;`getDatabaseConfig()`(activities-client.ts)优先读
 * `process.env.ACTIVITIES_DATABASE_URL`,所以这一句就能保证零生产污染。
 *
 * 注意:不覆盖 CONFIG_DATABASE_URL / DATABASE_URL —— 模型网关凭据仍从原配置解析
 * (由 `bun --env-file=.env.local` 注入),评测才能打到真实模型。
 */
if (!process.env.ACTIVITIES_DATABASE_URL) {
  process.env.ACTIVITIES_DATABASE_URL = 'file:./data/eval.db'
}

// 配置库也隔离到一个独立空库:模型凭据只从 env(--env-file)来,不去读本机 admin.db
// (那里存着加密的敏感设置,缺 SETTINGS_ENCRYPTION_KEY 会 decrypt 报错刷屏)。空库 = 全默认值。
if (!process.env.CONFIG_DATABASE_URL) {
  process.env.CONFIG_DATABASE_URL = 'file:./data/eval-config.db'
}

// 多模态用例的图片从这里读(uploads.ts 模块加载时取 PR_UPLOAD_DIR)——绝不落到生产的 /app/data/uploads。
if (!process.env.PR_UPLOAD_DIR) {
  process.env.PR_UPLOAD_DIR = './data/eval-uploads'
}

// 评测默认不发 trace(防止污染生产 Phoenix 观测);PR_EVAL_PHOENIX=1 时保留端点,
// trace 进独立项目 pr-eval(与生产 pr-agent 分开),run.ts 会负责 initOtel + 收尾 flush。
if (process.env.PR_EVAL_PHOENIX === '1') {
  if (!process.env.PHOENIX_PROJECT_NAME) process.env.PHOENIX_PROJECT_NAME = 'pr-eval'
} else {
  delete process.env.PHOENIX_COLLECTOR_ENDPOINT
}

// 本机全局 Anthropic 环境(如 Claude Code 注入的 ANTHROPIC_AUTH_TOKEN / 自定义头 / 默认模型)
// 会串进评测用的 SDK 请求:x-api-key 之外再塞一个 Authorization: Bearer,网关直接 403「Request not allowed」。
// 评测走 ANTHROPIC_API_KEY(x-api-key)路径,这些绝不需要,一律清掉。
// (ANTHROPIC_BASE_URL 的本机覆盖无法在此区分来源——见 run.sh 里在启动前 unset。)
for (const key of [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
]) {
  delete process.env[key]
}

export const EVAL_DB_URL = process.env.ACTIVITIES_DATABASE_URL
