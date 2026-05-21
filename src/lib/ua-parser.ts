/**
 * User-Agent Parser
 *
 * Lightweight UA parsing for browser, OS, and device type detection.
 * No external dependencies - uses regex patterns.
 */

export interface ParsedUA {
  browser: string
  os: string
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown'
}

const BROWSER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /Edg\/(\d+)/, name: 'Edge' },
  { pattern: /OPR\/(\d+)/, name: 'Opera' },
  { pattern: /Chrome\/(\d+)/, name: 'Chrome' },
  { pattern: /Safari\/(\d+)/, name: 'Safari' },
  { pattern: /Firefox\/(\d+)/, name: 'Firefox' },
  { pattern: /MSIE (\d+)/, name: 'IE' },
  { pattern: /Trident\/.*rv:(\d+)/, name: 'IE' },
]

const OS_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /Windows NT 10\.0/, name: 'Windows 10+' },
  { pattern: /Windows NT 6\.3/, name: 'Windows 8.1' },
  { pattern: /Windows NT 6\.2/, name: 'Windows 8' },
  { pattern: /Windows NT 6\.1/, name: 'Windows 7' },
  { pattern: /Windows/, name: 'Windows' },
  { pattern: /Mac OS X (\d+[._]\d+)/, name: 'macOS' },
  { pattern: /Android (\d+)/, name: 'Android' },
  { pattern: /iPhone OS (\d+[._]\d+)/, name: 'iOS' },
  { pattern: /iPad.*OS (\d+[._]\d+)/, name: 'iPadOS' },
  { pattern: /CrOS/, name: 'ChromeOS' },
  { pattern: /Linux/, name: 'Linux' },
]

const BOT_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /scraper/i, /curl/i, /wget/i,
  /Googlebot/i, /Bingbot/i, /YandexBot/i, /BaiduSpider/i,
]

const MOBILE_PATTERNS = [
  /Android.*Mobile/i, /iPhone/i, /iPod/i, /Windows Phone/i,
  /BlackBerry/i, /Opera Mini/i, /Opera Mobi/i,
]

const TABLET_PATTERNS = [
  /iPad/i, /Android(?!.*Mobile)/i, /Tablet/i,
]

export function parseUserAgent(ua: string | null | undefined): ParsedUA {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', deviceType: 'unknown' }

  // Check for bots first
  for (const pattern of BOT_PATTERNS) {
    if (pattern.test(ua)) {
      return { browser: 'Bot', os: 'Unknown', deviceType: 'bot' }
    }
  }

  // Detect device type
  let deviceType: ParsedUA['deviceType'] = 'desktop'
  for (const pattern of TABLET_PATTERNS) {
    if (pattern.test(ua)) {
      deviceType = 'tablet'
      break
    }
  }
  if (deviceType === 'desktop') {
    for (const pattern of MOBILE_PATTERNS) {
      if (pattern.test(ua)) {
        deviceType = 'mobile'
        break
      }
    }
  }

  // Detect browser
  let browser = 'Unknown'
  for (const { pattern, name } of BROWSER_PATTERNS) {
    if (pattern.test(ua)) {
      browser = name
      break
    }
  }

  // Detect OS
  let os = 'Unknown'
  for (const { pattern, name } of OS_PATTERNS) {
    if (pattern.test(ua)) {
      os = name
      break
    }
  }

  return { browser, os, deviceType }
}
