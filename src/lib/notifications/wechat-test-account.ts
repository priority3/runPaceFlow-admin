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
