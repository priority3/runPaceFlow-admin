/**
 * Scheduler Config API
 *
 * GET /api/scheduler - List all jobs
 * PUT /api/scheduler - Update a job and reload scheduler
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { listJobs, updateJob } from '@/lib/scheduler-config'
import { reloadScheduler } from '@/lib/scheduler'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async () => {
  const jobs = await listJobs()
  return NextResponse.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } })
})

export const PUT = withAuth(async (request) => {
  const body = await request.json()
  const { id, cronExpression, enabled } = body

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const updated = await updateJob(id, { cronExpression, enabled })
  if (!updated) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  try {
    await reloadScheduler()
  } catch (err) {
    console.warn('[Scheduler API] Failed to reload:', (err as Error).message)
  }

  return NextResponse.json({ job: updated })
})
