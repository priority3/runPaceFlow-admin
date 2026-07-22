/**
 * AI Activity Insight Service (Admin)
 *
 * Generates AI analysis for running activities.
 * Adapted from runPaceFlow frontend's src/lib/ai/ for admin backend use.
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

import { getDb } from './db'
import { getRuntimeSettings } from './runtime-config'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Activity {
  id: string
  title: string
  type: string
  distance: number
  duration: number
  average_pace: number | null
  best_pace: number | null
  elevation_gain: number | null
  average_heart_rate: number | null
  max_heart_rate: number | null
  weather_data: string | null
}

interface Split {
  kilometer: number
  duration: number
  pace: number
  distance: number
  average_heart_rate: number | null
}

interface ActivityInsightInput {
  activity: Activity
  splits: Split[]
}

interface AIGenerationResult {
  content: string
  model: string
  provider: string
}

// ─── Pace Utilities ─────────────────────────────────────────────────────────

function formatPace(paceInSeconds: number): string {
  const minutes = Math.floor(paceInSeconds / 60)
  const seconds = Math.floor(paceInSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`
  }
  return `${Math.round(meters)} m`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}小时${m}分${s}秒`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

// ─── Prompt Builder ─────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `你是一位专业的跑步教练和数据分析师。你的任务是分析跑步活动数据，提供有价值的洞察和建议。

请用中文回复，保持专业但友好的语气。回复应该简洁有力，重点突出。

## 输出格式要求
- 使用 markdown 格式
- 用 **粗体** 强调关键数据和结论
- 适当使用表情符号增加可读性
- **禁止使用 markdown 表格**，改用列表或分段描述
- 每个段落保持简短（2-3句话）
- 回复长度控制在 200-350 字

## 严格禁止
- **绝对不要在回复末尾追问用户、索要更多信息或暗示补充数据**
- 不允许出现任何形式的"如果你能补充…"、"如果你愿意提供…"、"还可以进一步…"等引导句
- 分析必须基于已有数据直接给出结论，到训练建议结束后立即停止

## 分析结构
1. **整体评价**（1-2句总结本次跑步表现）
2. **配速分析**（分析配速变化规律，指出亮点和问题）
3. **训练建议**（给出 1-2 条具体可执行的建议）

## 分析要点
- 配速模式和稳定性
- 分段趋势（正分割/负分割/均匀）
- 心率表现（如有数据）
- 天气影响（如有数据，分析温度、湿度、风速对表现的影响）
- 针对性的改进方向`
}

function buildUserPrompt(input: ActivityInsightInput): string {
  const { activity, splits } = input

  const distanceStr = formatDistance(activity.distance)
  const durationStr = formatDuration(activity.duration)
  const avgPaceStr = activity.average_pace ? formatPace(activity.average_pace) : '-'
  const bestPaceStr = activity.best_pace ? formatPace(activity.best_pace) : '-'

  let prompt = `请分析以下跑步活动数据：

## 基本信息
- 距离：${distanceStr}
- 用时：${durationStr}
- 平均配速：${avgPaceStr}/km
- 最佳配速：${bestPaceStr}/km
- 活动类型：${activity.type}
`

  // Add pace analysis
  if (splits.length > 0) {
    const paces = splits.map((s) => s.pace).filter((p) => p > 0)
    if (paces.length > 1) {
      const halfIndex = Math.floor(paces.length / 2)
      const firstHalf = paces.slice(0, halfIndex)
      const secondHalf = paces.slice(halfIndex)
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
      const diff = secondAvg - firstAvg

      let trendLabel = '均匀配速'
      if (diff < -15) trendLabel = '负分割（后程加速）'
      else if (diff > 15) trendLabel = '正分割（后程减速）'

      prompt += `
## 配速分析
- 前半程平均：${formatPace(firstAvg)}/km
- 后半程平均：${formatPace(secondAvg)}/km
- 配速趋势：${trendLabel}
`
    }
  }

  // Add heart rate if available
  if (activity.average_heart_rate) {
    prompt += `
## 心率数据
- 平均心率：${activity.average_heart_rate} bpm
- 最大心率：${activity.max_heart_rate || '-'} bpm
`
  }

  // Add elevation if available
  if (activity.elevation_gain && activity.elevation_gain > 0) {
    prompt += `
## 海拔数据
- 累计爬升：${Math.round(activity.elevation_gain)}米
`
  }

  // Add weather if available
  if (activity.weather_data) {
    try {
      const weather = JSON.parse(activity.weather_data)
      prompt += `
## 天气条件
- 温度：${weather.temperature}°C
- 湿度：${weather.humidity}%
- 风速：${weather.windSpeed} km/h
- 天气：${weather.description}
`
    } catch {
      // ignore malformed weather data
    }
  }

  // Add splits data
  if (splits.length > 0) {
    const splitsStr = splits
      .map((s) => {
        const paceStr = s.pace ? formatPace(s.pace) : '-'
        const hrStr = s.average_heart_rate ? ` (${s.average_heart_rate}bpm)` : ''
        return `第${s.kilometer}公里: ${paceStr}/km${hrStr}`
      })
      .join('\n')
    prompt += `
## 分段配速
${splitsStr}
`
  }

  prompt += `
请根据以上数据，提供：
1. 📊 **配速分析**：分析配速变化规律和稳定性
2. 💪 **训练建议**：基于本次数据给出 1-2 条具体可行的建议

注意：给完训练建议后直接结束，不要追问或索要更多信息。`

  return prompt
}

// ─── AI Providers ───────────────────────────────────────────────────────────

const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-20250514'
const OPENAI_DEFAULT_MODEL = 'gpt-4o'

async function generateWithClaude(
  input: ActivityInsightInput,
  settings: Record<string, string>,
): Promise<AIGenerationResult> {
  const apiKey = settings.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const client = new Anthropic({
    apiKey,
    ...(settings.ANTHROPIC_BASE_URL && { baseURL: settings.ANTHROPIC_BASE_URL }),
  })

  const model = settings.ANTHROPIC_MODEL || CLAUDE_DEFAULT_MODEL

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    stream: false, // Reason: 部分网关不显式传就回 SSE,SDK 会把流当字符串返回
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
  })

  const textContent = response.content.find((block) => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in Claude response')
  }

  return { content: textContent.text, model, provider: 'claude' }
}

async function generateWithOpenAI(
  input: ActivityInsightInput,
  settings: Record<string, string>,
): Promise<AIGenerationResult> {
  const apiKey = settings.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const client = new OpenAI({
    apiKey,
    ...(settings.OPENAI_BASE_URL && { baseURL: settings.OPENAI_BASE_URL }),
  })

  const model = settings.OPENAI_MODEL || OPENAI_DEFAULT_MODEL

  if (settings.OPENAI_API_FORMAT === 'responses') {
    const response = await client.responses.create({
      model,
      instructions: buildSystemPrompt(),
      input: [{ role: 'user', content: [{ type: 'input_text', text: buildUserPrompt(input) }] }],
      store: false,
    })
    const messageOutput = response.output.find((item) => item.type === 'message')
    const textContent = messageOutput?.content.find((c) => c.type === 'output_text')
    if (!textContent || textContent.type !== 'output_text') {
      throw new Error('No text content in Responses API output')
    }
    return { content: textContent.text, model: response.model || model, provider: 'openai-compatible' }
  }

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    stream: false, // Reason: 同上,防网关默认回 SSE
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(input) },
    ],
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('No content in Chat Completions response')
  return { content, model: response.model || model, provider: 'openai-compatible' }
}

// ─── Provider Orchestrator ──────────────────────────────────────────────────

async function generateInsight(input: ActivityInsightInput): Promise<AIGenerationResult> {
  // Reason: 统一走运行时配置(库行覆盖 env),UI 改凭据后定时任务无需重启即可生效
  const settings = await getRuntimeSettings()
  const providers: Array<{ name: string; fn: () => Promise<AIGenerationResult> }> = []

  if (settings.ANTHROPIC_API_KEY) {
    providers.push({ name: 'Claude', fn: () => generateWithClaude(input, settings) })
  }
  if (settings.OPENAI_API_KEY) {
    providers.push({ name: 'OpenAI', fn: () => generateWithOpenAI(input, settings) })
  }

  if (providers.length === 0) {
    throw new Error('未配置任何 AI 服务，请设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY')
  }

  let lastError: Error | null = null
  for (const provider of providers) {
    try {
      return await provider.fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.warn(`[AI] ${provider.name} failed, trying next...`, lastError.message)
    }
  }
  throw lastError!
}

// ─── Public API ─────────────────────────────────────────────────────────────

function generateInsightId(): string {
  return `insight_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Generate AI insight for a single activity and cache to database.
 */
