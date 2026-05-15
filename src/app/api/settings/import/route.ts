import { NextResponse, type NextRequest } from 'next/server'

import { verifyExportToken } from '@/lib/auth'
import { importSettings } from '@/lib/store'
import { parseEnvText } from '@/lib/utils'

export async function POST(request: NextRequest) {
  if (!verifyExportToken(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const text = await request.text()
  const count = await importSettings(parseEnvText(text))

  return NextResponse.json({ success: true, count })
}
