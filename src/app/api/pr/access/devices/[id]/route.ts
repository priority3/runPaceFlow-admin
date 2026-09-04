import { withAuthParams } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/** 吊销一台设备。转发到 pr-agent;吊销最迟 60s 生效(对方的校验结果有内存缓存)。 */
export const DELETE = withAuthParams<{ id: string }>(async (request, { params }) => {
  const { id } = await params
  return proxyToPrAgent(request, `/api/pr/access/devices/${encodeURIComponent(id)}`)
})
