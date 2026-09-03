import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { prAgentFetch, proxyToPrAgent } from '@/lib/pr-agent-client'

export const dynamic = 'force-dynamic'

/**
 * 把 pr-agent 返回的入口链接补成绝对地址。
 *
 * Reason: pr-agent 未配 PUBLIC_BASE_URL 时返回相对路径(/pr?t=...),二维码扫出来打不开。
 * 补全用 NEXT_PUBLIC_PR_AGENT_URL(对外地址)而不是 PR_AGENT_URL —— 后者是容器内服务名,
 * 手机根本访问不到。补全放在服务端:前端规范禁止客户端读 env。
 */
function absolutize(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  const base = (process.env.NEXT_PUBLIC_PR_AGENT_URL ?? '').trim().replace(/\/$/, '')
  return base ? `${base}${url}` : url
}

/**
 * 签发一次性入口链接。明文 token 只在这一次响应里出现,pr-agent 侧只留摘要 ——
 * 所以这里不做任何缓存,也不落日志。
 */
export const POST = withAuth(async request => {
  const body = await request.text()
  const upstream = await prAgentFetch('/api/pr/access/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body || '{}',
  })

  const json = (await upstream.json().catch(() => ({}))) as { url?: string }
  if (!upstream.ok) return NextResponse.json(json, { status: upstream.status })

  return NextResponse.json({ ...json, url: absolutize(json.url ?? '') })
})

/** 签发记录(不含明文/摘要)。 */
export const GET = withAuth(request => proxyToPrAgent(request, '/api/pr/access/links'))
