import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 转发到 pr-agent;通知入队与派发都在那侧完成(渠道配置也在那侧)。 */
export const POST = withAuth(request => proxyToPrAgent(request, '/api/pr/reviews/notify'))
