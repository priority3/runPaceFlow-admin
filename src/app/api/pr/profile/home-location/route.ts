import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 转发到 pr-agent(PR 逻辑 owner);本仓只保留同源入口 + admin 会话鉴权。见 lib/pr-agent-client.ts。 */
const PATH = '/api/pr/profile/home-location'

export const GET = withAuth(request => proxyToPrAgent(request, PATH))
export const PUT = withAuth(request => proxyToPrAgent(request, PATH))
export const DELETE = withAuth(request => proxyToPrAgent(request, PATH))
