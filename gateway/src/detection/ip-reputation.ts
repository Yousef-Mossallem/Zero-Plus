// ======================================================
// ZERO PLUS GATEWAY — detection/ip-reputation.ts
// ------------------------------------------------------
// تصنيف IP + إشارات سمعة شبكة للـ Risk / AI / Events
//
// الأنواع: RESIDENTIAL | MOBILE | DATACENTER | VPN_PROXY | TOR | UNKNOWN
//
// المصادر (طبقات، من الأرخص → الأغنى):
//   1) نطاقات خاصة / محلية
//   2) قوائم Tor exit (Redis كاش + fetch اختياري)
//   3) ASN / بادئات datacenter معروفة (هيوريستك + كاش)
//   4) Backend reputation lookup (إن وُجد)
//   5) Geo (بلد/ASN) عبر مزود اختياري أو هيدرز الحافة
//
// لا يقرر ALLOW/BLOCK — يُصدّر نتيجة غنية للـ risk و AI.
// ======================================================

import { createHash } from 'node:crypto'
import { getRedis } from '../services/redis.client'
import {
  lookupReputation,
  type ReputationLookupData,
  type IpTypeValue,
} from '../services/backend.client'
import { config } from '../config'

// ------------------------------------------------------
// أنواع
// ------------------------------------------------------

export type IpKind = IpTypeValue // RESIDENTIAL | MOBILE | DATACENTER | VPN_PROXY | TOR | UNKNOWN

export interface IpGeo {
  countryCode: string | null
  countryName: string | null
  region: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  timezone: string | null
}

export interface IpAsnInfo {
  asn: number | null
  asOrg: string | null
  /** ISP / hosting label إن وُجد */
  network: string | null
}

export interface IpReputationSignals {
  isPrivate: boolean
  isLoopback: boolean
  isTorExit: boolean
  isDatacenterLikely: boolean
  isVpnLikely: boolean
  isMobileLikely: boolean
  isResidentialLikely: boolean
  /** من Backend إن وُجد */
  backendKnownBotnet: boolean
  backendRiskPoints: number
  backendScore: number | null
  backendBanned: boolean
}

export interface IpReputationResult {
  ip: string
  kind: IpKind
  /** 0 = موثوق نسبيًا … 1 = خطر شبكة عالي */
  networkRiskScore: number
  confidence: number
  geo: IpGeo
  asn: IpAsnInfo
  signals: IpReputationSignals
  /** أسباب التصنيف */
  reasons: string[]
  /** تلميحات للـ AI */
  hints: string[]
  /** مصدر كل معلومة */
  sources: string[]
  timingMs: number
  /** للـ risk.engine: badIp */
  badIp: boolean
  /** نقاط تقريبية 0–30 متوافقة مع وزن badIp في risk */
  badIpContributionHint: number
}

export interface IpReputationInput {
  ip: string
  organizationId?: string
  deviceFingerprint?: string | null
  ja3?: string | null
  ja4?: string | null
  /**
   * هيدرز من Nginx/Cloudflare إن وُجدت
   * CF-IPCountry, X-Geo-Country, X-ASN, ...
   */
  headers?: Record<string, string | string[] | undefined>
  /** استدعاء Backend lookup (افتراضي true لو organizationId موجود) */
  useBackend?: boolean
  /** تحديث قوائم Tor من الإنترنت (ثقيل — كاش Redis) */
  refreshTorList?: boolean
}

// ------------------------------------------------------
// كاش Redis
// ------------------------------------------------------

const CACHE_PREFIX = 'zp:iprep:'
const CACHE_TTL_SEC = 600
const TOR_SET_KEY = 'zp:iprep:tor:exits'
const TOR_META_KEY = 'zp:iprep:tor:meta'

function cacheKey(ip: string, org?: string): string {
  return `${CACHE_PREFIX}${org || 'global'}:${ip}`
}

// ------------------------------------------------------
// IP helpers
// ------------------------------------------------------

function normalizeIp(ip: string): string {
  const t = (ip || '').trim()
  // IPv4-mapped IPv6
  if (t.startsWith('::ffff:')) return t.slice(7)
  return t
}

