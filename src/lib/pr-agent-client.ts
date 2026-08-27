/**
 * pr-agent 客户端(薄代理)
 *
 * PR 伙伴能力的 owner 是 pr-agent 仓;本 UI 只当消费者。dashboard 的 PR 面板与
 * 本仓残留的 PR 路由都经这里转发过去,而不是各自再实现一遍。
 *
 * 鉴权:pr-agent 的管理端点认「会话 cookie 或 Bearer PR_ADMIN_TOKEN」。本仓是服务端
 * 到服务端调用,拿不到对方的会话 cookie,所以走 token(本仓侧键名 PR_AGENT_TOKEN)。
 *
 * 配置来源刻意用 process.env 而非 app_settings:这两个值是部署拓扑(容器网络/域名),
 * 与 NEXT_PUBLIC_ADMIN_URL 同类 —— 不进配置面板,换地址改 env 重启容器即可。
 */

import { NextResponse } from 'next/server'

/** pr-agent 服务端地址(容器内服务名);未配置返回空串。 */
function getBaseUrl(): string {
  return (process.env.PR_AGENT_URL ?? '').trim().replace(/\/$/, '')
}

/** 是否已接上 pr-agent。未接时调用方应回退到本仓自带实现。 */
export function isPrAgentConfigured(): boolean {
  return getBaseUrl().length > 0
}

/**
 * 向 pr-agent 发一个请求。path 以 / 开头(如 '/api/pr/memories')。
 *
 * 不做重试:调用方多是交互式请求,失败让前端看到比静默卡住好;定时任务侧的重试
 * 由 pr-agent 自己的调度负责。
 */
export async function prAgentFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getBaseUrl()
  if (!base) throw new Error('PR_AGENT_URL 未配置')

  const token = (process.env.PR_AGENT_TOKEN ?? '').trim()
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)

  return fetch(`${base}${path}`, { ...init, headers, cache: 'no-store' })
}

/**
 * 把本仓的一个路由请求原样转发给 pr-agent,并把对方的响应回给调用方。
 *
 * 保留:method、查询串、请求体(含 multipart 上传)、Content-Type;
 * 剥掉:本仓的 Cookie(对 pr-agent 无意义,且避免把本仓会话泄漏出去)。
 *
 * Reason: 转发 body 必须带 duplex:'half'(Node 18+ 的 fetch 要求流式 body 显式声明),
 * 否则带体请求会抛 "RequestInit: duplex option is required"。
 */
export async function proxyToPrAgent(request: Request, path: string): Promise<Response> {
  const search = new URL(request.url).search
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'

  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)

  try {
    const upstream = await prAgentFetch(`${path}${search}`, {
      method: request.method,
      headers,
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    } as RequestInit)

    // 原样回传状态码与体;pr-agent 的 4xx/5xx 语义直接透出,不在这里改写。
    const responseHeaders = new Headers()
    const upstreamType = upstream.headers.get('content-type')
    if (upstreamType) responseHeaders.set('content-type', upstreamType)

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch (error) {
    // Reason: 网络层失败(容器没起、服务名写错)必须落日志 —— 前端多是静默 catch,
    // 不留痕的话症状就成了「面板空白、容器日志干净」,只能靠猜。
    console.error(`[pr-agent] 转发 ${request.method} ${path} 失败:`, error)
    return NextResponse.json(
      { error: `pr-agent 不可达:${(error as Error).message}` },
      { status: 502 },
    )
  }
}

/** 便捷读取:GET 一个 JSON 端点。失败抛错,交由调用方的 withAuth 统一转 500。 */
export async function prAgentGetJson<T>(path: string): Promise<T> {
  const response = await prAgentFetch(path)
  if (!response.ok) {
    throw new Error(`pr-agent ${path} 返回 ${response.status}`)
  }
  return (await response.json()) as T
}
