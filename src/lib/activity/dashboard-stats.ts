import { desc, eq } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { activities, syncLogs } from '@/lib/db/activities-schema'
import { getRuntimeSettings } from '@/lib/runtime-config'

export interface ActivityStats {
  total: { activities: number; distance: number; duration: number; elevation: number; averagePace: number }
  thisWeek: { activities: number; distance: number; duration: number }
  lastWeek: { activities: number; distance: number; duration: number }
  thisMonth: { activities: number; distance: number; duration: number }
  byType: {
    running: { total: { activities: number; distance: number } }
    cycling: { total: { activities: number; distance: number } }
  }
}

export interface SyncLogSummary {
  startedAt: string
  completedAt: string | null
  activitiesCount: number
  errorMessage: string | null
  status: string
}

export interface SyncStatus {
  strava: { hasCredentials: boolean; latestSync: SyncLogSummary | null }
}

type ActivityRow = {
  type: string
  startTime: Date | string
  duration: number
  distance: number
  elevationGain: number | null
}

function startOfToday(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfWeek(date = new Date()) {
  const d = startOfToday(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  return d
}

function startOfMonth(date = new Date()) {
  const d = startOfToday(date)
  d.setDate(1)
  return d
}

function normalizeDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function createBucket() {
  return { activities: 0, distance: 0, duration: 0, elevation: 0 }
}

function toSyncSummary(row: {
  startedAt: Date | string
  completedAt: Date | string | null
  activitiesCount: number | null
  errorMessage: string | null
  status: string
} | null): SyncLogSummary | null {
  if (!row) return null
  return {
    startedAt: normalizeDate(row.startedAt).toISOString(),
    completedAt: row.completedAt ? normalizeDate(row.completedAt).toISOString() : null,
    activitiesCount: Number(row.activitiesCount ?? 0),
    errorMessage: row.errorMessage ?? null,
    status: row.status,
  }
}

export async function getDashboardStats(): Promise<{ stats: ActivityStats; syncStatus: SyncStatus }> {
  return {
    stats: await getActivityStats(),
    syncStatus: await getSyncStatus(),
  }
}

export async function getActivityStats(): Promise<ActivityStats> {
  const db = await getActivitiesDb()
  const rows = await db
    .select({
      type: activities.type,
      startTime: activities.startTime,
      duration: activities.duration,
      distance: activities.distance,
      elevationGain: activities.elevationGain,
    })
    .from(activities)

  const total = createBucket()
  const thisWeek = createBucket()
  const lastWeek = createBucket()
  const thisMonth = createBucket()
  const running = createBucket()
  const cycling = createBucket()

  const now = new Date()
  const weekStart = startOfWeek(now)
  const lastWeekStart = new Date(weekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)
  const monthStart = startOfMonth(now)

  for (const row of rows as ActivityRow[]) {
    const startTime = normalizeDate(row.startTime)
    const distance = Number(row.distance ?? 0)
    const duration = Number(row.duration ?? 0)
    const elevation = Number(row.elevationGain ?? 0)

    const apply = (bucket: ReturnType<typeof createBucket>) => {
      bucket.activities += 1
      bucket.distance += distance
      bucket.duration += duration
      bucket.elevation += elevation
    }

    apply(total)
    if (startTime >= weekStart) {
      apply(thisWeek)
    } else if (startTime >= lastWeekStart && startTime < weekStart) {
      apply(lastWeek)
    }
    if (startTime >= monthStart) {
      apply(thisMonth)
    }

    if (row.type === 'running') {
      apply(running)
    } else if (row.type === 'cycling') {
      apply(cycling)
    }
  }

  return {
    total: {
      activities: total.activities,
      distance: total.distance,
      duration: total.duration,
      elevation: total.elevation,
      averagePace: total.distance > 0 ? (total.duration / total.distance) * 1000 : 0,
    },
    thisWeek: {
      activities: thisWeek.activities,
      distance: thisWeek.distance,
      duration: thisWeek.duration,
    },
    lastWeek: {
      activities: lastWeek.activities,
      distance: lastWeek.distance,
      duration: lastWeek.duration,
    },
    thisMonth: {
      activities: thisMonth.activities,
      distance: thisMonth.distance,
      duration: thisMonth.duration,
    },
    byType: {
      running: {
        total: {
          activities: running.activities,
          distance: running.distance,
        },
      },
      cycling: {
        total: {
          activities: cycling.activities,
          distance: cycling.distance,
        },
      },
    },
  }
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const db = await getActivitiesDb()
  const settings = await getRuntimeSettings()

  const latest = async (source: string) => {
    const rows = await db
      .select()
      .from(syncLogs)
      .where(eq(syncLogs.source, source))
      .orderBy(desc(syncLogs.startedAt))
      .limit(1)
    return toSyncSummary(rows[0] || null)
  }

  return {
    strava: {
      hasCredentials: !!(
        settings.STRAVA_CLIENT_ID &&
        settings.STRAVA_CLIENT_SECRET &&
        settings.STRAVA_REFRESH_TOKEN
      ),
      latestSync: await latest('strava'),
    },
  }
}
