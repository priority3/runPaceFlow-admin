import { NextResponse } from 'next/server'

import { recordStravaEvent } from '@/lib/strava/events'
import { getRuntimeSettings } from '@/lib/runtime-config'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const settings = await getRuntimeSettings({ force: true })
  const verifyToken = settings.STRAVA_WEBHOOK_VERIFY_TOKEN || process.env.STRAVA_WEBHOOK_VERIFY_TOKEN
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && verifyToken && token === verifyToken && challenge) {
    return NextResponse.json({ 'hub.challenge': challenge })
  }

  return NextResponse.json({ error: 'Invalid Strava webhook challenge' }, { status: 403 })
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const event = await recordStravaEvent(body)
  return NextResponse.json({ received: true, event })
}
