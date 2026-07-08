/**
 * PR 对话 agent 的只读工具集(Anthropic tool use)。
 *
 * FactLoader 预装配的上下文只是"就近快照";当用户问的东西不在快照里
 * (更早的记录、其他类型、健康趋势),FriendPersona 通过这些工具自己去查,
 * 而不是回答"没查到"。执行体只读数据库,不做写操作。
 */
import { queryActivityContext } from './context'
import { getLatestHealthDailyMetrics } from './health'

export interface PrChatToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const PR_CHAT_TOOLS: PrChatToolSpec[] = [
  {
    name: 'query_activities',
    description:
      '查用户的真实运动记录(手表同步)。上下文里只有最近几条快照;当用户问"上次跑步/更早的记录/某段时间跑了什么",或最近几条都是别的运动类型时,用它往前翻。返回按时间倒序。',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['running', 'cycling', 'walking'],
          description: '运动类型过滤;省略则返回所有类型',
        },
        before: {
          type: 'string',
          description: 'YYYY-MM-DD,只看这一天之前的记录(用返回结果里最早的 date 继续往前翻页)',
        },
        limit: { type: 'number', description: '返回条数,默认 5,最多 20' },
      },
    },
  },
  {
    name: 'query_health_daily',
    description:
      '查最近 N 天的每日健康/恢复数据(睡眠、HRV、静息心率、步数、恢复评级)。上下文默认只带最新一天;用户问睡眠/恢复趋势或前几天的情况时用它。',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '最近几天,默认 7,最多 30' },
      },
    },
  },
]

/** 执行工具,返回给模型的 JSON 字符串(出错也返回 JSON,让模型能继续)。 */
export async function executePrChatTool(name: string, rawInput: unknown): Promise<string> {
  const input = (rawInput ?? {}) as Record<string, unknown>
  if (name === 'query_activities') {
    const rows = await queryActivityContext({
      type: typeof input.type === 'string' ? input.type : undefined,
      before: typeof input.before === 'string' ? input.before : undefined,
      limit: typeof input.limit === 'number' ? input.limit : undefined,
    })
    return JSON.stringify({
      count: rows.length,
      note: rows.length === 0 ? '没有匹配的记录(库里确实没有,可如实告知)' : undefined,
      activities: rows.map(row => ({
        date: row.date,
        daysAgo: row.daysAgo,
        type: row.type,
        distanceKm: row.distanceKm,
        durationMin: row.durationMin,
        pace: row.paceText ? `${row.paceText}/km` : null,
        avgHeartRate: row.avgHeartRate,
      })),
    })
  }
  if (name === 'query_health_daily') {
    const days = Math.min(Math.max(Math.trunc(typeof input.days === 'number' ? input.days : 7), 1), 30)
    const rows = await getLatestHealthDailyMetrics(days)
    return JSON.stringify({
      count: rows.length,
      days: rows.map(row => ({
        date: row.date,
        sleepMinutes: row.sleepMinutes,
        hrv: row.hrv,
        restingHr: row.restingHr,
        steps: row.steps,
        recovery: row.recoveryLabel,
      })),
    })
  }
  return JSON.stringify({ error: `未知工具:${name}` })
}
