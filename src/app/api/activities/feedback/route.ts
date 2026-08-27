import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/**
 * 转发到 pr-agent。那侧的 POST 是完整链路:落反馈 → 萃取记忆补丁 → 应用 → 重生成复盘,
 * 四步在同一个 owner 里完成(此前本仓自己串这四步,与 pr-agent 各有一份实现)。
 */
export const POST = withAuth(request => proxyToPrAgent(request, '/api/pr/activity-feedback'))
