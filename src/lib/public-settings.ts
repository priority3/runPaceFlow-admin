import { SETTING_DEFINITIONS } from './settings'
import { listSettings } from './store'

// Include NEXT_PUBLIC_ keys AND RUNPACEFLOW_ADMIN_URL (which the frontend needs for analytics)
const PUBLIC_SETTING_KEYS = new Set([
  ...SETTING_DEFINITIONS.filter((definition) => definition.key.startsWith('NEXT_PUBLIC_')).map(
    (definition) => definition.key,
  ),
  'RUNPACEFLOW_ADMIN_URL',
])

export async function getPublicSettings() {
  const settings = await listSettings()
  const entries = settings
    .filter((setting) => PUBLIC_SETTING_KEYS.has(setting.key))
    .map((setting) => [setting.key, setting.value] as const)

  return Object.fromEntries(entries)
}
