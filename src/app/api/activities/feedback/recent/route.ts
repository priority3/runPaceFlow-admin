import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { listSubjectiveFeedbackForActivity } from '@/lib/pr/feedback'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const activityId = url.searchParams.get('activityId')
  if (!activityId) {
    return NextResponse.json({ error: 'activityId is required' }, { status: 400 })
  }

  const feedback = await listSubjectiveFeedbackForActivity(activityId, 10)
  return NextResponse.json({ feedback })
})
