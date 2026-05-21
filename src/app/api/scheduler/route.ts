/**
 * Scheduler Config API
 *
 * GET /api/scheduler - List all jobs
 * PUT /api/scheduler - Update a job and reload scheduler
 */

import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { listJobs, updateJob } from '@/lib/scheduler-config'
import { reloadScheduler } from '@/lib/scheduler'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireAuth()
    const jobs = await listJobs()
    return NextResponse.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    await requireAuth()
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const body = await request.json()
  const { id, cronExpression, enabled } = body

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const updated = await updateJob(id, { cronExpression, enabled })
  if (!updated) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Reload scheduler with updated configuration
  try {
    await reloadScheduler()
  } catch (err) {
    console.warn('[Scheduler API] Failed to reload:', (err as Error).message)
  }

  return NextResponse.json({ job: updated })
}
