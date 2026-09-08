import { and, count, desc, eq, isNotNull, lt, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { activities, activityInsights, splits } from '@/lib/db/activities-schema'

export const MAIN_SITE_OPERATIONS = [
  'activities.list',
  'activities.listInfinite',
  'activities.getById',
  'activities.getSplits',
  'activities.getWithSplits',
  'activities.getGpxData',
  'activities.getStats',
  'activities.getMapRoutes',
  'insights.getForActivity',
] as const

const activityTypeSchema = z.enum(['running', 'cycling', 'walking'])
const activitySourceSchema = z.enum(['nike', 'strava', 'garmin'])

const listInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
    cursor: z.number().int().min(0).optional(),
    type: activityTypeSchema.optional(),
    source: activitySourceSchema.optional(),
  })
  .default({})

const listInfiniteInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z
      .object({
        startTime: z.coerce.date(),
        id: z.string().min(1),
      })
      .nullish(),
    type: activityTypeSchema.optional(),
    source: activitySourceSchema.optional(),
  })
  .default({})

const idInputSchema = z.object({ id: z.string().min(1) })
const splitsInputSchema = z.object({ activityId: z.string().min(1) })
const mapRoutesInputSchema = z
  .object({ limit: z.number().int().min(1).max(50).default(20) })
  .default({})
const insightInputSchema = z.object({ activityId: z.string().min(1) })
const emptyInputSchema = z.object({}).default({})

export const mainSiteQueryRequestSchema = z.object({
  operation: z.enum(MAIN_SITE_OPERATIONS),
  input: z.unknown().optional(),
})

export class MainSiteNotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'MainSiteNotFoundError'
  }
}

/**
 * Keep the list response small. GPX is several hundred KB to MB per activity
 * and is fetched by its own operation only when the detail map needs it.
 */
const activityColumnsWithoutGpx = {
  id: activities.id,
  title: activities.title,
  type: activities.type,
  source: activities.source,
  sourceId: activities.sourceId,
  startTime: activities.startTime,
  endTime: activities.endTime,
  duration: activities.duration,
  distance: activities.distance,
  averagePace: activities.averagePace,
  bestPace: activities.bestPace,
  elevationGain: activities.elevationGain,
  averageHeartRate: activities.averageHeartRate,
  maxHeartRate: activities.maxHeartRate,
  calories: activities.calories,
  isIndoor: activities.isIndoor,
  raceName: activities.raceName,
  weatherData: activities.weatherData,
  createdAt: activities.createdAt,
  updatedAt: activities.updatedAt,
}

function getDateRanges() {
  const now = new Date()
  now.setHours(23, 59, 59, 999)

  const oneWeekAgo = new Date(now)
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
  oneWeekAgo.setHours(0, 0, 0, 0)

  const twoWeeksAgo = new Date(now)
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
  twoWeeksAgo.setHours(0, 0, 0, 0)

  const oneMonthAgo = new Date(now)
  oneMonthAgo.setDate(oneMonthAgo.getDate() - 30)
  oneMonthAgo.setHours(0, 0, 0, 0)

  const twoMonthsAgo = new Date(now)
  twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60)
  twoMonthsAgo.setHours(0, 0, 0, 0)

  return { now, oneWeekAgo, twoWeeksAgo, oneMonthAgo, twoMonthsAgo }
}

type StatsActivity = {
  type: string
  distance: number
  duration: number
  elevationGain: number | null
  startTime: Date
  averagePace: number | null
}

function summarizePeriodActivities(periodActivities: StatsActivity[]) {
  return {
    activities: periodActivities.length,
    distance: periodActivities.reduce((sum, activity) => sum + (activity.distance || 0), 0),
    duration: periodActivities.reduce((sum, activity) => sum + (activity.duration || 0), 0),
  }
}

function calculateDailyTrend(
  allActivities: Array<Pick<StatsActivity, 'startTime' | 'distance'>>,
  days: number,
) {
  const now = new Date()
  now.setHours(23, 59, 59, 999)
  const dailyData: number[] = []

  for (let i = days - 1; i >= 0; i -= 1) {
    const dayStart = new Date(now)
    dayStart.setDate(dayStart.getDate() - i)
    dayStart.setHours(0, 0, 0, 0)

    const dayEnd = new Date(dayStart)
    dayEnd.setHours(23, 59, 59, 999)

    dailyData.push(
      allActivities
        .filter(activity => activity.startTime >= dayStart && activity.startTime <= dayEnd)
        .reduce((sum, activity) => sum + (activity.distance || 0), 0),
    )
  }

  return dailyData
}

