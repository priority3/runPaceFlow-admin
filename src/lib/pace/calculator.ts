/**
 * 配速计算器
 * 提供各种配速相关的计算功能
 */

/**
 * 计算配速（秒/公里）
 * @param distance 距离（米）
 * @param duration 时长（秒）
 * @returns 配速（秒/公里）
 */
export function calculatePace(distance: number, duration: number): number {
  if (distance <= 0) return 0
  return (duration / distance) * 1000 // 秒/公里
}

/**
 * 格式化配速为 MM:SS
 * @param paceInSeconds 配速（秒/公里）
 * @param includeUnit 是否包含单位 /km（默认 false）
 * @returns 格式化的配速字符串
 */
export function formatPace(paceInSeconds: number, includeUnit = false): string {
  const minutes = Math.floor(paceInSeconds / 60)
  const seconds = Math.floor(paceInSeconds % 60)
  const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`
  return includeUnit ? `${formatted}/km` : formatted
}

/**
 * 格式化时长为 HH:MM:SS 或 MM:SS
 * @param seconds 秒数
 * @returns 格式化的时长字符串
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * 格式化距离
 * @param meters 米
 * @param precision 小数位数
 * @returns 格式化的距离字符串
 */
export function formatDistance(meters: number, precision = 2): string {
  const km = meters / 1000
  return `${km.toFixed(precision)} km`
}

/**
 * 配速区间定义
 */
export interface PaceZone {
  name: string
  minPace: number // 秒/公里
  maxPace: number // 秒/公里
  color: string
}

