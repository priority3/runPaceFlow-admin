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
  // Reason: DATABASE_URL 是 admin 自身的配置库路径,不应导出给主站——主站有自己的
  // DATABASE_URL(指向共享库),被覆盖会导致连接错误。
  const settings = allSettings.filter((s) => s.key !== 'DATABASE_URL')
  const envText = renderEnvText(settings)

  return new Response(`${envText}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
