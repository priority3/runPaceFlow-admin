import { getRuntimeSettings } from '@/lib/runtime-config'

const DEFAULT_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

function positiveNumber(settings: Record<string, string>, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = Number(settings[key])
    if (Number.isFinite(value) && value > 0) return value
  }
  return fallback
}

/** Public allowlist used by the main site; never return the settings map itself. */
export async function getMainSitePublicConfig() {
  const settings = await getRuntimeSettings()
  return {
    goals: {
      running: {
        weeklyDistance: positiveNumber(settings, ['NEXT_PUBLIC_WEEKLY_RUNNING_DISTANCE_GOAL', 'NEXT_PUBLIC_WEEKLY_DISTANCE_GOAL'], 10000),
        monthlyDistance: positiveNumber(settings, ['NEXT_PUBLIC_MONTHLY_RUNNING_DISTANCE_GOAL', 'NEXT_PUBLIC_MONTHLY_DISTANCE_GOAL'], 50000),
        weeklyDuration: positiveNumber(settings, ['NEXT_PUBLIC_WEEKLY_RUNNING_DURATION_GOAL', 'NEXT_PUBLIC_WEEKLY_DURATION_GOAL'], 3600),
        monthlyDuration: positiveNumber(settings, ['NEXT_PUBLIC_MONTHLY_RUNNING_DURATION_GOAL', 'NEXT_PUBLIC_MONTHLY_DURATION_GOAL'], 18000),
      },
      cycling: {
        weeklyDistance: positiveNumber(settings, ['NEXT_PUBLIC_WEEKLY_CYCLING_DISTANCE_GOAL'], 40000),
        monthlyDistance: positiveNumber(settings, ['NEXT_PUBLIC_MONTHLY_CYCLING_DISTANCE_GOAL'], 160000),
        weeklyDuration: positiveNumber(settings, ['NEXT_PUBLIC_WEEKLY_CYCLING_DURATION_GOAL'], 7200),
        monthlyDuration: positiveNumber(settings, ['NEXT_PUBLIC_MONTHLY_CYCLING_DURATION_GOAL'], 28800),
      },
    },
    mapStyle: settings.NEXT_PUBLIC_MAP_STYLE || DEFAULT_MAP_STYLE,
    adminUrl: settings.NEXT_PUBLIC_ADMIN_URL || '',
    updatedAt: new Date().toISOString(),
  }
}
