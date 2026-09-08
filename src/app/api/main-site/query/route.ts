import { NextResponse } from 'next/server'
import { z } from 'zod'

import { withMainSiteAuth } from '@/lib/api-helpers'
import {
  executeMainSiteQuery,
  MainSiteNotFoundError,
  mainSiteQueryRequestSchema,
} from '@/lib/main-site/queries'

export const dynamic = 'force-dynamic'

export const POST = withMainSiteAuth(async request => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = mainSiteQueryRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const data = await executeMainSiteQuery(parsed.data.operation, parsed.data.input)
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid query input', issues: error.issues },
        { status: 400 },
      )
    }
    if (error instanceof MainSiteNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    throw error
  }
})
