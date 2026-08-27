import { withAuth, withHealthImportAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/**
 * 转发到 pr-agent 的 /api/health/daily。
 *
 * 那侧的 POST 已包含本仓此前手写的整条链路:睡眠分段推导 → upsert 日度指标 →
 * 伙伴画像重投影 → 触发当日反思。POST 保留 withHealthImportAuth:上报方是 iOS
 * 快捷指令,带的是 HEALTH_IMPORT_TOKEN 而非 admin 会话(转发时由服务端换成
 * PR_AGENT_TOKEN,设备 token 不出本仓)。
 */
export const GET = withAuth(request => proxyToPrAgent(request, '/api/health/daily'))
export const POST = withHealthImportAuth(request => proxyToPrAgent(request, '/api/health/daily'))
