import { withAuthParams } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 转发到 pr-agent;写入后的伙伴画像重投影(projectFriendProfile)也在那侧完成。 */
const forward = (request: Request, id: string) =>
  proxyToPrAgent(request, `/api/pr/race-goals/${encodeURIComponent(id)}`)

export const PATCH = withAuthParams<{ id: string }>(async (request, { params }) => {
  const { id } = await params
  return forward(request, id)
})

export const DELETE = withAuthParams<{ id: string }>(async (request, { params }) => {
  const { id } = await params
  return forward(request, id)
})
