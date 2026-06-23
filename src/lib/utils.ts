import { clsx, type ClassValue } from 'clsx'
import { customAlphabet } from 'nanoid'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 使用 nanoid 生成 21 字符 ID(供搬迁来的同步 processor/service 用)
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21)

export function generateId(prefix?: string): string {
  const id = nanoid()
  return prefix ? `${prefix}_${id}` : id
}

export function formatDateTime(value?: string | number | Date | null) {
  if (!value) return '从未'

  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function maskValue(value: string) {
  if (!value) return ''
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`
}

export function parseEnvText(text: string) {
  const entries: Record<string, string> = {}

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue

    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    entries[match[1]] = value
  }

  return entries
}

export function renderEnvText(entries: Array<{ key: string; value: string }>) {
  return entries
    .map(({ key, value }) => {
      if (/[\s#"'`$\\]/.test(value)) {
        return `${key}=${JSON.stringify(value)}`
      }
      return `${key}=${value}`
    })
    .join('\n')
}
