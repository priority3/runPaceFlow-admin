/**
 * A/B Test Configuration API
 *
 * GET /api/analytics/ab-test-config - List all tests
 * POST /api/analytics/ab-test-config - Create new test
 * PATCH /api/analytics/ab-test-config - Update test
 * DELETE /api/analytics/ab-test-config - Delete test
 *
 * Requires auth.
 */

import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { ensureSchema, getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface ABTestConfig {
  id: string
  name: string
  variants: string[]
  traffic: number
  enabled: boolean
  createdAt: string
}

export const GET = withAuth(async () => {
  await ensureSchema()

  const db = getDb()
  const result = await db.execute('SELECT * FROM ab_test_configs ORDER BY created_at DESC')

  const tests: ABTestConfig[] = result.rows.map(r => ({
    id: r.id as string,
    name: r.name as string,
    variants: JSON.parse(r.variants as string),
    traffic: Number(r.traffic),
    enabled: Boolean(r.enabled),
    createdAt: new Date((r.created_at as number) * 1000).toISOString(),
  }))

  return NextResponse.json({ tests })
})

export const POST = withAuth(async (request) => {
  await ensureSchema()

  const body = await request.json()
  const { name, variants } = body

  if (!name || !Array.isArray(variants) || variants.length < 2) {
    return NextResponse.json({ error: 'name and at least 2 variants required' }, { status: 400 })
  }

  const id = `ab_${Date.now().toString(36)}`
  const db = getDb()

  await db.execute({
    sql: `INSERT INTO ab_test_configs (id, name, variants, traffic, enabled, created_at)
          VALUES (?, ?, ?, 100, 1, unixepoch())`,
    args: [id, name, JSON.stringify(variants)],
  })

  return NextResponse.json({ ok: true, id })
})

export const PATCH = withAuth(async (request) => {
  await ensureSchema()

  const body = await request.json()
  const { id, enabled } = body

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const db = getDb()
  await db.execute({
    sql: 'UPDATE ab_test_configs SET enabled = ? WHERE id = ?',
    args: [enabled ? 1 : 0, id],
  })

  return NextResponse.json({ ok: true })
})

export const DELETE = withAuth(async (request) => {
  await ensureSchema()

  const body = await request.json()
  const { id } = body

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const db = getDb()
  await db.execute({
    sql: 'DELETE FROM ab_test_configs WHERE id = ?',
    args: [id],
  })

  return NextResponse.json({ ok: true })
})
