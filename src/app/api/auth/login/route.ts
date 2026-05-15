import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { setSessionCookie, verifyPassword } from '@/lib/auth'

const schema = z.object({
  password: z.string().min(1),
})

export async function POST(request: NextRequest) {
  const body = schema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (!verifyPassword(body.data.password)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  await setSessionCookie()
  return NextResponse.json({ success: true })
}
