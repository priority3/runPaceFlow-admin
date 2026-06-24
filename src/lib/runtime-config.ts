import { getSettingsMap } from '@/lib/store'

/**
 * admin 版运行时配置读取
 *
 * Reason: 主站的 runtime-config/server.ts 是"从 admin 回源拉配置"。admin 自己就是配置源,
 * 直接读配置库(app_settings 表)即可,省掉 HTTP 回源。搬迁来的 sync/service.ts 调用
 * getRuntimeSettings() 拿 STRAVA / DATABASE 等凭据,这里用 getSettingsMap() 返回。
 *
 * 同时合并 process.env(env 优先级低于库内配置,保持与主站 mergeRuntimeSettings 一致的语义:
 * 库内显式配置覆盖 env)。
 */
export async function getRuntimeSettings(
  _opts: { force?: boolean } = {},
): Promise<Record<string, string>> {
  const fromEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') fromEnv[k] = v
  }

  let fromDb: Record<string, string> = {}
  try {
    fromDb = await getSettingsMap()
  } catch (error) {
    console.warn('[runtime-config] 读取配置库失败,回退 process.env:', (error as Error).message)
  }

  // 库内非空值覆盖 env
  const merged = { ...fromEnv }
  for (const [k, v] of Object.entries(fromDb)) {
    if (v !== undefined && v !== null && v !== '') merged[k] = v
  }
  return merged
}

export async function getRuntimeSetting(key: string): Promise<string> {
  const settings = await getRuntimeSettings()
  return settings[key] ?? ''
}