export async function generateInsightForActivity(
  activityId: string,
): Promise<AIGenerationResult | null> {
  const db = getDb()

  // Check if insight already exists
  const existing = await db.execute({
    sql: 'SELECT id FROM activity_insights WHERE activity_id = ?',
    args: [activityId],
  })
  if (existing.rows.length > 0) {
    return null // already cached
  }

  // Fetch activity
  const activityResult = await db.execute({
    sql: 'SELECT * FROM activities WHERE id = ?',
    args: [activityId],
  })
  if (activityResult.rows.length === 0) {
    console.warn(`[AI] Activity ${activityId} not found`)
    return null
  }
  const activity = activityResult.rows[0] as unknown as Activity

  // Fetch splits
  const splitsResult = await db.execute({
    sql: 'SELECT * FROM splits WHERE activity_id = ? ORDER BY kilometer',
    args: [activityId],
  })
  const splits = splitsResult.rows as unknown as Split[]

  // Generate insight
  const result = await generateInsight({ activity, splits })

  // Cache to database
  try {
    await db.execute({
      sql: `INSERT INTO activity_insights (id, activity_id, content, generated_at, model)
            VALUES (?, ?, ?, unixepoch(), ?)`,
      args: [generateInsightId(), activityId, result.content, result.model],
    })
  } catch (err) {
    console.warn('[AI] Failed to cache insight:', (err as Error).message)
  }

  return result
}

/**
 * Generate insights for all activities that don't have cached insights.
 * Returns the number of newly generated insights.
 */
export async function generateInsightsForUncached(): Promise<number> {
  const db = getDb()

  // Find activities without cached insights
  const result = await db.execute(`
    SELECT a.id FROM activities a
    LEFT JOIN activity_insights ai ON a.id = ai.activity_id
    WHERE ai.id IS NULL
    ORDER BY a.start_time DESC
    LIMIT 10
  `)

  let count = 0
  for (const row of result.rows) {
    try {
      const insight = await generateInsightForActivity(row.id as string)
      if (insight) count++
    } catch (err) {
      console.warn(`[AI] Failed for activity ${row.id}:`, (err as Error).message)
    }
  }

  return count
}
