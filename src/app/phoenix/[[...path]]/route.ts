/**
 * Phoenix 反向代理(挂在 admin 的 /phoenix 路由下,复用 admin 登录态)。
 *
 * 为什么这么做:Phoenix 自身零鉴权且 trace 含健康数据,不能裸暴露公网。放在这里 →
 * Phoenix 仍只绑服务器回环(127.0.0.1:6006),唯一的公网入口是这个需要 admin 会话的路由。
 * Phoenix 以 PHOENIX_HOST_ROOT_PATH=/phoenix 运行,前端资源/接口都在 /phoenix 前缀下,
 * 浏览器请求 runpaceflow-admin.razet.me/phoenix/* 命中本代理,鉴权后转发到 Phoenix。
 *
 * 已知限制:GraphQL 订阅走 WebSocket,路由处理器无法代理 → 实时刷新失效(手动刷新可见新
 * trace);其余(SPA、GraphQL 查询、OTLP 无关)均正常。
 */
import { isAuthenticated } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const PHOENIX_ORIGIN = process.env.PHOENIX_INTERNAL_ORIGIN || 'http://127.0.0.1:6006'
const ROOT_PATH = '/phoenix'
// 逐跳头:不应在代理两端透传,否则破坏连接/编码语义
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'content-encoding', // fetch 已自动解压,保留会让浏览器二次解压导致乱码
])

async function proxy(request: Request, ctx: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  if (!(await isAuthenticated())) {
    return new Response('未登录。请先登录 admin 再访问 /phoenix。', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  const { path = [] } = await ctx.params
  const search = new URL(request.url).search
  const suffix = path.length ? `/${path.join('/')}` : ''
  const target = `${PHOENIX_ORIGIN}${ROOT_PATH}${suffix}${search}`

  const headers = new Headers(request.headers)
  for (const key of HOP_BY_HOP) headers.delete(key)

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual', // 3xx(如尾斜杠跳转)原样回传,由浏览器在同源下再次命中本代理
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer()
  }

  let upstream: Response
  try {
    upstream = await fetch(target, init)
  } catch (error) {
    return new Response(`Phoenix 暂时不可达:${(error as Error).message}`, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  const respHeaders = new Headers(upstream.headers)
  for (const key of HOP_BY_HOP) respHeaders.delete(key)
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const HEAD = proxy
export const OPTIONS = proxy
