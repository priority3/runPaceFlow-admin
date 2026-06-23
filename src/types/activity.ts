/**
 * 活动数据库类型(admin 版)
 *
 * 从搬迁来的 activities-schema 推断,供 sync/activity 命名等逻辑使用。
 */

import type { activities, splits } from '@/lib/db/activities-schema'

export type Activity = typeof activities.$inferSelect
export type NewActivity = typeof activities.$inferInsert

export type ActivityListItem = Omit<Activity, 'gpxData' | 'routeCoordinates'>

export type Split = typeof splits.$inferSelect
export type NewSplit = typeof splits.$inferInsert

export interface ActivityWithSplits {
  activity: Activity
  splits: Split[]
}

export interface ActivityStats {
  totalRuns: number
  totalDistance: number
  totalDuration: number
  averagePace: number
}
