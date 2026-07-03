import { createHash } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  sendWeChatTestAccountText,
  type WeChatTestAccountConfig,
} from '@/lib/notifications/wechat-test-account'
import { chatWithPr, getRecentThreadId } from '@/lib/pr/chat'
import { getRuntimeSettings } from '@/lib/runtime-config'

export const dynamic = 'force-dynamic'

/**
 * WeChat test-account message callback — the inbound entry point for chatting with PR.
 *
 * GET  : server URL verification (echo `echostr` when the SHA1 signature checks out).
 * POST : receive a user message, ACK immediately ("success"), then reply asynchronously
 *        via a customer-service text message. The inbound message opens WeChat's 48h
 *        service window, so `custom/send` is allowed for the reply.
 *
 * Security: no admin auth (WeChat can't authenticate) — instead every request is verified
 * against the configured Token via the standard WeChat SHA1 signature.
 */

function verifySignature(token: string, signature: string, timestamp: string, nonce: string) {
  if (!token || !signature) return false
  const hash = createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex')
  return hash === signature
}

function readSignatureParams(url: URL) {
  return {
    signature: url.searchParams.get('signature') ?? '',
    timestamp: url.searchParams.get('timestamp') ?? '',
    nonce: url.searchParams.get('nonce') ?? '',
  }
}

/** Extract a flat WeChat XML field, tolerating both CDATA and plain forms. */
function xmlField(xml: string, tag: string): string {
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`))
  if (cdata) return cdata[1].trim()
  const plain = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return plain ? plain[1].trim() : ''
}

// Dedup WeChat's retry deliveries (same MsgId) within the process lifetime.
const seenMsgIds = new Set<string>()

export async function GET(request: Request) {
  const url = new URL(request.url)
  const { signature, timestamp, nonce } = readSignatureParams(url)
  const echostr = url.searchParams.get('echostr') ?? ''
  const settings = await getRuntimeSettings({ force: true })
  const token = settings.WECHAT_TEST_ACCOUNT_TOKEN ?? ''

  if (!token) {
    return new NextResponse('WECHAT_TEST_ACCOUNT_TOKEN 未配置', { status: 500 })
  }
  if (verifySignature(token, signature, timestamp, nonce)) {
    return new NextResponse(echostr, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse('invalid signature', { status: 403 })
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const { signature, timestamp, nonce } = readSignatureParams(url)
  const settings = await getRuntimeSettings({ force: true })
  const token = settings.WECHAT_TEST_ACCOUNT_TOKEN ?? ''

  // Reject spoofed callbacks when a token is set; if unset we still ACK so setup isn't blocked.
  if (token && !verifySignature(token, signature, timestamp, nonce)) {
    return new NextResponse('invalid signature', { status: 403 })
  }

  const xml = await request.text()
  const msgType = xmlField(xml, 'MsgType')
  const fromUser = xmlField(xml, 'FromUserName')
  const content = xmlField(xml, 'Content')
  const msgId = xmlField(xml, 'MsgId')

  if (msgType === 'text' && content && fromUser && (!msgId || !seenMsgIds.has(msgId))) {
    if (msgId) {
      seenMsgIds.add(msgId)
      // Reason: bound the set so it can't grow unbounded across a long-lived process.
      if (seenMsgIds.size > 500) seenMsgIds.clear()
    }
    // Fire-and-forget: WeChat requires a reply within 5s, AI is slower, so we ACK now
    // and push the answer via a customer-service message once it's ready.
    void replyAsync(fromUser, content, settings).catch(error =>
      console.warn('[wechat/callback] 异步回复失败:', (error as Error).message),
    )
  }

  // "success" tells WeChat we've handled it and stops retries; the real reply is async.
  return new NextResponse('success', { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

async function replyAsync(openId: string, message: string, settings: Record<string, string>) {
  const threadId = await getRecentThreadId()
  const { answer } = await chatWithPr({ message, threadId })

  const config: WeChatTestAccountConfig = {
    appId: settings.WECHAT_TEST_ACCOUNT_APP_ID ?? '',
    appSecret: settings.WECHAT_TEST_ACCOUNT_APP_SECRET ?? '',
    templateId: settings.WECHAT_TEST_ACCOUNT_TEMPLATE_ID ?? '',
    openId, // reply to whoever messaged us
  }
  // title empty → sendWeChatTestAccountText delivers just the answer body.
  await sendWeChatTestAccountText(config, { title: '', content: answer })
}
