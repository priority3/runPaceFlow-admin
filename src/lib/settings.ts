export type SettingCategory =
  | 'database'
  | 'sync'
  | 'ai'
  | 'map'
  | 'goals'
  | 'notification'
  | 'analytics'

export type SettingKind = 'text' | 'password' | 'url' | 'number' | 'select'

export interface SettingDefinition {
  key: string
  label: string
  description: string
  category: SettingCategory
  kind: SettingKind
  sensitive?: boolean
  placeholder?: string
  defaultValue?: string
  options?: Array<{ label: string; value: string }>
}

export const CATEGORY_META: Record<
  SettingCategory,
  { label: string; description: string; accent: string }
> = {
  database: {
    label: '数据库',
    description: 'RunPaceFlow 主应用的数据存储，当前生产环境使用 Turso/libSQL。',
    accent: 'blue',
  },
  sync: {
    label: '同步源',
    description:
      '运动数据同步凭据。Keep 是当前唯一自动同步源；Strava 因平台政策停用，适配器与路由保留待命，仅可手动触发 /api/sync/strava。',
    accent: 'green',
  },
  ai: {
    label: 'AI 分析',
    description:
      '仅供 admin 侧活动洞察（AI 复盘文本生成）的凭据。PR 对话与 PR 复盘走本页顶部「PR Agent 模型网关」卡片，与这里同名但互不影响。',
    accent: 'purple',
  },
  map: {
    label: '地图',
    description: 'MapLibre 底图样式与前端公开配置。',
    accent: 'teal',
  },
  goals: {
    label: '运动目标',
    description: '首页统计卡片使用的周/月目标。改后约 1 秒经运行时通道生效，无需重建。',
    accent: 'orange',
  },
  notification: {
    label: '通知推送',
    description: 'PushPlus 推送通知配置，用于训练日报和同步提醒。',
    accent: 'pink',
  },
  analytics: {
    label: '数据分析',
    description: '访问分析、数据保留和统计配置。',
    accent: 'cyan',
  },
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: 'DATABASE_URL',
    label: '数据库地址',
    description:
      '主应用数据库连接串。Turso 远程库填 libsql://<库名>-<org>.turso.io（Turso 控制台或 `turso db show` 可查）；本地开发可填 file: SQLite 路径。',
    category: 'database',
    kind: 'url',
    placeholder: 'libsql://your-database.turso.io',
  },
  {
    key: 'DATABASE_AUTH_TOKEN',
    label: '数据库认证 Token',
    description:
      'Turso 远程库必填，用 `turso db tokens create <库名>` 生成；本地 file: 数据库留空即可。',
    category: 'database',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'NEXT_PUBLIC_MAP_STYLE',
    label: '地图样式 URL',
    description:
      'MapLibre 使用的公开底图样式地址（默认 CartoCDN Positron，免费无需 Key）。改后约 1 秒经运行时通道生效，无需重建。',
    category: 'map',
    kind: 'url',
    defaultValue: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  {
    key: 'STRAVA_CLIENT_ID',
    label: 'Strava Client ID（停用待命）',
    description:
      'Strava API 应用的客户端 ID，在 strava.com/settings/api 创建应用后获取。当前 Strava 同步政策性停用，凭据保留待命。',
    category: 'sync',
    kind: 'text',
  },
  {
    key: 'STRAVA_CLIENT_SECRET',
    label: 'Strava Client Secret（停用待命）',
    description: 'Strava API 应用的客户端密钥，与 Client ID 同页获取。当前停用待命。',
    category: 'sync',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'STRAVA_REFRESH_TOKEN',
    label: 'Strava Refresh Token（停用待命）',
    description:
      '经 OAuth 授权流程换取的长期刷新令牌，用于刷新 access token 拉取活动。当前停用待命。',
    category: 'sync',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'KEEP_MOBILE',
    label: 'Keep 手机号',
    description:
      '登录 Keep 拉取跑步数据的手机号（默认同步源），即 Keep App 的登录手机号。Apple Watch 跑步会经苹果健康同步进 Keep。',
    category: 'sync',
    kind: 'text',
  },
  {
    key: 'KEEP_PASSWORD',
    label: 'Keep 密码',
    description:
      'Keep App 的登录密码（与手机号配套，仅用于拉取你自己的跑步数据；加密存储）。',
    category: 'sync',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'HEALTH_IMPORT_TOKEN',
    label: '健康数据上报 Token',
    description:
      'iOS 快捷指令 / HealthKit 等外部端上报睡眠、HRV、静息心率时的鉴权 Token。自定一串随机字符串，填进快捷指令的 Authorization: Bearer <token> 头即可。',
    category: 'sync',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Claude API Key',
    description:
      'Anthropic Claude 服务密钥。官方在 console.anthropic.com 创建；用第三方网关则填网关发放的 Key。',
    category: 'ai',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'ANTHROPIC_BASE_URL',
    label: 'Claude Base URL',
    description: '第三方网关或代理地址；留空使用 Anthropic 官方服务。',
    category: 'ai',
    kind: 'url',
  },
  {
    key: 'ANTHROPIC_MODEL',
    label: 'Claude 模型',
    description:
      '（本组只喂 admin 活动洞察）洞察生成使用的 Claude 模型名，留空用内置默认。注意：PR 对话/复盘的模型不在这里，在本页顶部「PR Agent 模型网关」卡片。',
    category: 'ai',
    kind: 'text',
    placeholder: 'claude-sonnet-4-20250514',
  },
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI 兼容 API Key',
    description:
      '（本组只喂 admin 活动洞察）OpenAI、DeepSeek、通义千问等兼容服务的密钥，在对应平台的 API Keys 页面创建。作为 Claude 不可用时的备用通道。',
    category: 'ai',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'OPENAI_BASE_URL',
    label: 'OpenAI 兼容 Base URL',
    description: '（本组只喂 admin 活动洞察）第三方 OpenAI 兼容服务的 API 地址（如 https://api.deepseek.com）；官方 OpenAI 可留空。',
    category: 'ai',
    kind: 'url',
    placeholder: 'https://api.deepseek.com',
  },
  {
    key: 'OPENAI_MODEL',
    label: 'OpenAI 兼容模型',
    description: '（本组只喂 admin 活动洞察）走 OpenAI 兼容通道时使用的模型名称，填所选服务支持的模型。',
    category: 'ai',
    kind: 'text',
    placeholder: 'gpt-4o',
  },
  {
    key: 'OPENAI_API_FORMAT',
    label: 'OpenAI API 格式',
    description: '多数兼容服务使用 chat，Responses API 网关可选 responses。',
    category: 'ai',
    kind: 'select',
    defaultValue: 'chat',
    options: [
      { label: 'Chat Completions', value: 'chat' },
      { label: 'Responses API', value: 'responses' },
    ],
  },
  // ─── 运动目标 ─────────────────────────────────────────────────────────────
  {
    key: 'NEXT_PUBLIC_WEEKLY_RUNNING_DISTANCE_GOAL',
    label: '跑步周里程目标',
    description: '单位：米。改后约 1 秒经运行时通道生效，无需重建。',
    category: 'goals',
    kind: 'number',
    defaultValue: '10000',
  },
  {
    key: 'NEXT_PUBLIC_MONTHLY_RUNNING_DISTANCE_GOAL',
    label: '跑步月里程目标',
    description: '单位：米。改后约 1 秒经运行时通道生效，无需重建。',
    category: 'goals',
    kind: 'number',
    defaultValue: '50000',
  },
  {
    key: 'NEXT_PUBLIC_WEEKLY_RUNNING_DURATION_GOAL',
    label: '跑步周时长目标',
    description: '单位：秒。改后约 1 秒经运行时通道生效，无需重建。',
    category: 'goals',
    kind: 'number',
    defaultValue: '3600',
  },
  {
    key: 'NEXT_PUBLIC_MONTHLY_RUNNING_DURATION_GOAL',
    label: '跑步月时长目标',
    description: '单位：秒。改后约 1 秒经运行时通道生效，无需重建。',
    category: 'goals',
    kind: 'number',
    defaultValue: '18000',
  },
  {
    key: 'NEXT_PUBLIC_WEEKLY_CYCLING_DISTANCE_GOAL',
    label: '骑行周里程目标',
    description: '单位：米。改后约 1 秒经运行时通道生效，无需重建。',
    category: 'goals',
    kind: 'number',
    defaultValue: '40000',
  },
  {
    key: 'NEXT_PUBLIC_MONTHLY_CYCLING_DISTANCE_GOAL',
    label: '骑行月里程目标',
    description: '单位：米。改后约 1 秒经运行时通道生效，无需重建。',
    category: 'goals',
    kind: 'number',
    defaultValue: '160000',
  },
  {
    key: 'NEXT_PUBLIC_WEEKLY_CYCLING_DURATION_GOAL',
    label: '骑行周时长目标',
    description: '单位：秒。改后约 1 秒经运行时通道生效，无需重建。',
    category: 'goals',
    kind: 'number',
    defaultValue: '7200',
  },
  {
    key: 'NEXT_PUBLIC_MONTHLY_CYCLING_DURATION_GOAL',
    label: '骑行月时长目标',
    description: '单位：秒。改后约 1 秒经运行时通道生效，无需重建。',
    category: 'goals',
    kind: 'number',
    defaultValue: '28800',
  },
  {
    key: 'PUSHPLUS_TOKEN',
    label: 'PushPlus Token',
    description:
      'PushPlus 推送服务 Token，用于训练日报、PR 复盘等微信推送。获取方式：pushplus.plus 微信扫码登录 → 「一对一推送」页复制 Token。',
    category: 'notification',
    kind: 'password',
    sensitive: true,
  },
  // Analytics
  {
    key: 'ANALYTICS_RETENTION_DAYS',
    label: '数据保留天数',
    description: '页面浏览数据自动清理周期，超过此天数的旧数据将被删除。',
    category: 'analytics',
    kind: 'number',
    defaultValue: '90',
  },
]

export const SETTING_KEYS = SETTING_DEFINITIONS.map((definition) => definition.key)

export function getSettingDefinition(key: string) {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key)
}

export function isSensitiveSetting(key: string) {
  return getSettingDefinition(key)?.sensitive ?? /TOKEN|SECRET|KEY|PASSWORD/i.test(key)
}
