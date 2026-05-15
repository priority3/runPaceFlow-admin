import { NextResponse } from 'next/server'

import { getPublicSettings } from '@/lib/public-settings'

const PUBLIC_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_HEADERS })
}

export async function GET() {
  return NextResponse.json(
    {
      settings: await getPublicSettings(),
      updatedAt: new Date().toISOString(),
    },
    { headers: PUBLIC_HEADERS },
  )
}
