/**
 * 环境感知 provider:天气实况/预报、空气质量、时刻与日出日落 —— PR 回答
 * 「今天适合跑步吗」缺失的"身体之外"维度。设计:claudedocs/pr-agent-environment-context-design.md
 *
 * 地点:无手机定位,用「常跑地点」近似 —— app_settings/env 里 PR_HOME_LAT/PR_HOME_LNG
 * 显式配置优先;否则从最近室外活动的 GPX 起点聚类推导(0.02°≈2km 网格取众数)。
 * 数据:Open-Meteo forecast + air-quality(免费无 key,与活动回填天气同厂)。
 * 红线:查不到就渲染「暂无」,绝不让模型在无数据时输出环境数值。
 * 评测:PR_ENV_FIXTURE_JSON 注入 fixture,隔离评测不依赖真实外网(可复现)。
 */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { activities } from '@/lib/db/activities-schema'
import { getRuntimeSetting } from '@/lib/runtime-config'
import {
  fetchCurrentAirQuality,
  fetchForecast,
  type AirQualityData,
  type ForecastData,
  type ForecastHour,
} from '@/lib/weather/open-meteo'

import type { ContextBlock, ContextProvider } from './types'

interface HomeLocation {
  lat: number
  lng: number
  /** 呈现给模型的地点措辞,如「按你配置的家附近」「按常跑路线定位」。 */
  label: string
}

interface EnvPayload {
  location: HomeLocation
  forecast: ForecastData
  airQuality: AirQualityData | null
}

interface EnvFixture {
  location?: HomeLocation
  forecast: ForecastData
  airQuality?: AirQualityData | null
  /** 固定"现在"(YYYY-MM-DDTHH:mm),让评测输出可复现。 */
  nowLocal?: string
}

const LOCATION_TTL_MS = 6 * 60 * 60 * 1000
const ENV_TTL_MS = 45 * 60 * 1000
const ENV_FAIL_TTL_MS = 5 * 60 * 1000 // 失败也缓存,但短——瞬时抖动不该把「暂无」钉 45 分钟

let locationCache: { at: number; value: HomeLocation | null } | null = null
let envCache: { at: number; value: EnvPayload | null } | null = null

function readFixture(): EnvFixture | null {
  const raw = process.env.PR_ENV_FIXTURE_JSON
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as EnvFixture
    return parsed && typeof parsed === 'object' && parsed.forecast ? parsed : null
  } catch (error) {
    console.warn('[pr-env] PR_ENV_FIXTURE_JSON 解析失败,忽略 fixture:', (error as Error).message)
    return null
  }
}

