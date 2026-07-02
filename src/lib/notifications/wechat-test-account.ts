interface AccessTokenResponse {
  access_token?: string
  expires_in?: number
  errcode?: number
  errmsg?: string
}

interface TemplateSendResponse {
  errcode: number
  errmsg: string
  msgid?: number
}

export interface WeChatTestAccountConfig {
  appId: string
  appSecret: string
  templateId: string
  openId: string
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

function assertConfigured(config: WeChatTestAccountConfig) {
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new Error(`微信测试号配置缺失: ${missing.join(', ')}`)
  }
}

export async function getWeChatTestAccountAccessToken(config: WeChatTestAccountConfig) {
  assertConfigured(config)
  const cacheKey = config.appId
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/token')
  url.searchParams.set('grant_type', 'client_credential')
  url.searchParams.set('appid', config.appId)
  url.searchParams.set('secret', config.appSecret)

  const response = await fetch(url)
  const data = (await response.json()) as AccessTokenResponse
  if (!response.ok || !data.access_token) {
    throw new Error(data.errmsg || `微信 access_token 获取失败: HTTP ${response.status}`)
  }

  const expiresInMs = Math.max(Number(data.expires_in ?? 7200) - 120, 60) * 1000
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + expiresInMs })
  return data.access_token
}

function compactText(text: string, maxLength: number) {
  const normalized = text.replace(/[#*_`>\-[\]\n\r]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

/**
 * Send a plain-text customer-service message (客服消息). Unlike a template message,
 * this delivers the full summary as a normal chat message. Requires the recipient to
 * have interacted with the test account within the last 48h (otherwise WeChat rejects
 * with errcode 45015 and the caller should fall back to a template message).
 */
export async function sendWeChatTestAccountText(
  config: WeChatTestAccountConfig,
  message: { title: string; content: string },
) {
  const accessToken = await getWeChatTestAccountAccessToken(config)
  const endpoint = new URL('https://api.weixin.qq.com/cgi-bin/message/custom/send')
  endpoint.searchParams.set('access_token', accessToken)

  // Strip markdown emphasis so it reads cleanly as a plain message; keep newlines.
  const body = `${message.title}\n\n${message.content}`.replace(/\*\*/g, '').replace(/`/g, '').trim()

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ touser: config.openId, msgtype: 'text', text: { content: body } }),
  })
  const data = (await response.json()) as TemplateSendResponse
  if (!response.ok || data.errcode !== 0) {
    throw new Error(data.errmsg || `微信客服消息发送失败: HTTP ${response.status} errcode=${data.errcode}`)
  }
  return { providerMessageId: data.msgid ? String(data.msgid) : undefined }
}

export async function sendWeChatTestAccountTemplate(
  config: WeChatTestAccountConfig,
  message: { title: string; content: string; url?: string },
) {
  const accessToken = await getWeChatTestAccountAccessToken(config)
  const endpoint = new URL('https://api.weixin.qq.com/cgi-bin/message/template/send')
  endpoint.searchParams.set('access_token', accessToken)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: config.openId,
      template_id: config.templateId,
      url: message.url,
      data: {
        thing1: { value: compactText(message.title, 20) },
        thing2: { value: compactText(message.content, 20) },
        remark: { value: compactText(message.content, 120) },
      },
    }),
  })
  const data = (await response.json()) as TemplateSendResponse
  if (!response.ok || data.errcode !== 0) {
    throw new Error(data.errmsg || `微信模板消息发送失败: HTTP ${response.status}`)
  }

  return { providerMessageId: data.msgid ? String(data.msgid) : undefined }
}
