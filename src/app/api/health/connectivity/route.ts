/**
 * Connectivity Test API
 *
 * GET /api/health/connectivity
 * Verifies admin ↔ frontend connection.
 * Useful for diagnosing "no data" issues.
 */

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const frontendUrl = process.env.RUNPACEFLOW_FRONTEND_URL || 'http://127.0.0.1:3000'
  const results: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {}

  // Test 1: Can admin reach frontend root?
  try {
    const start = Date.now()
    const res = await fetch(frontendUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    })
    results.frontend_root = {
      ok: res.ok,
      latencyMs: Date.now() - start,
    }
  } catch (e) {
    results.frontend_root = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  // Test 2: Can admin reach frontend tRPC?
  try {
    const start = Date.now()
    const res = await fetch(`${frontendUrl}/api/trpc/activities.getStats?input=${encodeURIComponent(JSON.stringify({}))}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    results.frontend_trpc = {
      ok: res.ok,
      latencyMs: Date.now() - start,
    }
  } catch (e) {
    results.frontend_trpc = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  // Test 3: Can admin reach frontend health?
  try {
    const start = Date.now()
    const res = await fetch(`${frontendUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    })
    results.frontend_health = {
      ok: res.ok,
      latencyMs: Date.now() - start,
    }
  } catch (e) {
    results.frontend_health = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  // Test 4: Check if NEXT_PUBLIC_ADMIN_URL is set (for frontend beacon)
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL || ''

  return NextResponse.json({
    frontendUrl,
    adminUrl: adminUrl || '(not set)',
    adminUrlConfigured: !!adminUrl,
    connectivity: results,
    allPassed: Object.values(results).every(r => r.ok),
    timestamp: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
