import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { dispatchPendingNotifications } from '@/lib/notifications/dispatcher'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (request) => {
  let limit = 10
  try {
    const body = await request.json()
    if (typeof body.limit === 'number') {
      limit = Math.min(Math.max(body.limit, 1), 50)
    }
  } catch {
    // 允许空 body
  }

  const result = await dispatchPendingNotifications(limit)
  return NextResponse.json(result)
})