function summarizeActivityStats(
  sourceActivities: StatsActivity[],
  ranges: Pick<
    ReturnType<typeof getDateRanges>,
    'oneWeekAgo' | 'twoWeeksAgo' | 'oneMonthAgo' | 'twoMonthsAgo'
  >,
) {
  const totalDistance = sourceActivities.reduce((sum, activity) => sum + (activity.distance || 0), 0)
  const totalDuration = sourceActivities.reduce((sum, activity) => sum + (activity.duration || 0), 0)
  const totalElevation = sourceActivities.reduce(
    (sum, activity) => sum + (activity.elevationGain || 0),
    0,
  )
  const activitiesWithPace = sourceActivities.filter(activity => activity.averagePace && activity.averagePace > 0)
  const averagePace =
    activitiesWithPace.length > 0
      ? activitiesWithPace.reduce((sum, activity) => sum + (activity.averagePace || 0), 0) /
        activitiesWithPace.length
      : 0

  const thisWeekActivities = sourceActivities.filter(activity => activity.startTime > ranges.oneWeekAgo)
  const lastWeekActivities = sourceActivities.filter(activity => {
    return activity.startTime > ranges.twoWeeksAgo && activity.startTime <= ranges.oneWeekAgo
  })
  const thisMonthActivities = sourceActivities.filter(activity => activity.startTime > ranges.oneMonthAgo)
  const lastMonthActivities = sourceActivities.filter(activity => {
    return activity.startTime > ranges.twoMonthsAgo && activity.startTime <= ranges.oneMonthAgo
  })

  return {
    total: {
      activities: sourceActivities.length,
      distance: totalDistance,
      duration: totalDuration,
      elevation: totalElevation,
      averagePace,
    },
    thisWeek: summarizePeriodActivities(thisWeekActivities),
    lastWeek: summarizePeriodActivities(lastWeekActivities),
    thisMonth: summarizePeriodActivities(thisMonthActivities),
    lastMonth: summarizePeriodActivities(lastMonthActivities),
    weeklyTrend: calculateDailyTrend(sourceActivities, 7),
  }
}

async function queryList(input: z.infer<typeof listInputSchema>) {
  const db = await getActivitiesDb()
  const offset = typeof input.cursor === 'number' ? input.cursor : input.offset
  const conditions: SQL[] = []
  if (input.type) conditions.push(eq(activities.type, input.type))
  if (input.source) conditions.push(eq(activities.source, input.source))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const query = db
    .select(activityColumnsWithoutGpx)
    .from(activities)
    .orderBy(desc(activities.startTime))
    .limit(input.limit)
    .offset(offset)
  const result = await (where ? query.where(where) : query)

  const totalResult = await (where
    ? db.select({ value: count() }).from(activities).where(where)
    : db.select({ value: count() }).from(activities))
  const total = totalResult[0]?.value ?? 0

  return {
    activities: result,
    pagination: { total, limit: input.limit, offset, hasMore: offset + input.limit < total },
  }
}

async function queryListInfinite(input: z.infer<typeof listInfiniteInputSchema>) {
  const db = await getActivitiesDb()
  const filterConditions: SQL[] = []
  if (input.type) filterConditions.push(eq(activities.type, input.type))
  if (input.source) filterConditions.push(eq(activities.source, input.source))
  const filtersWhere = filterConditions.length > 0 ? and(...filterConditions) : undefined

  const cursorCondition = input.cursor
    ? or(
        lt(activities.startTime, input.cursor.startTime),
        and(
          eq(activities.startTime, input.cursor.startTime),
          lt(activities.id, input.cursor.id),
        ),
      )
    : undefined
  const pageConditions = cursorCondition
    ? [...filterConditions, cursorCondition]
    : filterConditions
  const pageWhere = pageConditions.length > 0 ? and(...pageConditions) : undefined

  const query = db
    .select(activityColumnsWithoutGpx)
    .from(activities)
    .orderBy(desc(activities.startTime), desc(activities.id))
    .limit(input.limit + 1)
  const result = await (pageWhere ? query.where(pageWhere) : query)
  const activitiesPage = result.slice(0, input.limit)
  const last = activitiesPage.at(-1)
  const nextCursor = result.length > input.limit && last
    ? { startTime: last.startTime, id: last.id }
    : null

  const totalResult = await (filtersWhere
    ? db.select({ value: count() }).from(activities).where(filtersWhere)
    : db.select({ value: count() }).from(activities))

  return { activities: activitiesPage, nextCursor, total: totalResult[0]?.value ?? 0 }
}

async function queryById(input: z.infer<typeof idInputSchema>) {
  const db = await getActivitiesDb()
  const result = await db.select().from(activities).where(eq(activities.id, input.id)).limit(1)
  if (!result[0]) throw new MainSiteNotFoundError('Activity not found')
  return result[0]
}

async function querySplits(input: z.infer<typeof splitsInputSchema>) {
  const db = await getActivitiesDb()
  return db
    .select()
    .from(splits)
    .where(eq(splits.activityId, input.activityId))
    .orderBy(splits.kilometer)
}

