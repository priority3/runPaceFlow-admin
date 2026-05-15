import { createHmac, randomBytes } from 'node:crypto'

import { cookies } from 'next/headers'

import { safeEqual } from './crypto'

const COOKIE_NAME = 'runpaceflow_admin_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.SETTINGS_ENCRYPTION_KEY
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET is required')
  }
  return secret
}

function sign(payload: string) {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url')
}

function createSessionToken() {
  const payload = JSON.stringify({
    sub: 'admin',
    nonce: randomBytes(16).toString('base64url'),
    exp: Date.now() + MAX_AGE_SECONDS * 1000,
  })
  const encodedPayload = Buffer.from(payload).toString('base64url')
  return `${encodedPayload}.${sign(encodedPayload)}`
}

function verifySessionToken(token?: string) {
  if (!token) return false

  const [payload, signature] = token.split('.')
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return false

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number
    }
    return typeof parsed.exp === 'number' && parsed.exp > Date.now()
  } catch {
    return false
  }
}

export async function isAuthenticated() {
  const cookieStore = await cookies()
  return verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)
}

export async function requireAuth() {
  if (!(await isAuthenticated())) {
    throw new Error('Unauthorized')
  }
}

export async function setSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

export function verifyPassword(password: string) {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) {
    throw new Error('ADMIN_PASSWORD is required')
  }
  return safeEqual(password, expected)
}

export function verifyExportToken(headerValue: string | null) {
  const expected = process.env.CONFIG_EXPORT_TOKEN
  if (!expected) return false

  const prefix = 'Bearer '
  if (!headerValue?.startsWith(prefix)) return false

  return safeEqual(headerValue.slice(prefix.length), expected)
}