function validCoord(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

/** 从最近室外活动的路线起点推导常跑地点(众数网格的均值)。 */
async function deriveLocationFromActivities(): Promise<HomeLocation | null> {
  const db = await getActivitiesDb()
  // Reason: routeCoordinates 是整条降采样路线的 JSON,整列取回太重;
  // 起点必在开头,substr 前 64 字符足够正则出第一对 [lat,lng]。
  const headColumn = { head: sql<string>`substr(${activities.routeCoordinates}, 1, 64)` }
  const baseWhere = [eq(activities.isIndoor, false), isNotNull(activities.routeCoordinates)]
  let rows = await db
    .select(headColumn)
    .from(activities)
    .where(and(eq(activities.type, 'running'), ...baseWhere))
    .orderBy(desc(activities.startTime))
    .limit(12)
  if (rows.length === 0) {
    // 没有室外跑步就放宽到任意室外活动(骑行/步行起点同样能定位生活范围)
    rows = await db
      .select(headColumn)
      .from(activities)
      .where(and(...baseWhere))
      .orderBy(desc(activities.startTime))
      .limit(12)
  }

  const points: Array<{ lat: number; lng: number }> = []
  for (const row of rows) {
    const match = /\[\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(row.head ?? '')
    if (!match) continue
    const lat = Number(match[1])
    const lng = Number(match[2])
    if (validCoord(lat, lng)) points.push({ lat, lng })
  }
  if (points.length === 0) return null

  // 0.02°(≈2km)网格聚类取众数簇,再取簇内均值 —— 排除偶尔的外地跑
  const buckets = new Map<string, Array<{ lat: number; lng: number }>>()
  for (const point of points) {
    const key = `${Math.round(point.lat / 0.02)}:${Math.round(point.lng / 0.02)}`
    const bucket = buckets.get(key) ?? []
    bucket.push(point)
    buckets.set(key, bucket)
  }
  const dominant = Array.from(buckets.values()).sort((a, b) => b.length - a.length)[0]
  const lat = dominant.reduce((sum, p) => sum + p.lat, 0) / dominant.length
  const lng = dominant.reduce((sum, p) => sum + p.lng, 0) / dominant.length
  return { lat, lng, label: '按常跑路线定位' }
}

async function resolveHomeLocation(): Promise<HomeLocation | null> {
  if (locationCache && Date.now() - locationCache.at < LOCATION_TTL_MS) return locationCache.value

  let value: HomeLocation | null = null
  const [latRaw, lngRaw, labelRaw] = await Promise.all([
    getRuntimeSetting('PR_HOME_LAT'),
    getRuntimeSetting('PR_HOME_LNG'),
    getRuntimeSetting('PR_HOME_LABEL'),
  ])
  const lat = Number(latRaw)
  const lng = Number(lngRaw)
  if (latRaw && lngRaw && validCoord(lat, lng)) {
    value = { lat, lng, label: labelRaw ? `按${labelRaw}` : '按你配置的常驻位置' }
  } else {
    value = await deriveLocationFromActivities().catch(() => null)
  }
  locationCache = { at: Date.now(), value }
  return value
}

async function getEnvPayload(): Promise<EnvPayload | null> {
  const fixture = readFixture()
  if (fixture) {
    return {
      location: fixture.location ?? { lat: 0, lng: 0, label: '按评测 fixture' },
      forecast: fixture.forecast,
      airQuality: fixture.airQuality ?? null,
    }
  }
  if (envCache) {
    const ttl = envCache.value ? ENV_TTL_MS : ENV_FAIL_TTL_MS
    if (Date.now() - envCache.at < ttl) return envCache.value
  }

  let value: EnvPayload | null = null
  const location = await resolveHomeLocation()
  if (location) {
    // AQI 失败可容忍(单独 null),forecast 失败则整体降级为「暂无」
    const [forecast, airQuality] = await Promise.all([
      fetchForecast(location.lat, location.lng),
      fetchCurrentAirQuality(location.lat, location.lng).catch(() => null),
    ])
    if (forecast) value = { location, forecast, airQuality }
  }
  envCache = { at: Date.now(), value }
  return value
}

// ─── 渲染 ───────────────────────────────────────────────────────────────────

function shanghaiNowLocal(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

function timeBucket(hour: number) {
  if (hour >= 5 && hour < 9) return '清晨'
  if (hour >= 9 && hour < 12) return '上午'
  if (hour >= 12 && hour < 14) return '午间'
  if (hour >= 14 && hour < 18) return '下午'
  if (hour >= 18 && hour < 22) return '晚间'
  return '夜间'
}

/** 降雨/降雪类 WMO code(与 open-meteo.ts 的描述表同源语义)。 */
function isWetCode(code: number) {
  return (code >= 51 && code <= 67) || (code >= 71 && code <= 86) || code >= 95
}

function summarizeNext12h(hours: ForecastHour[]): string {
  if (hours.length === 0) return '- 未来 12 小时：暂无逐小时预报'
  const wet = hours.filter(hour => (hour.precipitationProbability ?? 0) >= 40 || isWetCode(hour.weatherCode))
  if (wet.length === 0) {
    const temps = hours.map(hour => hour.temperature)
    return `- 未来 12 小时：无明显降水，气温 ${Math.round(Math.min(...temps))}-${Math.round(Math.max(...temps))}°C`
  }
  const firstHour = Number(wet[0].timeLocal.slice(11, 13))
  const lastHour = Number(wet[wet.length - 1].timeLocal.slice(11, 13))
  const maxProb = Math.max(...wet.map(hour => hour.precipitationProbability ?? 0))
  const desc = wet.find(hour => isWetCode(hour.weatherCode))?.description ?? '降水'
  const span = firstHour === lastHour ? `${firstHour} 点前后` : `${firstHour}-${lastHour} 点`
  return `- 未来 12 小时：${span}可能有${desc}${maxProb > 0 ? `（概率最高 ${maxProb}%）` : ''}`
}

function renderEnvironmentLines(payload: EnvPayload, nowLocal: string): string[] {
  const clock = nowLocal.slice(11, 16)
  const hour = Number(nowLocal.slice(11, 13))
  const today = payload.forecast.daily.find(day => day.date === nowLocal.slice(0, 10)) ?? payload.forecast.daily[0]

  let sunNote = ''
  if (today) {
    if (clock < today.sunrise) sunNote = `，日出 ${today.sunrise}，天还没亮`
    else if (clock < today.sunset) sunNote = `，日落 ${today.sunset}`
    else sunNote = `，日落 ${today.sunset}，天已黑`
  }

  const cur = payload.forecast.current
  const next12 = payload.forecast.hourly.filter(hourItem => hourItem.timeLocal > nowLocal).slice(0, 12)
  const lines = [
    `- 现在：${clock}（${timeBucket(hour)}）${sunNote}`,
    `- 实况：${cur.temperature}°C（体感 ${cur.apparentTemperature}°C），${cur.description}，风 ${cur.windSpeed} km/h，湿度 ${cur.humidity}%`,
    summarizeNext12h(next12),
  ]
  if (payload.airQuality) {
    const air = payload.airQuality
    lines.push(`- 空气：AQI ${air.aqi}（${air.label}${air.pm25 != null ? `，PM2.5 ${air.pm25}` : ''}）`)
  }
  return lines
}

function unavailableBlock(reason: string): ContextBlock {
  return {
    key: 'environment',
    title: '# 现在的环境（实况与预报）',
    lines: [`- 暂无（${reason}；没有环境数据就别给天气/空气的具体数值）`],
    data: { hasEnvironment: false },
  }
}

// ─── Provider ───────────────────────────────────────────────────────────────

export const environmentProvider: ContextProvider = {
  key: 'environment',
  priority: 70,
  load: async () => {
    const payload = await getEnvPayload()
    if (!payload) {
      const location = await resolveHomeLocation().catch(() => null)
      return unavailableBlock(location ? '天气服务未响应' : '还没有可定位的常跑地点,可配置 PR_HOME_LAT/PR_HOME_LNG')
    }
    const nowLocal = readFixture()?.nowLocal ?? shanghaiNowLocal()
    return {
      key: 'environment',
      title: `# 现在的环境（实况与预报，${payload.location.label}）`,
      lines: renderEnvironmentLines(payload, nowLocal),
      data: { hasEnvironment: true, locationLabel: payload.location.label },
    }
  },
  tools: [
    {
      name: 'query_weather',
      description:
        '查常跑地点未来最多 7 天的天气预报(逐日概览+早晚时段)。上下文快照只有当下和未来 12 小时;他问「明天早上」「周末」「比赛那天」这类更远时间的天气时用它。超过 7 天的日期查不了,要如实说。',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD;省略则查明天' },
        },
      },
    },
  ],
  executeTool: async (_name, rawInput) => {
    const input = (rawInput ?? {}) as Record<string, unknown>
    const payload = await getEnvPayload()
    if (!payload) return JSON.stringify({ error: '天气服务不可用或还没有常跑地点定位,别编数值' })

    const nowLocal = readFixture()?.nowLocal ?? shanghaiNowLocal()
    const fallbackDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
      new Date(Date.parse(`${nowLocal.slice(0, 10)}T00:00:00+08:00`) + 86_400_000),
    )
    const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : fallbackDate
    const day = payload.forecast.daily.find(item => item.date === date)
    if (!day) {
      const range = payload.forecast.daily
      return JSON.stringify({
        error: `预报只覆盖 ${range[0]?.date} ~ ${range[range.length - 1]?.date},${date} 还查不了`,
      })
    }

    const hoursOf = (from: number, to: number) =>
      payload.forecast.hourly.filter(hour => {
        if (hour.timeLocal.slice(0, 10) !== date) return false
        const h = Number(hour.timeLocal.slice(11, 13))
        return h >= from && h <= to
      })
    const segment = (label: string, hours: ForecastHour[]) => {
      if (hours.length === 0) return null
      const temps = hours.map(hour => hour.temperature)
      return {
        label,
        tempRange: `${Math.round(Math.min(...temps))}-${Math.round(Math.max(...temps))}°C`,
        maxPrecipitationProbability: Math.max(...hours.map(hour => hour.precipitationProbability ?? 0)),
        description: hours.find(hour => isWetCode(hour.weatherCode))?.description ?? hours[0].description,
      }
    }
    return JSON.stringify({
      date,
      location: payload.location.label,
      summary: {
        description: day.description,
        tempMin: day.tempMin,
        tempMax: day.tempMax,
        precipitationProbabilityMax: day.precipitationProbabilityMax,
        sunrise: day.sunrise,
        sunset: day.sunset,
      },
      morning: segment('清晨 6-9 点', hoursOf(6, 9)),
      evening: segment('傍晚 18-21 点', hoursOf(18, 21)),
    })
  },
}
