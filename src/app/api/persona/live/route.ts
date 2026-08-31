import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 实时状态(P3)→ 转发 pr-agent(它代理 priority.me presence 并做词表映射/缓存)。 */
export const GET = withAuth(async request => proxyToPrAgent(request, '/api/pr/persona/live'))
