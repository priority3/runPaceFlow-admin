import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

import { getRuntimeSettings } from '@/lib/runtime-config'

/**
 * Shared PR text-generation entry point (Claude / OpenAI-compatible).
 *
 * Reason: several generators (daily reflection, chat, …) need the same model call.
 * The configured third-party gateway requires the 1M-context beta header on
 * /v1/messages (otherwise it returns "请启用 1m 上下文"), which the official SDK does
 * not send by default — so we add it here.
 */
export interface PrModelResult {
  content: string
  model: string
  provider: 'claude' | 'openai-compatible'
}

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514'
const DEFAULT_OPENAI_MODEL = 'gpt-4o'
const ANTHROPIC_BETA = 'context-1m-2025-08-07'

/** 供多模态输入:base64 图片(仅 Claude/Anthropic 路径支持,网关已验证可用)。 */
export interface PrModelImage {
  base64: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
}

/**
 * 从模型输出里稳健地取出 JSON 对象(容忍 ```json 围栏或前后杂字)。
 * 解析失败抛错,由调用方决定降级策略(记忆蒸馏跳过本次、会话摘要保持旧标题等)。
 */
export function parseModelJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  return JSON.parse(slice)
}

/** 模型可调用的只读工具(仅 Claude/Anthropic 路径生效)。 */
export interface PrModelToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface PrModelCallOptions {
  maxTokens?: number
  images?: PrModelImage[]
  tools?: PrModelToolSpec[]
  /** 工具执行体;与 tools 同时提供才启用 tool use。 */
  executeTool?: (name: string, input: unknown) => Promise<string>
  /** 最多几轮工具往返(每轮一次 API 调用),默认 3。 */
  maxToolRounds?: number
  /** 每次工具执行后的观察钩子(写快照用),抛错不影响主流程。 */
  onToolCall?: (name: string, input: unknown, result: string) => void
}

export async function callPrModel(
  system: string,
  user: string,
  opts: PrModelCallOptions = {},
): Promise<PrModelResult> {
  const settings = await getRuntimeSettings({ force: true })
  const maxTokens = opts.maxTokens ?? 900
  const images = opts.images ?? []

  if (settings.ANTHROPIC_API_KEY) {
    const model = settings.PR_REVIEW_MODEL || settings.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL
    const client = new Anthropic({
      apiKey: settings.ANTHROPIC_API_KEY,
      ...(settings.ANTHROPIC_BASE_URL && { baseURL: settings.ANTHROPIC_BASE_URL }),
      defaultHeaders: { 'anthropic-beta': ANTHROPIC_BETA },
    })
    // 有图片时组多模态 content 块(图在前、文本在后),否则用纯文本。
    const content = images.length
      ? [
          ...images.map(img => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
          })),
          { type: 'text' as const, text: user },
        ]
      : user

    let useTools = Boolean(opts.tools?.length && opts.executeTool)
    const tools: Anthropic.Tool[] | undefined = useTools
      ? opts.tools!.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        }))
      : undefined
    const maxToolRounds = opts.maxToolRounds ?? 3
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content }]

    // Agent 循环:模型要调工具 → 本地执行 → 结果喂回 → 直到产出正式回答。
    // 注意:消息里一旦出现 tool_use 块,后续请求必须继续带 tools 参数,
    // 所以轮次耗尽时不去掉 tools,而是用错误 tool_result 逼模型直接作答。
    for (let round = 0; round <= maxToolRounds + 1; round++) {
      let response: Anthropic.Message
      try {
        response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages,
          ...(useTools ? { tools } : {}),
        })
      } catch (error) {
        // Reason: 第三方网关可能不透传 tools 字段;首轮失败就降级为无工具模式,保底能聊
        if (useTools && round === 0) {
          console.warn('[pr-model] 带 tools 调用失败,降级为无工具模式:', (error as Error).message)
          useTools = false
          response = await client.messages.create({ model, max_tokens: maxTokens, system, messages })
        } else {
          throw error
        }
      }

      if (useTools && response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content })
        const exhausted = round >= maxToolRounds
        const results: Anthropic.ToolResultBlockParam[] = []
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          let result: string
          if (exhausted) {
            result = JSON.stringify({ error: '工具轮次已用完,请基于已有信息直接回答' })
          } else {
            try {
              result = await opts.executeTool!(block.name, block.input)
            } catch (error) {
              result = JSON.stringify({ error: (error as Error).message })
            }
            try {
              opts.onToolCall?.(block.name, block.input, result)
            } catch {
              /* 观察钩子不影响主流程 */
            }
          }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: result })
        }
        messages.push({ role: 'user', content: results })
        continue
      }

      const text = response.content.find(block => block.type === 'text')
      if (!text || text.type !== 'text') throw new Error('No text content in Claude response')
      return { content: text.text, model, provider: 'claude' }
    }
    throw new Error('Tool loop exhausted without a final answer')
  }

  if (settings.OPENAI_API_KEY) {
    const model = settings.PR_REVIEW_MODEL || settings.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
    const client = new OpenAI({
      apiKey: settings.OPENAI_API_KEY,
      ...(settings.OPENAI_BASE_URL && { baseURL: settings.OPENAI_BASE_URL }),
    })
    if (settings.OPENAI_API_FORMAT === 'responses') {
      const response = await client.responses.create({
        model,
        instructions: system,
        input: [{ role: 'user', content: [{ type: 'input_text', text: user }] }],
        store: false,
      })
      const message = response.output.find(item => item.type === 'message')
      const text = message?.content.find(item => item.type === 'output_text')
      if (!text || text.type !== 'output_text') throw new Error('No text content in Responses API output')
      return { content: text.text, model: response.model || model, provider: 'openai-compatible' }
    }
    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('No content in Chat Completions response')
    return { content, model: response.model || model, provider: 'openai-compatible' }
  }

  throw new Error('未配置任何 AI 服务（ANTHROPIC_API_KEY / OPENAI_API_KEY）')
}
