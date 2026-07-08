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

/** 原生多轮消息(参考 Claude Code:历史用真实 turns,不压成文本塞单条 user)。 */
export interface PrModelMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface PrModelCallOptions {
  maxTokens?: number
  /** 图片附着到最后一条 user 消息(即当前这轮)。 */
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
  input: string | PrModelMessage[],
  opts: PrModelCallOptions = {},
): Promise<PrModelResult> {
  const settings = await getRuntimeSettings({ force: true })
  const maxTokens = opts.maxTokens ?? 900
  const images = opts.images ?? []
  const turns: PrModelMessage[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input

  if (settings.ANTHROPIC_API_KEY) {
    const model = settings.PR_REVIEW_MODEL || settings.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL
    const client = new Anthropic({
      apiKey: settings.ANTHROPIC_API_KEY,
      ...(settings.ANTHROPIC_BASE_URL && { baseURL: settings.ANTHROPIC_BASE_URL }),
      defaultHeaders: { 'anthropic-beta': ANTHROPIC_BETA },
    })

    // 图片附着到最后一条 user 消息(图在前、文本在后),其余轮次纯文本。
    const lastUserIndex = turns.reduce((last, turn, i) => (turn.role === 'user' ? i : last), -1)
    const messages: Anthropic.MessageParam[] = turns.map((turn, i) => {
      if (turn.role === 'user' && i === lastUserIndex && images.length) {
        return {
          role: 'user' as const,
          content: [
            ...images.map(img => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
            })),
            { type: 'text' as const, text: turn.content },
          ],
        }
      }
      return { role: turn.role, content: turn.content }
    })

    let useTools = Boolean(opts.tools?.length && opts.executeTool)
    let useCache = true
    const tools: Anthropic.Tool[] | undefined = useTools
      ? opts.tools!.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        }))
      : undefined
    const maxToolRounds = opts.maxToolRounds ?? 3

    // system 挂缓存断点:tools + system 是跨轮/跨会话的稳定前缀,命中后按 0.1 倍计费。
    const buildParams = (): Anthropic.MessageCreateParamsNonStreaming => ({
      model,
      max_tokens: maxTokens,
      system: useCache
        ? [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }]
        : system,
      messages,
      ...(useTools && tools ? { tools } : {}),
    })

    // Agent 循环:模型要调工具 → 本地执行 → 结果喂回 → 直到产出正式回答。
    // 注意:消息里一旦出现 tool_use 块,后续请求必须继续带 tools 参数,
    // 所以轮次耗尽时不去掉 tools,而是用错误 tool_result 逼模型直接作答。
    for (let round = 0; round <= maxToolRounds + 1; round++) {
      let response: Anthropic.Message
      try {
        response = await client.messages.create(buildParams())
      } catch (error) {
        // Reason: 第三方网关可能不透传 cache_control / tools;仅首轮逐级降级,保底能聊
        if (round === 0 && useCache) {
          console.warn('[pr-model] 带 cache_control 调用失败,降级重试:', (error as Error).message)
          useCache = false
          try {
            response = await client.messages.create(buildParams())
          } catch (retryError) {
            if (!useTools) throw retryError
            console.warn('[pr-model] 带 tools 调用仍失败,降级为无工具模式:', (retryError as Error).message)
            useTools = false
            response = await client.messages.create(buildParams())
          }
        } else if (round === 0 && useTools) {
          console.warn('[pr-model] 带 tools 调用失败,降级为无工具模式:', (error as Error).message)
          useTools = false
          response = await client.messages.create(buildParams())
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

  // OpenAI 兼容路径:多轮 turns 一一映射;不支持 tools/图片/缓存(网关实际走 Anthropic)。
  if (settings.OPENAI_API_KEY) {
    const model = settings.PR_REVIEW_MODEL || settings.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
    const client = new OpenAI({
      apiKey: settings.OPENAI_API_KEY,
      ...(settings.OPENAI_BASE_URL && { baseURL: settings.OPENAI_BASE_URL }),
    })
    if (settings.OPENAI_API_FORMAT === 'responses') {
      // Responses 的多轮 input 类型要求完整 ResponseOutputMessage;该路径不承载对话,多轮时降级为转写文本
      const transcript =
        turns.length === 1
          ? turns[0].content
          : turns.map(turn => `[${turn.role}] ${turn.content}`).join('\n\n')
      const response = await client.responses.create({
        model,
        instructions: system,
        input: [{ role: 'user', content: [{ type: 'input_text', text: transcript }] }],
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
        ...turns.map(turn => ({ role: turn.role, content: turn.content })),
      ],
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('No content in Chat Completions response')
    return { content, model: response.model || model, provider: 'openai-compatible' }
  }

  throw new Error('未配置任何 AI 服务（ANTHROPIC_API_KEY / OPENAI_API_KEY）')
}
