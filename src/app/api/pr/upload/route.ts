/**
 * PR 对话图片上传。POST multipart/form-data(字段 file)。
 * 认证:admin 会话 或 Bearer PR_CHAT_TOKEN(与 /api/pr/chat 一致)。
 */
import { NextResponse } from 'next/server'

import { withPrChatAuth } from '@/lib/api-helpers'
import { SUPPORTED_IMAGE_TYPES, saveImageUpload } from '@/lib/pr/uploads'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 10 * 1024 * 1024

export const POST = withPrChatAuth(async (request) => {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: '需要 multipart/form-data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少 file 字段' }, { status: 400 })
  }
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `不支持的图片类型: ${file.type || '未知'}(支持 jpg/png/gif/webp)` },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '图片太大(上限 10MB)' }, { status: 400 })
  }
  const bytes = Buffer.from(await file.arrayBuffer())
  const { url } = await saveImageUpload(bytes, file.type)
  return NextResponse.json({ url })
})
