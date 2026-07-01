import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { generateWeeklyReview } from '@/lib/pr/weekly'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (request) => {
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // 允许空 body
  }

  const result = await generateWeeklyReview({
    force: body.force === true,
    enqueueNotification: body.enqueueNotification !== false,
  })

  return NextResponse.json(result)
})
