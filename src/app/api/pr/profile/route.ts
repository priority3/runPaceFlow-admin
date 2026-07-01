import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/api-helpers'
import { getFriendProfile, projectFriendProfile } from '@/lib/pr/memory'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async () => {
  let profile = await getFriendProfile()
  if (!profile) {
    await projectFriendProfile()
    profile = await getFriendProfile()
  }

  return NextResponse.json({ profile })
})
