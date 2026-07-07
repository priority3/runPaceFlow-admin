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

export async function callPrModel(
  system: string,
  user: string,
  opts: { maxTokens?: number; images?: PrModelImage[] } = {},
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
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    })
    const text = response.content.find(block => block.type === 'text')
    if (!text || text.type !== 'text') throw new Error('No text content in Claude response')
    return { content: text.text, model, provider: 'claude' }
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
