import { NextResponse } from 'next/server'

import { ensureSchema } from '@/lib/db'
import { startScheduler } from '@/lib/scheduler'

export async function GET() {
  try {
    await ensureSchema()
    startScheduler()
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
