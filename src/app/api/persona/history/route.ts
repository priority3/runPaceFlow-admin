import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 分身特征变更史(P5 成长回放数据源)→ 转发 pr-agent。 */
export const GET = withAuth(async request => proxyToPrAgent(request, '/api/pr/persona/history'))