function isIPv4(ip: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)
}

function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map((x) => parseInt(x, 10))
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return -1
  }
  return (
    ((p[0]! << 24) >>> 0) +
    ((p[1]! << 16) >>> 0) +
    ((p[2]! << 8) >>> 0) +
    (p[3]! >>> 0)
  )
}

function inCidrV4(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/')
  if (!base || !bitsStr) return false
  const bits = parseInt(bitsStr, 10)
  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(base)
  if (ipInt < 0 || baseInt < 0 || bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

function isPrivateOrLocal(ip: string): {
  private: boolean
  loopback: boolean
} {
  if (ip === '::1' || ip === '127.0.0.1') {
    return { private: true, loopback: true }
  }
  if (!isIPv4(ip)) {
    // IPv6 unique local / link-local تقريب
    const lower = ip.toLowerCase()
    if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) {
      return { private: true, loopback: false }
    }
    return { private: false, loopback: false }
  }
  const priv = [
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '100.64.0.0/10',
  ]
  const loop = inCidrV4(ip, '127.0.0.0/8')
  const isPriv = priv.some((c) => inCidrV4(ip, c))
  return { private: isPriv, loopback: loop }
}

// ------------------------------------------------------
// ASN / Datacenter / VPN هيوريستك (قابلة للتوسعة)
// ------------------------------------------------------

/** ASNs استضافة شائعة (عيّنة — زِد من threat intel) */
const DATACENTER_ASN = new Set<number>([
  16509, // Amazon
  14618, // Amazon
  15169, // Google
  396982, // Google
  8075, // Microsoft
  13335, // Cloudflare (edge — غالبًا مش origin زائر)
  14061, // DigitalOcean
  63949, // Linode/Akamai
  20473, // Choopa/Vultr
  16276, // OVH
  24940, // Hetzner
  51167, // Contabo
  62567, // DigitalOcean
  136907, // Huawei Cloud
  45090, // Tencent
  37963, // Alibaba
  31898, // Oracle
  36351, // SoftLayer/IBM
  60068, // CDN77
  9009, // M247 (كثير VPN)
  212238, // Datacamp
  62240, // Clouvider
])

/** كلمات في asOrg تدل على استضافة/VPN */
const HOSTING_ORG_RE =
  /amazon|aws|google\s*cloud|microsoft|azure|digital\s*ocean|linode|akamai|ovh|hetzner|contabo|vultr|choopa|softlayer|ibm\s*cloud|oracle|alibaba|tencent|huawei\s*cloud|hostinger|godaddy|leaseweb|scaleway|upcloud|m247|datacamp|clouvider|colocrossing|psychz|quadranet|serverius|netcup|time4vps|vps|dedicated|cloud\s*provider|hosting/i

const VPN_ORG_RE =
  /vpn|proxy|nord\s*vpn|express\s*vpn|surfshark|cyberghost|private\s*internet|mullvad|proton|windscribe|tunnelbear|purevpn|ipvanish|hide\.me|ovpn|torguard|pia\b|socks|datacenter\s*proxy/i

const MOBILE_ORG_RE =
  /mobile|telecom|telefonica|vodafone|orange|t-?mobile|verizon|at&t|sprint|china\s*mobile|mtn|etisalat|stc|mobily|ooredoo|airtel|jio|telkomsel|safaricom|ee\b|three\b|telefon/i

const RESIDENTIAL_ORG_RE =
  /telecom|broadband|cable|fiber|dsl|comcast|virgin\s*media|bt\s*group|deutsche\s*telekom|orange|vodafone|telecom\s*egypt|te\s*data|we\s*internet|etisalat|stc|zain|residential/i

// بادئات IPv4 معروفة كـ cloud (عيّنة صغيرة)
const DC_PREFIX_HINTS = [
  '3.', // AWS أجزاء
  '13.',
  '18.',
  '34.', // GCP أجزاء
  '35.',
  '52.',
  '54.',
]

// ------------------------------------------------------
// Tor exits
// ------------------------------------------------------

async function isTorExit(ip: string): Promise<boolean> {
  try {
    const r = getRedis()
    const hit = await r.sismember(TOR_SET_KEY, ip)
    return hit === 1
  } catch {
    return false
  }
}

/**
 * تحديث قائمة Tor exit (اختياري — يستدعيه cron أو أول طلب)
 * المصدر الكلاسيكي: https://check.torproject.org/torbulkexitlist
 */
export async function refreshTorExitList(): Promise<{ count: number }> {
  try {
    const r = getRedis()
    const meta = await r.get(TOR_META_KEY)
    if (meta) {
      const j = JSON.parse(meta) as { at: number }
      // لا تحدّث أكثر من مرة كل 6 ساعات
      if (Date.now() - j.at < 6 * 3600_000) {
        const c = await r.scard(TOR_SET_KEY)
        return { count: c }
      }
    }

    const url =
      process.env.TOR_EXIT_LIST_URL ||
      'https://check.torproject.org/torbulkexitlist'
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'ZeroPlus-Gateway/1.0' },
    })
    if (!res.ok) return { count: await r.scard(TOR_SET_KEY) }
    const text = await res.text()
    const ips = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && isIPv4(l))

    if (ips.length > 100) {
      const pipe = r.pipeline()
      pipe.del(TOR_SET_KEY)
      for (let i = 0; i < ips.length; i += 500) {
        const slice = ips.slice(i, i + 500)
        pipe.sadd(TOR_SET_KEY, ...slice)
      }
      pipe.set(
        TOR_META_KEY,
        JSON.stringify({ at: Date.now(), count: ips.length }),
        'EX',
        7 * 86400,
      )
      await pipe.exec()
      return { count: ips.length }
    }
    return { count: await r.scard(TOR_SET_KEY) }
  } catch {
    return { count: 0 }
  }
}

