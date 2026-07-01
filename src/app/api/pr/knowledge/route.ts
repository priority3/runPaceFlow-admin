import { NextResponse } from 'next/server'

import { withAuth, validateBody } from '@/lib/api-helpers'
import { ingestKnowledgeDocument } from '@/lib/pr/rag'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (request) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const invalid = validateBody(body, ['title', 'content'])
  if (invalid) return invalid

  const result = await ingestKnowledgeDocument({
    title: String(body.title),
    content: String(body.content),
    source: typeof body.source === 'string' ? body.source : null,
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : null,
  })

  return NextResponse.json(result)
})
