import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 转发到 pr-agent;重生成复盘 + 记 regenerate 反馈事件都在那侧一并完成。 */
export const POST = withAuth(request => proxyToPrAgent(request, '/api/pr/reviews/regenerate'))
