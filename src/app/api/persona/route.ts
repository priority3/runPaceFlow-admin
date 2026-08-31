import { withAuth } from '@/lib/api-helpers'
import { proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/**
 * 数字分身投影(「数字分身」面板数据源)→ 转发 pr-agent(PR 逻辑 owner)。
 *
 * 曾是全仓最后一处直读共库的 PR 数据路径(raw select persona_state)——当时留的
 * 后门就是「将来面板整体切 pr-agent API 时零迁移」;lib/pr 副本删除后统一走代理,
 * 顺带获得 pr-agent 端「无投影时现算一份」的行为,且不再依赖共库卷。
 */
export const GET = withAuth(async request => proxyToPrAgent(request, '/api/pr/persona'))
