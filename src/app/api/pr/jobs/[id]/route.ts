import { withAuthParams } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 改某个 PR 任务的 cron / 开关,转发给 pr-agent(它写自己的库并热重载调度)。 */
export const PATCH = withAuthParams<{ id: string }>(async (request, { params }) => {
  const { id } = await params
  return proxyToPrAgent(request, `/api/pr/jobs/${encodeURIComponent(id)}`)
})
