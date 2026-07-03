export type SettingCategory = 'database' | 'sync' | 'ai' | 'map' | 'goals' | 'notification' | 'runtime' | 'analytics'

export type SettingKind = 'text' | 'password' | 'url' | 'number' | 'select'

export interface SettingDefinition {
  key: string
  label: string
  description: string
  category: SettingCategory
  kind: SettingKind
  required?: boolean
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
    description: 'Strava 等运动平台的同步凭据。',
    accent: 'green',
  },
  ai: {
    label: 'AI 分析',
    description: 'Claude 或 OpenAI 兼容服务，用于活动洞察生成。',
    accent: 'purple',
  },
  map: {
    label: '地图',
    description: 'MapLibre 底图样式与前端公开配置。',
    accent: 'teal',
  },
  goals: {
    label: '运动目标',
    description: '首页统计卡片使用的周/月目标。',
    accent: 'orange',
  },
  notification: {
    label: '通知推送',
    description: 'PushPlus 推送通知配置，用于训练日报和同步提醒。',
    accent: 'pink',
  },
  runtime: {
    label: '运行时',
    description: '端口、站点地址和部署相关变量。',
    accent: 'gray',
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
    description: '支持 libsql:// Turso 远程库，也支持 file: 本地 SQLite。',
    category: 'database',
    kind: 'url',
    required: true,
    placeholder: 'libsql://your-database.turso.io',
  },
  {
    key: 'DATABASE_AUTH_TOKEN',
    label: '数据库认证 Token',
    description: 'Turso/libSQL 远程数据库通常必填，本地 file: 数据库可为空。',
    category: 'database',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'NEXT_PUBLIC_MAP_STYLE',
    label: '地图样式 URL',
    description: 'MapLibre 使用的公开底图样式地址。',
    category: 'map',
    kind: 'url',
    defaultValue: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  {
    key: 'STRAVA_CLIENT_ID',
    label: 'Strava Client ID',
    description: 'Strava API Application 的客户端 ID。',
    category: 'sync',
    kind: 'text',
  },
  {
    key: 'STRAVA_CLIENT_SECRET',
    label: 'Strava Client Secret',
    description: 'Strava API Application 的客户端密钥。',
    category: 'sync',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'STRAVA_REFRESH_TOKEN',
    label: 'Strava Refresh Token',
    description: '用于刷新 Strava access token 并同步活动。',
    category: 'sync',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'HEALTH_IMPORT_TOKEN',
    label: '健康数据上报 Token',
    description:
      'iOS 快捷指令 / HealthKit 等外部端上报睡眠、HRV、静息心率时的 Bearer 认证 Token。请求需带 Authorization: Bearer <token>。',
    category: 'sync',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Claude API Key',
    description: 'Anthropic Claude 服务密钥。',
    category: 'ai',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'ANTHROPIC_BASE_URL',
    label: 'Claude Base URL',
    description: '代理或兼容网关地址，可留空使用官方服务。',
    category: 'ai',
    kind: 'url',
  },
  {
    key: 'ANTHROPIC_MODEL',
    label: 'Claude 模型',
    description: '用于活动洞察与 PR 复盘的 Claude 模型名称，留空使用默认。第三方网关请填其支持的模型。',
    category: 'ai',
    kind: 'text',
    placeholder: 'claude-sonnet-4-20250514',
  },
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI 兼容 API Key',
    description: 'OpenAI、DeepSeek、通义千问等兼容服务密钥。',
    category: 'ai',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'OPENAI_BASE_URL',
    label: 'OpenAI 兼容 Base URL',
    description: '第三方 OpenAI 兼容服务通常需要填写。',
    category: 'ai',
    kind: 'url',
    placeholder: 'https://api.deepseek.com',
  },
  {
    key: 'OPENAI_MODEL',
    label: 'OpenAI 兼容模型',
    description: '用于 AI 分析的模型名称。',
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
  {
    key: 'NEXT_PUBLIC_WEEKLY_RUNNING_DISTANCE_GOAL',
    label: '跑步周里程目标',
    description: '单位：米。',
    category: 'goals',
    kind: 'number',
    defaultValue: '10000',
  },
  {
    key: 'NEXT_PUBLIC_MONTHLY_RUNNING_DISTANCE_GOAL',
    label: '跑步月里程目标',
    description: '单位：米。',
    category: 'goals',
    kind: 'number',
    defaultValue: '50000',
  },
  {
    key: 'NEXT_PUBLIC_WEEKLY_RUNNING_DURATION_GOAL',
    label: '跑步周时长目标',
    description: '单位：秒。',
    category: 'goals',
    kind: 'number',
    defaultValue: '3600',
  },
  {
    key: 'NEXT_PUBLIC_MONTHLY_RUNNING_DURATION_GOAL',
    label: '跑步月时长目标',
    description: '单位：秒。',
    category: 'goals',
    kind: 'number',
    defaultValue: '18000',
  },
  {
    key: 'NEXT_PUBLIC_WEEKLY_CYCLING_DISTANCE_GOAL',
    label: '骑行周里程目标',
    description: '单位：米。',
    category: 'goals',
    kind: 'number',
    defaultValue: '40000',
  },
  {
    key: 'NEXT_PUBLIC_MONTHLY_CYCLING_DISTANCE_GOAL',
    label: '骑行月里程目标',
    description: '单位：米。',
    category: 'goals',
    kind: 'number',
    defaultValue: '160000',
  },
  {
    key: 'NEXT_PUBLIC_WEEKLY_CYCLING_DURATION_GOAL',
    label: '骑行周时长目标',
    description: '单位：秒。',
    category: 'goals',
    kind: 'number',
    defaultValue: '7200',
  },
  {
    key: 'NEXT_PUBLIC_MONTHLY_CYCLING_DURATION_GOAL',
    label: '骑行月时长目标',
    description: '单位：秒。',
    category: 'goals',
    kind: 'number',
    defaultValue: '28800',
  },
  {
    key: 'PUSHPLUS_TOKEN',
    label: 'PushPlus Token',
    description: 'PushPlus 推送服务 Token，用于微信/邮件通知。获取地址：pushplus.plus',
    category: 'notification',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'WECHAT_TEST_ACCOUNT_APP_ID',
    label: '微信测试号 AppID',
    description: '微信公众平台测试号的 AppID，用于 PR 复盘推送。',
    category: 'notification',
    kind: 'text',
  },
  {
    key: 'WECHAT_TEST_ACCOUNT_APP_SECRET',
    label: '微信测试号 AppSecret',
    description: '微信公众平台测试号的 AppSecret。',
    category: 'notification',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'WECHAT_TEST_ACCOUNT_TEMPLATE_ID',
    label: '微信测试号模板 ID',
    description: '用于发送 PR 复盘的模板消息 ID。',
    category: 'notification',
    kind: 'text',
  },
  {
    key: 'WECHAT_TEST_ACCOUNT_OPEN_ID',
    label: '微信测试号 OpenID',
    description: '接收 PR 复盘推送的关注者 OpenID。',
    category: 'notification',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'WECHAT_TEST_ACCOUNT_TOKEN',
    label: '微信测试号消息 Token',
    description: '测试号「接口配置信息」里的 Token，用于校验微信回调（PR 对话入口）。需与测试号后台填写的一致。回调 URL：<你的域名>/api/wechat/callback',
    category: 'notification',
    kind: 'password',
    sensitive: true,
  },
  {
    key: 'NEXT_PUBLIC_APP_URL',
    label: '主应用地址',
    description: '部署后主应用访问地址，可用于脚本或未来集成。',
    category: 'runtime',
    kind: 'url',
    placeholder: 'https://run.example.com',
  },
  {
    key: 'NEXT_PUBLIC_ADMIN_URL',
    label: 'Admin 公开地址',
    description: '前端通过此地址发送分析数据。Docker 部署时使用 http://admin:3030。',
    category: 'runtime',
    kind: 'url',
    placeholder: 'https://admin.example.com',
  },
  {
    key: 'PORT',
    label: '主应用端口',
    description: '容器或 Node 服务监听端口。',
    category: 'runtime',
    kind: 'number',
    defaultValue: '3000',
  },
  {
    key: 'RUNPACEFLOW_ADMIN_URL',
    label: 'Admin 内网地址',
    description: '前端通过此地址获取运行时配置。Docker 部署时使用 http://admin:3030。',
    category: 'runtime',
    kind: 'url',
    placeholder: 'http://admin:3030',
  },
  {
    key: 'CONFIG_EXPORT_TOKEN',
    label: '配置导出 Token',
    description: '前端访问 /api/settings/export 时的认证 Token，需与前端 CONFIG_EXPORT_TOKEN 一致。',
    category: 'runtime',
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
  {
    key: 'ANALYTICS_RATE_LIMIT',
    label: '采集频率限制',
    description: '每个 IP 每分钟最大请求数，防止异常刷量。',
    category: 'analytics',
    kind: 'number',
    defaultValue: '30',
  },
]

export const SETTING_KEYS = SETTING_DEFINITIONS.map((definition) => definition.key)

export function getSettingDefinition(key: string) {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key)
}

export function isSensitiveSetting(key: string) {
  return getSettingDefinition(key)?.sensitive ?? /TOKEN|SECRET|KEY|PASSWORD/i.test(key)
}
