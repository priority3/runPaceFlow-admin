/**
 * API Route Helpers
 *
 * Wraps route handlers with auth and standardized error responses.
 */

import { NextResponse } from 'next/server'

import { isAuthenticated, requireAuth } from './auth'
import { safeEqual } from './crypto'
import { getRuntimeSetting } from './runtime-config'

type RouteHandler<TContext = unknown> = (
  request: Request,
  context?: TContext,
) => Promise<Response | NextResponse>

/**
 * Extracts a Bearer token from an Authorization header value.
 * Returns null when absent or malformed.
 */
function extractBearerToken(headerValue: string | null): string | null {
  const prefix = 'Bearer '
  if (!headerValue?.startsWith(prefix)) return null
  const token = headerValue.slice(prefix.length).trim()
  return token.length > 0 ? token : null
}

/**
 * Wraps a route handler with authentication and error handling.
 * Returns 401 for auth failures, 500 for unexpected errors.
 */
export function withAuth<TContext = unknown>(handler: RouteHandler<TContext>): RouteHandler<TContext> {
  return async (request: Request, context?: TContext) => {
    try {
      await requireAuth()
      return await handler(request, context)
    } catch (error) {
      if (error instanceof Error && error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal error' },
        { status: 500 },
      )
    }
  }
}

/**
 * Wraps a route handler for external data-reporting endpoints (e.g. HealthKit / iOS
 * Shortcuts sleep upload). Authorizes the request when EITHER a valid admin session
 * cookie is present OR the Authorization Bearer token matches HEALTH_IMPORT_TOKEN.
 *
 * Reason: reporting devices cannot present the admin session cookie, so they
 * authenticate with a shared token configured in the admin settings; the dashboard
 * keeps working via its session cookie.
 */
export function withHealthImportAuth<TContext = unknown>(
  handler: RouteHandler<TContext>,
): RouteHandler<TContext> {
  return async (request: Request, context?: TContext) => {
    try {
      // Reason: resolve the token defensively — getRuntimeSetting already falls back
      // to process.env when the admin config store is down, but we never let a config
      // lookup failure turn into a 500 on the ingest path. An empty token simply means
      // token auth is unavailable, and we fall back to admin-session auth.
      let expectedToken = ''
      try {
        expectedToken = await getRuntimeSetting('HEALTH_IMPORT_TOKEN')
      } catch (error) {
        console.warn('[health-import] 读取上报 Token 失败:', (error as Error).message)
      }

      const providedToken = extractBearerToken(request.headers.get('authorization'))
      const tokenOk =
        expectedToken.length > 0 && providedToken != null && safeEqual(providedToken, expectedToken)
      const sessionOk = tokenOk ? false : await isAuthenticated()

      if (!tokenOk && !sessionOk) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      return await handler(request, context)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal error' },
        { status: 500 },
      )
    }
  }
}

/**
 * Auth wrapper for DYNAMIC route segments (e.g. `[id]`, `[runId]`).
 *
 * Reason: Next.js's build-time route validator requires a dynamic handler's second
 * argument to be exactly `{ params: Promise<P> }` (required, non-optional). The generic
 * `withAuth` exposes an optional `context?` param, which the validator rejects with
 * "invalid GET export ... Expected RouteContext". This variant types the context
 * precisely so `next build` accepts it, while keeping the same auth + error handling.
 */
export function withAuthParams<P>(
  handler: (
    request: Request,
    context: { params: Promise<P> },
  ) => Promise<Response | NextResponse>,
) {
  return async (
    request: Request,
    context: { params: Promise<P> },
  ): Promise<Response | NextResponse> => {
    try {
      await requireAuth()
      return await handler(request, context)
    } catch (error) {
      if (error instanceof Error && error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal error' },
        { status: 500 },
      )
    }
  }
}

/**
 * Validates required fields in request body. Returns error response if invalid.
 */
export function validateBody(body: Record<string, unknown>, required: string[]): NextResponse | null {
  for (const field of required) {
    if (body[field] == null || body[field] === '') {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 })
    }
  }
  return null
}
