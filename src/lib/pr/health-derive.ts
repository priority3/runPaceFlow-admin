/**
 * Health payload derivation.
 *
 * Reason: reporters (iOS Shortcuts) upload RAW sleep facts — one entry per sleep
 * sample with its stage and start/end times — plus daytime nap samples. The server
 * derives the aggregate recovery numbers (asleep/deep/REM minutes, nap total,
 * bedtime/wake, awakenings) so the raw facts stay intact and the interpretation
 * logic can evolve without changing the shortcut on the user's phone.
 */

export interface SleepSegmentInput {
  stage?: unknown
  start?: unknown
  end?: unknown
  minutes?: unknown
}

export type SleepStage = 'deep' | 'rem' | 'core' | 'inbed' | 'awake' | 'other'

/** Map Apple's stage label (In Bed / Core / Deep / REM / Awake) to a bucket. */
export function classifyStage(stage: string): SleepStage {
  const s = stage.toLowerCase()
  if (s.includes('deep')) return 'deep'
  if (s.includes('rem')) return 'rem'
  if (s.includes('core') || s.includes('asleep')) return 'core'
  if (s.includes('bed')) return 'inbed'
  if (s.includes('awake') || s.includes('wake')) return 'awake'
  return 'other'
}

/** Duration of a segment in minutes, from explicit `minutes` or start/end timestamps. */
export function segmentMinutes(seg: SleepSegmentInput): number {
  if (typeof seg.minutes === 'number' && Number.isFinite(seg.minutes)) return seg.minutes
  const start = typeof seg.start === 'string' ? Date.parse(seg.start) : NaN
  const end = typeof seg.end === 'string' ? Date.parse(seg.end) : NaN
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return (end - start) / 60000
  }
  return 0
}

function asArray(value: unknown): SleepSegmentInput[] {
  return Array.isArray(value) ? (value as SleepSegmentInput[]) : []
}

export interface DerivedSleep {
  sleepMinutes: number | null
  deepSleepMinutes: number | null
  remSleepMinutes: number | null
  coreMinutes: number
  inBedMinutes: number
  awakeMinutes: number
  awakenings: number
  bedtime: string | null
  wakeTime: string | null
  napMinutes: number
}

/**
 * Derive recovery aggregates from raw night-sleep + daytime-nap segments.
 * "Asleep" = Core + Deep + REM (excludes In Bed and Awake), matching Apple's model.
 */
export function deriveSleep(sleepSegments: unknown, napSegments: unknown): DerivedSleep {
  const night = asArray(sleepSegments)
  let deep = 0
  let rem = 0
  let core = 0
  let inbed = 0
  let awake = 0
  let awakenings = 0
  const asleepStarts: number[] = []
  const asleepEnds: number[] = []

  for (const seg of night) {
    const minutes = segmentMinutes(seg)
    const cls = classifyStage(typeof seg.stage === 'string' ? seg.stage : '')
    if (cls === 'deep') deep += minutes
    else if (cls === 'rem') rem += minutes
    else if (cls === 'core') core += minutes
    else if (cls === 'inbed') inbed += minutes
    else if (cls === 'awake') {
      awake += minutes
      awakenings += 1
    }
    if (cls === 'deep' || cls === 'rem' || cls === 'core') {
      const start = typeof seg.start === 'string' ? Date.parse(seg.start) : NaN
      const end = typeof seg.end === 'string' ? Date.parse(seg.end) : NaN
      if (Number.isFinite(start)) asleepStarts.push(start)
      if (Number.isFinite(end)) asleepEnds.push(end)
    }
  }

  const asleep = core + deep + rem
  const naps = asArray(napSegments).reduce((sum, seg) => sum + segmentMinutes(seg), 0)
  const round = (n: number) => Math.round(n)

  return {
    sleepMinutes: night.length ? round(asleep) : null,
    deepSleepMinutes: night.length ? round(deep) : null,
    remSleepMinutes: night.length ? round(rem) : null,
    coreMinutes: round(core),
    inBedMinutes: round(inbed),
    awakeMinutes: round(awake),
    awakenings,
    bedtime: asleepStarts.length ? new Date(Math.min(...asleepStarts)).toISOString() : null,
    wakeTime: asleepEnds.length ? new Date(Math.max(...asleepEnds)).toISOString() : null,
    napMinutes: round(naps),
  }
}
