/**
 * Connectivity Test API
 *
 * GET /api/health/connectivity
 * Verifies admin ↔ frontend connection.
 * Useful for diagnosing "no data" issues.
 */

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type ConnectivityResult = {
  ok: boolean
  latencyMs?: number
  status?: number
  url?: string
  error?: string
}

type RuntimeConfig = {
  adminUrl?: string | null
  appUrl?: string | null
  updatedAt?: string | null
}

export async function GET() {
  const frontendUrl = process.env.RUNPACEFLOW_FRONTEND_URL || 'http://127.0.0.1:3000'
  const results: Record<string, ConnectivityResult> = {}
  let runtimeConfig: RuntimeConfig | null = null

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

  // Test 2: Can admin reach the frontend runtime config endpoint?
  const runtimeConfigUrl = `${frontendUrl}/api/runtime-config`
  try {
    const start = Date.now()
    const res = await fetch(runtimeConfigUrl, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    const latencyMs = Date.now() - start

    if (res.ok) {
      runtimeConfig = await res.json() as RuntimeConfig
      results.frontend_runtime_config = {
        ok: true,
        latencyMs,
        status: res.status,
        url: runtimeConfigUrl,
      }
    } else {
      results.frontend_runtime_config = {
        ok: false,
        latencyMs,
        status: res.status,
        url: runtimeConfigUrl,
        error: `HTTP ${res.status}`,
      }
    }
  } catch (e) {
    results.frontend_runtime_config = {
      ok: false,
      url: runtimeConfigUrl,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  // Test 3: Check whether the frontend runtime config points back to Admin.
  const adminUrl = runtimeConfig?.adminUrl || ''
  const frontendReachable = Object.values(results).every(r => r.ok)

  return NextResponse.json({
    frontendUrl,
    runtimeConfig,
    adminUrl: adminUrl || '(not set)',
    adminUrlConfigured: !!adminUrl,
    connectivity: results,
    frontendReachable,
    allPassed: frontendReachable && !!adminUrl,
    timestamp: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
