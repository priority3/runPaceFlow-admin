/**
 * API Route Helpers
 *
 * Wraps route handlers with auth and standardized error responses.
 */

import { NextResponse } from 'next/server'

import { requireAuth } from './auth'

type RouteHandler = (request: Request) => Promise<Response | NextResponse>

/**
 * Wraps a route handler with authentication and error handling.
 * Returns 401 for auth failures, 500 for unexpected errors.
 */
export function withAuth(handler: RouteHandler): RouteHandler {
  return async (request: Request) => {
    try {
      await requireAuth()
      return await handler(request)
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
