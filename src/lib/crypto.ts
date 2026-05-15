import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function keyFromSecret(secret: string) {
  return createHash('sha256').update(secret).digest()
}

export function getEncryptionSecret() {
  return process.env.SETTINGS_ENCRYPTION_KEY || process.env.ADMIN_SESSION_SECRET || ''
}

export function encryptValue(value: string) {
  const secret = getEncryptionSecret()
  if (!secret) {
    throw new Error('SETTINGS_ENCRYPTION_KEY is required for sensitive settings')
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, keyFromSecret(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `enc:v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString(
    'base64',
  )}`
}

export function decryptValue(value: string) {
  if (!value.startsWith('enc:v1:')) return value

  const secret = getEncryptionSecret()
  if (!secret) {
    throw new Error('SETTINGS_ENCRYPTION_KEY is required to decrypt sensitive settings')
  }

  const [, , ivRaw, authTagRaw, encryptedRaw] = value.split(':')
  const decipher = createDecipheriv(ALGORITHM, keyFromSecret(secret), Buffer.from(ivRaw, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagRaw, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}
