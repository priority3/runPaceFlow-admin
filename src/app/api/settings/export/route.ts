import { NextResponse, type NextRequest } from 'next/server'

import { verifyExportToken } from '@/lib/auth'
import { exportSettings } from '@/lib/store'
import { renderEnvText } from '@/lib/utils'

export async function GET(request: NextRequest) {
  if (!verifyExportToken(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const includeEmpty = request.nextUrl.searchParams.get('includeEmpty') === '1'
  const allSettings = await exportSettings({ includeEmpty })
  const envText = renderEnvText(allSettings)

  return new Response(`${envText}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
