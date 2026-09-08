import { NextResponse } from 'next/server'

import { withMainSiteAuth } from '@/lib/api-helpers'
import { getMainSitePublicConfig } from '@/lib/main-site/public-config'

export const dynamic = 'force-dynamic'

export const GET = withMainSiteAuth(async () => {
  const config = await getMainSitePublicConfig()
  return NextResponse.json(config, { headers: { 'Cache-Control': 'no-store' } })
})
