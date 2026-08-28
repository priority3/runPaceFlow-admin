import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/**
 * 转发到 pr-agent。本仓不再自己实现 PR 逻辑 —— owner 在 pr-agent,这里只保留
 * 「同源入口 + admin 会话鉴权」这一层:dashboard 的请求不必跨域,也不必在浏览器里
 * 持有 pr-agent 的凭据(转发时由服务端补 PR_AGENT_TOKEN)。
 */
export const GET = withAuth(request => proxyToPrAgent(request, '/api/pr/agent-runs'))
