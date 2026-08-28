import { withAuthParams } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 转发到 pr-agent(PR 逻辑 owner);本仓只保留同源入口 + admin 会话鉴权。见 lib/pr-agent-client.ts。 */
export const GET = withAuthParams<{ id: string }>(async (request, { params }) => {
  const { id } = await params
  return proxyToPrAgent(request, `/api/pr/agent-runs/${encodeURIComponent(id)}`)
})
