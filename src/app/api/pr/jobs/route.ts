import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 转发到 pr-agent(定时任务的 owner);本仓只保留同源入口 + admin 会话鉴权。 */
export const GET = withAuth(request => proxyToPrAgent(request, '/api/pr/jobs'))
