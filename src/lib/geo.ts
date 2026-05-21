/**
 * IP Geolocation Service
 *
 * Uses ip-api.com (free, no API key) for IP geolocation.
 * Includes in-memory cache to avoid repeated lookups.
 */

export interface GeoResult {
  country: string | null
  region: string | null
  city: string | null
}

const cache = new Map<string, { data: GeoResult; expiry: number }>()
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

// Private/reserved IP ranges - skip geolocation
const PRIVATE_IPS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^::1$/, /^fc/, /^fe/, /^localhost$/i,
]

function isPrivateIP(ip: string): boolean {
  return PRIVATE_IPS.some(p => p.test(ip))
}

function normalizeIP(ip: string): string {
  // Handle IPv6 mapped IPv4
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7)
  }
  return ip
}

export async function getGeoFromIP(ip: string | null | undefined): Promise<GeoResult> {
  if (!ip) return { country: null, region: null, city: null }

  const normalizedIP = normalizeIP(ip)
  if (isPrivateIP(normalizedIP)) return { country: null, region: null, city: null }

  // Check cache
  const cached = cache.get(normalizedIP)
  if (cached && cached.expiry > Date.now()) {
    return cached.data
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${normalizedIP}?fields=status,country,regionName,city`, {
      signal: AbortSignal.timeout(3000),
    })

    if (!res.ok) return { country: null, region: null, city: null }

    const data = await res.json()
    if (data.status !== 'success') return { country: null, region: null, city: null }

    const result: GeoResult = {
      country: data.country || null,
      region: data.regionName || null,
      city: data.city || null,
    }

    // Cache the result
    cache.set(normalizedIP, { data: result, expiry: Date.now() + CACHE_TTL })

    return result
  } catch {
    return { country: null, region: null, city: null }
  }
}

/**
 * Batch geolocation for multiple IPs.
 * Deduplicates IPs to minimize API calls.
 */
export async function batchGetGeo(ips: Array<{ ip: string; id: string }>): Promise<Map<string, GeoResult>> {
  const results = new Map<string, GeoResult>()
  const uniqueIPs = new Map<string, string[]>()

  // Deduplicate IPs
  for (const { ip, id } of ips) {
    const normalized = normalizeIP(ip)
    if (isPrivateIP(normalized)) {
      results.set(id, { country: null, region: null, city: null })
      continue
    }
    if (!uniqueIPs.has(normalized)) {
      uniqueIPs.set(normalized, [])
    }
    uniqueIPs.get(normalized)!.push(id)
  }

  // Look up unique IPs in parallel
  const geoResults = await Promise.all(
    Array.from(uniqueIPs.entries()).map(async ([ip, ids]) => ({
      ip,
      ids,
      geo: await getGeoFromIP(ip),
    }))
  )
  for (const { ids, geo } of geoResults) {
    for (const id of ids) {
      results.set(id, geo)
    }
  }

  return results
}