async function queryWithSplits(input: z.infer<typeof idInputSchema>) {
  const db = await getActivitiesDb()
  const activity = await db
    .select(activityColumnsWithoutGpx)
    .from(activities)
    .where(eq(activities.id, input.id))
    .limit(1)
  if (!activity[0]) throw new MainSiteNotFoundError('Activity not found')

  const activitySplits = await db
    .select()
    .from(splits)
    .where(eq(splits.activityId, input.id))
    .orderBy(splits.kilometer)
  return { activity: activity[0], splits: activitySplits }
}

async function queryGpxData(input: z.infer<typeof idInputSchema>) {
  const db = await getActivitiesDb()
  const result = await db
    .select({ gpxData: activities.gpxData })
    .from(activities)
    .where(eq(activities.id, input.id))
    .limit(1)
  return result[0]?.gpxData ?? null
}

async function queryStats() {
  const db = await getActivitiesDb()
  const allActivities = await db
    .select({
      type: activities.type,
      distance: activities.distance,
      duration: activities.duration,
      elevationGain: activities.elevationGain,
      startTime: activities.startTime,
      averagePace: activities.averagePace,
    })
    .from(activities)

  const ranges = getDateRanges()
  const runningActivities = allActivities.filter(activity => activity.type === 'running')
  const cyclingActivities = allActivities.filter(activity => activity.type === 'cycling')
  return {
    ...summarizeActivityStats(allActivities, ranges),
    byType: {
      running: summarizeActivityStats(runningActivities, ranges),
      cycling: summarizeActivityStats(cyclingActivities, ranges),
    },
  }
}

async function queryMapRoutes(input: z.infer<typeof mapRoutesInputSchema>) {
  const db = await getActivitiesDb()
  const routeColumns = {
    id: activities.id,
    type: activities.type,
    startTime: activities.startTime,
    routeCoordinates: activities.routeCoordinates,
    averagePace: activities.averagePace,
  }
  const loadRoutesByType = (type: 'running' | 'cycling') =>
    db
      .select(routeColumns)
      .from(activities)
      .where(
        and(
          eq(activities.isIndoor, false),
          eq(activities.type, type),
          isNotNull(activities.routeCoordinates),
        ),
      )
      .orderBy(desc(activities.startTime))
      .limit(input.limit)

  const [runningRoutes, cyclingRoutes] = await Promise.all([
    loadRoutesByType('running'),
    loadRoutesByType('cycling'),
  ])
  const selectedRoutes = [
    ...runningRoutes.slice(0, Math.ceil(input.limit / 2)),
    ...cyclingRoutes.slice(0, Math.floor(input.limit / 2)),
  ]
  const selectedIds = new Set(selectedRoutes.map(route => route.id))
  const remainingRoutes = [...runningRoutes, ...cyclingRoutes].sort(
    (left, right) => right.startTime.getTime() - left.startTime.getTime(),
  )
  for (const route of remainingRoutes) {
    if (selectedRoutes.length >= input.limit || selectedIds.has(route.id)) continue
    selectedRoutes.push(route)
    selectedIds.add(route.id)
  }

  return selectedRoutes
    .sort((left, right) => right.startTime.getTime() - left.startTime.getTime())
    .flatMap(activity => {
      try {
        const raw = JSON.parse(activity.routeCoordinates!) as [number, number][]
        const coordinates = raw.map(([lat, lng]) => ({ lat, lng }))
        if (coordinates.length === 0) return []
        return [{ id: activity.id, type: activity.type, coordinates, averagePace: activity.averagePace }]
      } catch {
        return []
      }
    })
}

async function queryInsight(input: z.infer<typeof insightInputSchema>) {
  const db = await getActivitiesDb()
  const cached = await db
    .select()
    .from(activityInsights)
    .where(eq(activityInsights.activityId, input.activityId))
    .limit(1)
  if (!cached[0]) return null
  return {
    content: cached[0].content,
    generatedAt: cached[0].generatedAt,
    model: cached[0].model,
    cached: true,
  }
}

export async function executeMainSiteQuery(
  operation: z.infer<typeof mainSiteQueryRequestSchema>['operation'],
  input: unknown,
) {
  switch (operation) {
    case 'activities.list':
      return queryList(listInputSchema.parse(input ?? {}))
    case 'activities.listInfinite':
      return queryListInfinite(listInfiniteInputSchema.parse(input ?? {}))
    case 'activities.getById':
      return queryById(idInputSchema.parse(input ?? {}))
    case 'activities.getSplits':
      return querySplits(splitsInputSchema.parse(input ?? {}))
    case 'activities.getWithSplits':
      return queryWithSplits(idInputSchema.parse(input ?? {}))
    case 'activities.getGpxData':
      return queryGpxData(idInputSchema.parse(input ?? {}))
    case 'activities.getStats':
      emptyInputSchema.parse(input ?? {})
      return queryStats()
    case 'activities.getMapRoutes':
      return queryMapRoutes(mapRoutesInputSchema.parse(input ?? {}))
    case 'insights.getForActivity':
      return queryInsight(insightInputSchema.parse(input ?? {}))
  }
}
