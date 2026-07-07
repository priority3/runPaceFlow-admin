/**
 * 提供 PR 对话上传的图片。GET /api/pr/image/<name>?t=<PR_CHAT_TOKEN>
 * 认证走查询串 token(浏览器 <img> 无法带 Authorization 头),token 与 PR_CHAT_TOKEN 比对。
 */
import { NextResponse } from 'next/server'

import { safeEqual } from '@/lib/crypto'
import { readImageUpload } from '@/lib/pr/uploads'
import { getRuntimeSetting } from '@/lib/runtime-config'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const t = new URL(request.url).searchParams.get('t') ?? ''

  let expected = ''
  try {
    expected = await getRuntimeSetting('PR_CHAT_TOKEN')
  } catch {
    /* token 读取失败即视为未授权 */
  }
  if (!expected || !safeEqual(t, expected)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const img = await readImageUpload(name)
  if (!img) return new NextResponse('Not found', { status: 404 })

  return new NextResponse(new Uint8Array(img.bytes), {
    status: 200,
    headers: { 'Content-Type': img.mediaType, 'Cache-Control': 'private, max-age=86400' },
  })
}
