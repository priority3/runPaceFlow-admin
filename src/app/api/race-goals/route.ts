import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 转发到 pr-agent;写入后的伙伴画像重投影(projectFriendProfile)也在那侧完成。 */
export const GET = withAuth(request => proxyToPrAgent(request, '/api/pr/race-goals'))
export const POST = withAuth(request => proxyToPrAgent(request, '/api/pr/race-goals'))