// ------------------------------------------------------
// Geo من الهيدرز
// ------------------------------------------------------

function headerStr(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | null {
  if (!headers) return null
  const v = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(v)) return v[0] || null
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function geoFromHeaders(
  headers?: Record<string, string | string[] | undefined>,
): { geo: IpGeo; asn: IpAsnInfo; sources: string[] } {
  const sources: string[] = []
  const country =
    headerStr(headers, 'cf-ipcountry') ||
    headerStr(headers, 'x-geo-country') ||
    headerStr(headers, 'x-country-code') ||
    headerStr(headers, 'cloudfront-viewer-country')

  const city =
    headerStr(headers, 'cf-ipcity') ||
    headerStr(headers, 'x-geo-city') ||
    null
  const region =
    headerStr(headers, 'cf-region') ||
    headerStr(headers, 'x-geo-region') ||
    null
  const asnRaw =
    headerStr(headers, 'x-asn') ||
    headerStr(headers, 'cf-asn') ||
    headerStr(headers, 'x-geo-asn')
  const asOrg =
    headerStr(headers, 'x-as-org') ||
    headerStr(headers, 'x-geo-asorg') ||
    null

  if (country) sources.push('edge_geo_headers')
  if (asnRaw) sources.push('edge_asn_headers')

  const asnNum = asnRaw ? parseInt(asnRaw.replace(/^AS/i, ''), 10) : NaN

  return {
    geo: {
      countryCode: country && country !== 'XX' ? country.toUpperCase() : null,
      countryName: null,
      region,
      city,
      latitude: null,
      longitude: null,
      timezone: headerStr(headers, 'x-geo-timezone'),
    },
    asn: {
      asn: Number.isFinite(asnNum) ? asnNum : null,
      asOrg,
      network: asOrg,
    },
    sources,
  }
}

/**
 * Geo خارجي اختياري (ipapi / ip-api / خدمة داخلية)
 * يُفعَّل عبر config أو ENV
 */
async function enrichGeoExternal(
  ip: string,
): Promise<{ geo: Partial<IpGeo>; asn: Partial<IpAsnInfo>; source?: string } | null> {
  const enabled =
    process.env.IP_GEO_LOOKUP === '1' ||
    (config as { ipReputation?: { geoLookup?: boolean } }).ipReputation
      ?.geoLookup === true
  if (!enabled) return null
  if (!isIPv4(ip) || isPrivateOrLocal(ip).private) return null

  try {
    // ip-api.com مجاني للاستخدام غير التجاري — بدّل بمزودك
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,lat,lon,timezone,as,asname,org,mobile,proxy,hosting`
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return null
    const j = (await res.json()) as Record<string, unknown>
    if (j.status !== 'success') return null

    const asStr = String(j.as || '')
    const asnMatch = asStr.match(/AS(\d+)/i)
    return {
      source: 'ip-api',
      geo: {
        countryCode: (j.countryCode as string) || null,
        countryName: (j.country as string) || null,
        region: (j.regionName as string) || null,
        city: (j.city as string) || null,
        latitude: typeof j.lat === 'number' ? j.lat : null,
        longitude: typeof j.lon === 'number' ? j.lon : null,
        timezone: (j.timezone as string) || null,
      },
      asn: {
        asn: asnMatch ? parseInt(asnMatch[1]!, 10) : null,
        asOrg: (j.asname as string) || (j.org as string) || null,
        network: (j.org as string) || null,
      },
    }
  } catch {
    return null
  }
}

// ------------------------------------------------------
// تصنيف
// ------------------------------------------------------

function classifyKind(params: {
  tor: boolean
  asn: number | null
  asOrg: string | null
  proxyFlag?: boolean
  hostingFlag?: boolean
  mobileFlag?: boolean
  ip: string
}): { kind: IpKind; reasons: string[]; confidence: number } {
  const reasons: string[] = []
  let confidence = 0.4

  if (params.tor) {
    reasons.push('tor_exit_list')
    return { kind: 'TOR', reasons, confidence: 0.95 }
  }

  if (params.proxyFlag) {
    reasons.push('provider_proxy_flag')
    confidence = 0.85
    return { kind: 'VPN_PROXY', reasons, confidence }
  }

  const org = params.asOrg || ''
  if (VPN_ORG_RE.test(org)) {
    reasons.push('as_org_vpn_keyword')
    return { kind: 'VPN_PROXY', reasons, confidence: 0.8 }
  }

  if (
    params.hostingFlag ||
    (params.asn != null && DATACENTER_ASN.has(params.asn)) ||
    HOSTING_ORG_RE.test(org)
  ) {
    if (params.asn != null && DATACENTER_ASN.has(params.asn)) {
      reasons.push(`datacenter_asn:${params.asn}`)
      confidence = 0.88
    } else if (params.hostingFlag) {
      reasons.push('provider_hosting_flag')
      confidence = 0.85
    } else {
      reasons.push('as_org_hosting_keyword')
      confidence = 0.72
    }
    return { kind: 'DATACENTER', reasons, confidence }
  }

  // تلميح بادئة
  if (isIPv4(params.ip) && DC_PREFIX_HINTS.some((p) => params.ip.startsWith(p))) {
    reasons.push('ipv4_prefix_cloud_hint')
    return { kind: 'DATACENTER', reasons, confidence: 0.55 }
  }

  if (params.mobileFlag || MOBILE_ORG_RE.test(org)) {
    reasons.push(params.mobileFlag ? 'provider_mobile_flag' : 'as_org_mobile')
    return { kind: 'MOBILE', reasons, confidence: 0.7 }
  }

  if (RESIDENTIAL_ORG_RE.test(org)) {
    reasons.push('as_org_residential')
    return { kind: 'RESIDENTIAL', reasons, confidence: 0.65 }
  }

  if (params.asn == null && !org) {
    reasons.push('insufficient_asn_data')
    return { kind: 'UNKNOWN', reasons, confidence: 0.3 }
  }

  reasons.push('default_residential_assumption')
  return { kind: 'RESIDENTIAL', reasons, confidence: 0.45 }
}

function networkRiskForKind(kind: IpKind, signals: IpReputationSignals): number {
  let s = 0
  switch (kind) {
    case 'TOR':
      s = 0.92
      break
    case 'VPN_PROXY':
      s = 0.72
      break
    case 'DATACENTER':
      s = 0.65
      break
    case 'UNKNOWN':
      s = 0.35
      break
    case 'MOBILE':
      s = 0.12
      break
    case 'RESIDENTIAL':
      s = 0.08
      break
    default:
      s = 0.3
  }
  if (signals.backendKnownBotnet) s = Math.max(s, 0.9)
  if (signals.backendBanned) s = Math.max(s, 0.95)
  if (signals.backendRiskPoints >= 10) s = Math.min(1, s + 0.15)
  if (signals.backendScore != null && signals.backendScore >= 7) {
    s = Math.min(1, s + 0.1)
  }
  return Math.max(0, Math.min(1, s))
}

// ------------------------------------------------------
// التقييم الرئيسي
// ------------------------------------------------------

export async function inspectIpReputation(
  input: IpReputationInput,
): Promise<IpReputationResult> {
  const start = Date.now()
  const ip = normalizeIp(input.ip)
  const reasons: string[] = []
  const hints: string[] = []
  const sources: string[] = ['local_rules']

  // كاش
  try {
    const raw = await getRedis().get(cacheKey(ip, input.organizationId))
    if (raw) {
      const cached = JSON.parse(raw) as IpReputationResult
      return { ...cached, sources: [...cached.sources, 'redis_cache'] }
    }
  } catch {
    /* ignore */
  }

  if (input.refreshTorList) {
    void refreshTorExitList()
  }

  const loc = isPrivateOrLocal(ip)
  if (loc.private || loc.loopback) {
    const result: IpReputationResult = {
      ip,
      kind: 'UNKNOWN',
      networkRiskScore: 0,
      confidence: 1,
      geo: {
        countryCode: null,
        countryName: null,
        region: null,
        city: null,
        latitude: null,
        longitude: null,
        timezone: null,
      },
      asn: { asn: null, asOrg: null, network: null },
      signals: {
        isPrivate: loc.private,
        isLoopback: loc.loopback,
        isTorExit: false,
        isDatacenterLikely: false,
        isVpnLikely: false,
        isMobileLikely: false,
        isResidentialLikely: false,
        backendKnownBotnet: false,
        backendRiskPoints: 0,
        backendScore: null,
        backendBanned: false,
      },
      reasons: [loc.loopback ? 'loopback' : 'private_ip'],
      hints: ['skip_public_reputation'],
      sources,
      timingMs: Date.now() - start,
      badIp: false,
      badIpContributionHint: 0,
    }
    return result
  }

  // Geo headers
  const fromHeaders = geoFromHeaders(input.headers)
  sources.push(...fromHeaders.sources)
  let geo = fromHeaders.geo
  let asn = fromHeaders.asn

  // Tor
  const tor = await isTorExit(ip)
  if (tor) sources.push('tor_exit_redis')

  // External geo (اختياري)
  const ext = await enrichGeoExternal(ip)
  let proxyFlag = false
  let hostingFlag = false
  let mobileFlag = false
  if (ext) {
    sources.push(ext.source || 'external_geo')
    geo = {
      countryCode: ext.geo.countryCode ?? geo.countryCode,
      countryName: ext.geo.countryName ?? geo.countryName,
      region: ext.geo.region ?? geo.region,
      city: ext.geo.city ?? geo.city,
      latitude: ext.geo.latitude ?? geo.latitude,
      longitude: ext.geo.longitude ?? geo.longitude,
      timezone: ext.geo.timezone ?? geo.timezone,
    }
    asn = {
      asn: ext.asn.asn ?? asn.asn,
      asOrg: ext.asn.asOrg ?? asn.asOrg,
      network: ext.asn.network ?? asn.network,
    }
  }

  // Backend reputation
  let backend: ReputationLookupData | null = null
  const useBackend =
    input.useBackend !== false && Boolean(input.organizationId)
  if (useBackend && input.organizationId) {
    try {
      backend = await lookupReputation({
        organizationId: input.organizationId,
        ipAddress: ip,
        deviceFingerprint: input.deviceFingerprint ?? undefined,
        ja3Fingerprint: input.ja3 ?? undefined,
        ja4Fingerprint: input.ja4 ?? undefined,
      })
      sources.push('backend_reputation')
    } catch {
      hints.push('backend_lookup_failed')
    }
  }

  const signals: IpReputationSignals = {
    isPrivate: false,
    isLoopback: false,
    isTorExit: tor,
    isDatacenterLikely: false,
    isVpnLikely: false,
    isMobileLikely: false,
    isResidentialLikely: false,
    backendKnownBotnet: backend?.effective.isKnownBotnet === true,
    backendRiskPoints: backend?.effective.reputationRiskPoints ?? 0,
    backendScore: backend?.found ? backend.effective.score : null,
    backendBanned: backend?.effective.isCurrentlyBanned === true,
  }

  const classified = classifyKind({
    tor,
    asn: asn.asn,
    asOrg: asn.asOrg,
    proxyFlag,
    hostingFlag,
    mobileFlag,
    ip,
  })
  reasons.push(...classified.reasons)

  signals.isDatacenterLikely = classified.kind === 'DATACENTER'
  signals.isVpnLikely = classified.kind === 'VPN_PROXY'
  signals.isMobileLikely = classified.kind === 'MOBILE'
  signals.isResidentialLikely = classified.kind === 'RESIDENTIAL'

  if (classified.kind === 'TOR') hints.push('tor_network')
  if (classified.kind === 'DATACENTER') hints.push('hosting_network')
  if (classified.kind === 'VPN_PROXY') hints.push('vpn_or_proxy')
  if (!geo.countryCode) hints.push('geo_missing')
  if (asn.asn == null) hints.push('asn_missing')

  const networkRiskScore = networkRiskForKind(classified.kind, signals)
  const badIp =
    signals.isTorExit ||
    signals.backendKnownBotnet ||
    signals.backendBanned ||
    (classified.kind === 'DATACENTER' && networkRiskScore >= 0.6) ||
    classified.kind === 'VPN_PROXY' ||
    classified.kind === 'TOR' ||
    (signals.backendRiskPoints >= 10)

  const badIpContributionHint = Math.round(
    Math.min(30, networkRiskScore * 30 + (badIp ? 5 : 0)),
  )

  const result: IpReputationResult = {
    ip,
    kind: classified.kind,
    networkRiskScore,
    confidence: classified.confidence,
    geo,
    asn,
    signals,
    reasons,
    hints,
    sources,
    timingMs: Date.now() - start,
    badIp,
    badIpContributionHint,
  }

  try {
    await getRedis().set(
      cacheKey(ip, input.organizationId),
      JSON.stringify(result),
      'EX',
      CACHE_TTL_SEC,
    )
  } catch {
    /* ignore */
  }

  return result
}

// ------------------------------------------------------
// تصدير للـ AI
// ------------------------------------------------------

export function ipReputationForAi(
  r: IpReputationResult,
): Record<string, unknown> {
  return {
    kind: 'ip_reputation_telemetry',
    ip: r.ip,
    ipKind: r.kind,
    networkRiskScore: r.networkRiskScore,
    confidence: r.confidence,
    badIp: r.badIp,
    badIpContributionHint: r.badIpContributionHint,
    geo: r.geo,
    asn: r.asn,
    signals: r.signals,
    reasons: r.reasons,
    hints: r.hints,
    sources: r.sources,
    timingMs: r.timingMs,
  }
}

/** مقارنة بسيطة: IP country vs توقع (مثلاً من حساب الشركة) */
export function geoAnomalyHint(
  r: IpReputationResult,
  expectedCountry?: string | null,
): string[] {
  const out: string[] = []
  if (
    expectedCountry &&
    r.geo.countryCode &&
    r.geo.countryCode.toUpperCase() !== expectedCountry.toUpperCase()
  ) {
    out.push(
      `country_mismatch:${r.geo.countryCode}!=${expectedCountry.toUpperCase()}`,
    )
  }
  return out
}

export default {
  inspectIpReputation,
  ipReputationForAi,
  refreshTorExitList,
  geoAnomalyHint,
}