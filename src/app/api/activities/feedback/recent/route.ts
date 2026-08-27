import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 转发到 pr-agent;查询串(activityId/limit)原样透传。 */
export const GET = withAuth(request => proxyToPrAgent(request, '/api/pr/activity-feedback'))
