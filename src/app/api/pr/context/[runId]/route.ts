import { NextResponse } from 'next/server'

import { withAuthParams } from '@/lib/api-helpers'
import { getContextSnapshotForRun } from '@/lib/pr/state'

export const dynamic = 'force-dynamic'

export const GET = withAuthParams<{ runId: string }>(async (_request, { params }) => {
  const { runId } = await params
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 })

  const snapshot = await getContextSnapshotForRun(runId)
  if (!snapshot) return NextResponse.json({ error: 'Context snapshot not found' }, { status: 404 })

  return NextResponse.json(snapshot)
})
