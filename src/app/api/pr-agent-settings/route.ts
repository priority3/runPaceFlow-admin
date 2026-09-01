import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/**
 * PR Agent 运行时配置(AI 网关 8 键)→ 转发 pr-agent /api/pr/settings。
 * 存储/白名单/加密全在 pr-agent 侧(owner);本仓只是「配置管理」面板的 UI 壳。
 * 注意与本仓自己的 app_settings 里的同名键区分:那份只喂 admin 的 AI 洞察,
 * 这份才是 PR 对话/复盘用的网关。
 */
export const GET = withAuth(async request => proxyToPrAgent(request, '/api/pr/settings'))
export const PUT = withAuth(async request => proxyToPrAgent(request, '/api/pr/settings'))
