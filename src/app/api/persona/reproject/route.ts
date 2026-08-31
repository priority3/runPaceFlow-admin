import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 手动重投影 → 转发 pr-agent(面板「重投影」按钮用;force 跳过输入指纹短路)。 */
export const POST = withAuth(async request => proxyToPrAgent(request, '/api/pr/persona/reproject'))
