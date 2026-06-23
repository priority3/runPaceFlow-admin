'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { clearSessionCookie, requireAuth, setSessionCookie, verifyPassword } from '@/lib/auth'
import { parseEnvText, renderEnvText } from '@/lib/utils'
import { exportSettings, importSettings, updateSettings } from '@/lib/store'

const loginSchema = z.object({
  password: z.string().min(1),
})

export async function loginAction(_: unknown, formData: FormData) {
  const parsed = loginSchema.safeParse({
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: '请输入登录密码' }
  }

  try {
    if (!verifyPassword(parsed.data.password)) {
      return { error: '密码不正确' }
    }
    await setSessionCookie()
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '登录失败',
    }
  }

  redirect('/')
}

export async function logoutAction() {
  await clearSessionCookie()
  redirect('/login')
}

export interface SaveSettingsState {
  ok: boolean
  message: string
  savedCount: number
  // Reason: 时间戳让前端能在内容不变时也感知"又保存了一次"，并展示保存时刻
  savedAt: number
}

export async function saveSettingsAction(
  _prevState: SaveSettingsState | null,
  formData: FormData,
): Promise<SaveSettingsState> {
  await requireAuth()

  const entries: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && key.startsWith('setting:')) {
      entries[key.slice('setting:'.length)] = value.trim()
    }
  }

  try {
    await updateSettings(entries)
    revalidatePath('/')
    const savedCount = Object.keys(entries).length
    return {
      ok: true,
      message: `已保存 ${savedCount} 项配置`,
      savedCount,
      savedAt: Date.now(),
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '保存失败，请重试',
      savedCount: 0,
      savedAt: Date.now(),
    }
  }
}

export async function importEnvAction(_: unknown, formData: FormData) {
  await requireAuth()

  const envText = String(formData.get('envText') ?? '')
  const count = await importSettings(parseEnvText(envText))
  revalidatePath('/')

  return { message: `已导入 ${count} 个配置项` }
}

export async function exportEnvAction() {
  await requireAuth()
  const entries = await exportSettings()
  return renderEnvText(entries)
}
