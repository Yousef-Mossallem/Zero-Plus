// ======================================================
// ZERO PLUS GATEWAY — detection/ip-reputation.ts  (v3)
// ------------------------------------------------------
// تصنيف IP + إشارات سمعة شبكة للـ Risk / AI / Events
//
// الأنواع: RESIDENTIAL | MOBILE | DATACENTER | VPN_PROXY | TOR | UNKNOWN
//
// المصادر (أرخص → أغلى، متوازية حيث أمكن):
//   1) Private / loopback / bogon           (محلي، بدون شبكة)
//   2) كاش الشبكة: ذاكرة (L1) ثم Redis (L2) — بيخزن geo/ASN/النوع بس
//   3) Tor exit set (Redis) + تحديث تلقائي + إشارة CF (T1)
//   4) هيدرز الحافة (CF / CloudFront / X-Geo-*) — بدون شبكة
//   5) ipapi.is (IP_GEO_LOOKUP=1 + IPAPI_IS_KEY) — الأعلام + ASN + geo
//   6) Backend reputation (per org) — دايمًا طازة، عمرها ما بتتكاش
//
// أهم قواعد التصميم:
//   - الكاش للجزء "الشبكي" فقط. حظر/botnet من الـ backend بيتحسب طازة كل مرة
//     فأي حظر جديد بيظهر فورًا (مش بعد ساعة).
//   - طلبات متزامنة لنفس الـ IP بتتدمج في استدعاء واحد (in-flight dedupe).
//   - circuit breaker على ipapi.is: لو وقعت/اتعملها rate limit بنوقف مؤقتًا.
//   - لو ipapi.is رد، أعلامه (mobile / hosting / vpn / tor) بتتقدم على الـ regex.
//
// لا يقرر ALLOW/BLOCK — يصدّر نتيجة للـ risk / AI / events فقط.
// المتصفح/الجهاز: مش هنا → fingerprint-authenticator
//
// متغيرات بيئة اختيارية:
//   IP_GEO_LOOKUP=1|0            تفعيل/تعطيل ipapi.is
//   IPAPI_IS_KEY=...             مفتاح ipapi.is
//   IPAPI_IS_ALLOW_KEYLESS=1     السماح بالاستدعاء بدون مفتاح (حدود أقل)
//   IP_GEO_TIMEOUT_MS            مهلة ipapi.is (افتراضي 2200)
//   IP_GEO_SKIP_WHEN_EDGE_RICH=1 تخطي ipapi.is لو الحافة ادّت country + ASN
//   IP_REP_TRUST_EDGE_HEADERS=0  تجاهل هيدرز الحافة (لو مش متأكد إنها متنضفة)
//   IP_REP_CACHE_TTL_SEC / IP_REP_CACHE_POOR_TTL_SEC
//   IP_REP_BACKEND_TIMEOUT_MS    مهلة الـ backend (افتراضي 1200)
//   IP_REP_L1_MAX                حجم كاش الذاكرة (افتراضي 5000)
// ======================================================

import { isIP } from 'node:net'
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

export type IpKind = IpTypeValue
// RESIDENTIAL | MOBILE | DATACENTER | VPN_PROXY | TOR | UNKNOWN

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
  /** إشارات أدق */
  isHostingFlag: boolean
  isProxyFlag: boolean
  isCgnat: boolean
  backendKnownBotnet: boolean
  backendRiskPoints: number
  backendScore: number | null
  backendBanned: boolean
  backendAllowlisted: boolean
  /** إشارات إضافية (اختيارية — مفيش كود قديم بيتأثر) */
  isAbuserFlag?: boolean
  isCrawlerFlag?: boolean
  isSatelliteFlag?: boolean
  isAnycastFlag?: boolean
  /** نوع المزوّد حسب ipapi.is: isp | hosting | business | education | government ... */
  providerType?: string | null
  /** أعلى تصنيف abuse للشركة/الـ ASN (0 = Very Low … 0.9 = Very High) */
  providerAbuseTier?: number | null
}

export interface IpReputationResult {
  ip: string
  kind: IpKind
  /** 0 = شبكة موثوقة نسبيًا … 1 = خطر شبكة عالي */
  networkRiskScore: number
  confidence: number
  geo: IpGeo
  asn: IpAsnInfo
  signals: IpReputationSignals
  reasons: string[]
  hints: string[]
  sources: string[]
  timingMs: number
  /** للـ risk.engine */
  badIp: boolean
  /** تلميح 0–30 متوافق مع وزن badIp */
  badIpContributionHint: number
}

export interface IpReputationInput {
  ip: string
  organizationId?: string
  deviceFingerprint?: string | null
  ja3?: string | null
  ja4?: string | null
  headers?: Record<string, string | string[] | undefined>
  useBackend?: boolean
  refreshTorList?: boolean
  /** تخطي الكاش (تشخيص) */
  bypassCache?: boolean
  /** اختياري: الدولة المتوقعة للمستخدم → بيضيف hint من نوع country_mismatch */
  expectedCountry?: string | null
}

// ------------------------------------------------------
// إعدادات
// ------------------------------------------------------

function envNum(name: string, def: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : def
}

const CACHE_PREFIX = 'zp:iprep:v3:'
const NET_PREFIX = `${CACHE_PREFIX}net:`
const CACHE_TTL_RICH_SEC = envNum('IP_REP_CACHE_TTL_SEC', 3600)
const CACHE_TTL_POOR_SEC = envNum('IP_REP_CACHE_POOR_TTL_SEC', 60)

const L1_MAX = envNum('IP_REP_L1_MAX', 5000)
const L1_TTL_RICH_MS = 60_000
const L1_TTL_POOR_MS = 15_000

const TOR_SET_KEY = 'zp:iprep:tor:exits'
const TOR_TMP_KEY = 'zp:iprep:tor:exits:tmp'
const TOR_META_KEY = 'zp:iprep:tor:meta'
const TOR_LOCK_KEY = 'zp:iprep:tor:lock'
const TOR_REFRESH_MS = 6 * 3600_000
const TOR_ENSURE_INTERVAL_MS = 10 * 60_000

const GEO_TIMEOUT_MS = envNum('IP_GEO_TIMEOUT_MS', 2200)
const BACKEND_TIMEOUT_MS = envNum('IP_REP_BACKEND_TIMEOUT_MS', 1200)

function geoLookupEnabled(): boolean {
  if (process.env.IP_GEO_LOOKUP === '0' || process.env.IP_GEO_LOOKUP === 'false') {
    return false
  }
  if (process.env.IP_GEO_LOOKUP === '1' || process.env.IP_GEO_LOOKUP === 'true') {
    return true
  }
  const cfg = (config as { ipReputation?: { geoLookup?: boolean } }).ipReputation
  return cfg?.geoLookup === true
}

function trustEdgeHeaders(): boolean {
  return !(
    process.env.IP_REP_TRUST_EDGE_HEADERS === '0' ||
    process.env.IP_REP_TRUST_EDGE_HEADERS === 'false'
  )
}

// ------------------------------------------------------
// أدوات صغيرة
// ------------------------------------------------------

type Rec = Record<string, unknown>

function rec(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {}
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
    return Number(v)
  }
  return null
}

const warnedAt = new Map<string, number>()
function warnLimited(key: string, msg: string): void {
  const now = Date.now()
  if ((warnedAt.get(key) ?? 0) + 60_000 > now) return
  warnedAt.set(key, now)
  try {
    console.warn(`[ip-reputation] ${msg}`)
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------
// IP helpers — IPv4 + IPv6 (تحقق عبر node:net)
// ------------------------------------------------------

export function normalizeIp(ip: string): string {
  let t = (ip || '').trim()
  if (!t) return ''
  // لو جت قايمة (X-Forwarded-For) ناخد أول عنصر
  const comma = t.indexOf(',')
  if (comma >= 0) t = t.slice(0, comma).trim()
  // [2001:db8::1] أو [2001:db8::1]:443
  const br = /^\[([^\]]+)\](?::\d+)?$/.exec(t)
  if (br) t = br[1]!
  // IPv4:port
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(t)) t = t.replace(/:\d+$/, '')
  // zone id: fe80::1%eth0
  const pct = t.indexOf('%')
  if (pct >= 0) t = t.slice(0, pct)

  const lower = t.toLowerCase()
  // ::ffff:1.2.3.4
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice(7)
    if (isIP(tail) === 4) return tail
    // ::ffff:c0a8:0101
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail)
    if (hex) {
      const a = parseInt(hex[1]!, 16)
      const b = parseInt(hex[2]!, 16)
      return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
    }
  }
  return isIP(lower) === 6 ? lower : t
}

function isIPv4Strict(ip: string): boolean {
  return isIP(ip) === 4
}

function isIPv6(ip: string): boolean {
  return isIP(ip) === 6
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
  if (!base || bitsStr === undefined) return false
  const bits = parseInt(bitsStr, 10)
  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(base)
  if (ipInt < 0 || baseInt < 0 || bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0)
}

/** يفرد IPv6 لـ 8 مجموعات (أرقام 16-bit) */
function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase()
  if (s.includes('.')) {
    const colon = s.lastIndexOf(':')
    const n = ipv4ToInt(s.slice(colon + 1))
    if (n < 0) return null
    s =
      s.slice(0, colon + 1) +
      ((n >>> 16) & 0xffff).toString(16) +
      ':' +
      (n & 0xffff).toString(16)
  }
  const dbl = s.split('::')
  if (dbl.length > 2) return null
  const h = dbl[0] ?? ''
  const head = h ? h.split(':') : []
  let groups: string[]
  if (dbl.length === 2) {
    const t = dbl[1] ?? ''
    const tail = t ? t.split(':') : []
    const missing = 8 - head.length - tail.length
    if (missing < 0) return null
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  const out = groups.map((g) => parseInt(g, 16))
  if (out.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff)) return null
  return out
}

const PRIVATE_V4 = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
]

/** نطاقات محجوزة/وثائقية/multicast — مستحيل تكون عميل حقيقي */
const BOGON_V4 = [
  '0.0.0.0/8',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
]

function isPrivateOrLocal(ip: string): {
  private: boolean
  loopback: boolean
  cgnat: boolean
  bogon: boolean
} {
  const none = { private: false, loopback: false, cgnat: false, bogon: false }

  if (isIPv6(ip)) {
    const g = expandIPv6(ip)
    if (!g) return none
    const allZeroHead = g.slice(0, 7).every((x) => x === 0)
    if (allZeroHead && g[7] === 1) {
      return { private: true, loopback: true, cgnat: false, bogon: false }
    }
    if (allZeroHead && g[7] === 0) {
      return { private: true, loopback: false, cgnat: false, bogon: true }
    }
    const g0 = g[0]!
    const g1 = g[1]!
    // fc00::/7 (ULA) و fe80::/10 (link-local)
    if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80) {
      return { private: true, loopback: false, cgnat: false, bogon: false }
    }
    // ff00::/8 multicast ، 2001:db8::/32 documentation
    if ((g0 & 0xff00) === 0xff00 || (g0 === 0x2001 && g1 === 0x0db8)) {
      return { private: true, loopback: false, cgnat: false, bogon: true }
    }
    return none
  }

  if (!isIPv4Strict(ip)) return none

  if (inCidrV4(ip, '127.0.0.0/8')) {
    return { private: true, loopback: true, cgnat: false, bogon: false }
  }

  const cgnat = inCidrV4(ip, '100.64.0.0/10')
  const priv = cgnat || PRIVATE_V4.some((c) => inCidrV4(ip, c))
  if (priv) return { private: true, loopback: false, cgnat, bogon: false }

  if (BOGON_V4.some((c) => inCidrV4(ip, c))) {
    return { private: true, loopback: false, cgnat: false, bogon: true }
  }
  return none
}

/** مفتاح الكاش الشبكي: IPv4 كامل، IPv6 على مستوى /64 (نفس المشترك) */
function networkCacheKey(ip: string): string {
  if (isIPv6(ip)) {
    const g = expandIPv6(ip)
    if (g) return `v6:${g.slice(0, 4).map((x) => x.toString(16)).join(':')}`
  }
  return ip
}

// ------------------------------------------------------
// قوائم ASN / هيوريستك منظمة
// ------------------------------------------------------

/** ASNs شائعة لمزوّدي سحابة/استضافة (غير شاملة 100% — تُدمج مع flags + اسم AS) */
const DATACENTER_ASN = new Set<number>([
  // AWS
  16509, 14618,
  // Google
  15169, 396982,
  // Microsoft
  8075,
  // Cloudflare / Fastly / Imperva
  13335, 54113, 19551,
  // DigitalOcean / Linode / Akamai
  14061, 62567, 63949, 20940, 16625,
  // OVH / Hetzner / Contabo
  16276, 24940, 51167,
  // Vultr / Choopa
  20473,
  // Oracle / IBM
  31898, 36351,
  // Alibaba / Tencent / Huawei
  45102, 37963, 132203, 45090, 132591, 136907,
  // Hostinger / Leaseweb / Scaleway
  47583, 60781, 12876,
  // M247 / Datacamp / Clouvider / VPN-heavy hosts
  9009, 60068, 212238, 62240, 20860,
  // GoDaddy / IONOS / netcup / WorldStream
  26496, 398101, 8560, 197540, 49981,
  // Hivelocity / ColoCrossing / FranTech / QuadraNet / Equinix Metal / ServerCentral
  29802, 36352, 53667, 8100, 54825, 55286,
])

const HOSTING_ORG_RE =
  /amazon|aws|google\s*cloud|gcp\b|microsoft|azure|digital\s*ocean|linode|akamai|ovh|hetzner|contabo|vultr|choopa|softlayer|ibm\s*cloud|oracle\s*cloud|alibaba|tencent|huawei\s*cloud|hostinger|godaddy|leaseweb|scaleway|upcloud|m247|datacamp|clouvider|colocrossing|psychz|quadranet|serverius|netcup|time4vps|hivelocity|racknerd|buyvm|virmach|hostwinds|cloudflare|fastly|ionos|namecheap|cloud\s*provider|\bhosting\b|\bvps\b|dedicated\s*server|colocation|data\s*center|datacentre/i

const VPN_ORG_RE =
  /vpn|proxy|nord\s*vpn|express\s*vpn|surfshark|cyberghost|private\s*internet|mullvad|proton\s*vpn|windscribe|tunnelbear|purevpn|ipvanish|hide\.me|\bovpn\b|torguard|\bpia\b|socks|datacenter\s*proxy|residential\s*proxy|bright\s*data|luminati|oxylabs|smartproxy|iproyal|packetstream|netnut/i

const MOBILE_ORG_RE =
  /mobile|telecom|telefonica|vodafone|orange|t-?mobile|verizon|\bat&?t\b|sprint|china\s*mobile|china\s*unicom|mtn\b|etisalat|stc\b|mobily|ooredoo|airtel|\bjio\b|telkomsel|safaricom|\bee\b|\bthree\b|telefon|cellular|wireless|gsm|lte|5g\s*network|telecom\s*egypt|\bwe\b\s*internet/i

/** كلمات "موبايل" واضحة جدًا (تُستخدم لما ipapi.is يقول مش موبايل) */
const STRONG_MOBILE_ORG_RE = /mobile|cellular|\blte\b|\bgsm\b|wireless|\b5g\b/i

const RESIDENTIAL_ORG_RE =
  /broadband|cable|fiber|dsl|comcast|virgin\s*media|bt\s*group|deutsche\s*telekom|telecom\s*egypt|te\s*data|residential|isp\b|internet\s*service|fixed\s*line|ftth|adsl/i

/** بادئات IPv4 تقريبية لنطاقات السحابة (hint ضعيف جدًا — آخر حل فقط) */
const DC_PREFIX_HINTS = [
  '3.',
  '13.',
  '18.',
  '34.',
  '35.',
  '52.',
  '54.',
  '104.16.', // CF edge — غالبًا مش origin هجوم؛ confidence أقل
  '104.17.',
  '172.64.',
  '172.65.',
]

// ------------------------------------------------------
// Abuse score (ipapi.is) — "0.0001 (Very Low)" → tier
// ------------------------------------------------------

function parseAbuseTier(v: unknown): number | null {
  const s = str(v)
  if (!s) return null
  const label = /\(([^)]+)\)/.exec(s)?.[1]?.trim().toLowerCase()
  switch (label) {
    case 'very low':
      return 0
    case 'low':
      return 0.1
    case 'elevated':
      return 0.35
    case 'high':
      return 0.65
    case 'very high':
      return 0.9
    default:
      return null
  }
}

// ------------------------------------------------------
// Tor
// ------------------------------------------------------

async function isTorExit(ip: string): Promise<boolean> {
  try {
    return (await getRedis().sismember(TOR_SET_KEY, ip)) === 1
  } catch {
    return false
  }
}

export async function refreshTorExitList(): Promise<{ count: number }> {
  try {
    const r = getRedis()
    const metaRaw = await r.get(TOR_META_KEY)
    if (metaRaw) {
      try {
        const meta = JSON.parse(metaRaw) as { at?: number }
        if (meta.at && Date.now() - meta.at < TOR_REFRESH_MS) {
          return { count: await r.scard(TOR_SET_KEY) }
        }
      } catch {
        /* refresh */
      }
    }

    // قفل موزّع: instance واحدة بس تحدّث (لو عندك أكتر من نسخة جيتواي)
    const lock = await r.set(TOR_LOCK_KEY, '1', 'EX', 120, 'NX')
    if (lock !== 'OK') return { count: await r.scard(TOR_SET_KEY) }

    const url =
      process.env.TOR_EXIT_LIST_URL ||
      'https://check.torproject.org/torbulkexitlist'

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'ZeroPlus-Gateway/ip-reputation' },
    })
    if (!res.ok) return { count: await r.scard(TOR_SET_KEY) }

    const text = await res.text()
    const ips = Array.from(
      new Set(
        text
          .split(/\r?\n/)
          .map((l) => l.trim().toLowerCase())
          .filter((l) => l && !l.startsWith('#') && isIP(l) !== 0),
      ),
    )

    // حماية: لو القايمة صغيرة بشكل مريب منستبدلش القديمة
    if (ips.length < 100) {
      return { count: await r.scard(TOR_SET_KEY) }
    }

    // نكتب في مفتاح مؤقت ثم RENAME (ذري) → مفيش لحظة بتبقى فيها القايمة فاضية
    const pipe = r.pipeline()
    pipe.del(TOR_TMP_KEY)
    for (let i = 0; i < ips.length; i += 400) {
      pipe.sadd(TOR_TMP_KEY, ...ips.slice(i, i + 400))
    }
    pipe.rename(TOR_TMP_KEY, TOR_SET_KEY)
    pipe.set(
      TOR_META_KEY,
      JSON.stringify({ at: Date.now(), count: ips.length }),
      'EX',
      7 * 86400,
    )
    await pipe.exec()
    return { count: ips.length }
  } catch {
    return { count: 0 }
  }
}

let lastTorEnsureAt = 0
/** تحديث تلقائي هادي: أقصى مرة كل 10 دقايق، والتحديث الفعلي كل 6 ساعات */
async function ensureTorList(): Promise<void> {
  const now = Date.now()
  if (now - lastTorEnsureAt < TOR_ENSURE_INTERVAL_MS) return
  lastTorEnsureAt = now
  await refreshTorExitList()
}

// ------------------------------------------------------
// هيدرز الحافة
// ------------------------------------------------------

function headerStr(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | null {
  if (!headers) return null
  const direct = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(direct)) {
    const v = direct.find((x) => x && String(x).trim())
    return v ? String(v).trim() : null
  }
  if (typeof direct === 'string' && direct.trim()) return direct.trim()

  // بحث case-insensitive مفاتيح
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== lower) continue
    if (Array.isArray(v)) {
      const x = v.find((i) => i && String(i).trim())
      return x ? String(x).trim() : null
    }
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function parseAsn(raw: string | null): number | null {
  if (!raw) return null
  const m = raw.trim().match(/^(?:AS)?(\d{1,10})$/i)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

interface EdgeInfo {
  geo: IpGeo
  asn: IpAsnInfo
  sources: string[]
  /** Cloudflare بيرجّع cf-ipcountry = T1 لو الطلب جاي من Tor */
  tor: boolean
}

function emptyEdge(): EdgeInfo {
  return { geo: emptyGeo(), asn: emptyAsn(), sources: [], tor: false }
}

function geoFromHeaders(
  headers?: Record<string, string | string[] | undefined>,
): EdgeInfo {
  if (!headers || !trustEdgeHeaders()) return emptyEdge()
  const sources: string[] = []

  const country =
    headerStr(headers, 'cf-ipcountry') ||
    headerStr(headers, 'cloudfront-viewer-country') ||
    headerStr(headers, 'x-geo-country') ||
    headerStr(headers, 'x-country-code') ||
    headerStr(headers, 'x-appengine-country')

  const city =
    headerStr(headers, 'cf-ipcity') ||
    headerStr(headers, 'x-geo-city') ||
    headerStr(headers, 'cloudfront-viewer-city')

  const region =
    headerStr(headers, 'cf-region') ||
    headerStr(headers, 'cf-region-code') ||
    headerStr(headers, 'x-geo-region') ||
    headerStr(headers, 'cloudfront-viewer-country-region')

  const asnRaw =
    headerStr(headers, 'x-asn') ||
    headerStr(headers, 'cf-asn') ||
    headerStr(headers, 'x-geo-asn') ||
    headerStr(headers, 'cloudfront-viewer-asn')

  const asOrg =
    headerStr(headers, 'x-as-org') ||
    headerStr(headers, 'x-geo-asorg') ||
    headerStr(headers, 'x-asn-org')

  const timezone =
    headerStr(headers, 'x-geo-timezone') || headerStr(headers, 'cf-timezone')

  const cc = country ? country.toUpperCase() : null
  const edgeTor = cc === 'T1'
  const validCountry = cc && cc !== 'XX' && cc !== 'T1' && /^[A-Z]{2}$/.test(cc)

  if (validCountry) sources.push('edge_geo_headers')
  if (asnRaw) sources.push('edge_asn_headers')
  if (edgeTor) sources.push('edge_tor_header')

  const latRaw = headerStr(headers, 'cf-iplatitude')
  const lonRaw = headerStr(headers, 'cf-iplongitude')

  return {
    geo: {
      countryCode: validCountry ? cc : null,
      countryName: null,
      region: region || null,
      city: city || null,
      latitude: num(latRaw),
      longitude: num(lonRaw),
      timezone: timezone || null,
    },
    asn: {
      asn: parseAsn(asnRaw),
      asOrg: asOrg || null,
      network: asOrg || null,
    },
    sources,
    tor: edgeTor,
  }
}

// ------------------------------------------------------
// Geo خارجي (ipapi.is) + circuit breaker
// ------------------------------------------------------

type ExternalGeo = {
  geo: Partial<IpGeo>
  asn: Partial<IpAsnInfo>
  source: string
  proxyFlag: boolean
  hostingFlag: boolean
  mobileFlag: boolean
  torFlag: boolean
  abuserFlag: boolean
  crawlerFlag: boolean
  satelliteFlag: boolean
  anycastFlag: boolean
  providerType: string | null
  companyAbuseTier: number | null
  asnAbuseTier: number | null
  vpnService: string | null
}

const breaker = { fails: 0, openUntil: 0 }

function breakerIsOpen(): boolean {
  return Date.now() < breaker.openUntil
}

function breakerFail(retryAfterSec?: number): void {
  breaker.fails += 1
  if (retryAfterSec && retryAfterSec > 0) {
    breaker.openUntil = Date.now() + Math.min(retryAfterSec, 300) * 1000
  } else if (breaker.fails >= 4) {
    breaker.openUntil = Date.now() + 30_000
  }
}

function breakerOk(): void {
  breaker.fails = 0
  breaker.openUntil = 0
}

async function enrichGeoExternal(
  ip: string,
): Promise<{ data: ExternalGeo | null; hint?: string }> {
  if (!geoLookupEnabled()) return { data: null }
  if (!isIPv4Strict(ip) && !isIPv6(ip)) return { data: null }

  const apiKey = process.env.IPAPI_IS_KEY
  const keyless = process.env.IPAPI_IS_ALLOW_KEYLESS === '1'
  if (!apiKey && !keyless) {
    // بدون مفتاح الرد بيبقى ناقص/محدود → نتجنبه (إلا لو سمحت صراحة)
    warnLimited('nokey', 'IPAPI_IS_KEY غير مضبوط — ipapi.is متوقف')
    return { data: null, hint: 'ipapi_key_missing' }
  }

  if (breakerIsOpen()) return { data: null, hint: 'ipapi_circuit_open' }

  try {
    const url =
      `https://api.ipapi.is/?q=${encodeURIComponent(ip)}` +
      (apiKey ? `&key=${encodeURIComponent(apiKey)}` : '')

    const res = await fetch(url, {
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
      headers: { 'user-agent': 'ZeroPlus-Gateway/ip-reputation' },
    })

    if (!res.ok) {
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'))
        breakerFail(Number.isFinite(ra) && ra > 0 ? ra : 60)
        warnLimited('429', 'ipapi.is rate limit (429)')
        return { data: null, hint: 'ipapi_rate_limited' }
      }
      breakerFail()
      warnLimited(`http${res.status}`, `ipapi.is HTTP ${res.status}`)
      return { data: null, hint: 'ipapi_http_error' }
    }

    const j = rec(await res.json())
    if (str(j.error)) {
      breakerFail()
      warnLimited('apierr', `ipapi.is error: ${String(j.error).slice(0, 120)}`)
      return { data: null, hint: 'ipapi_api_error' }
    }
    breakerOk()

    if (j.is_bogon === true) return { data: null, hint: 'ipapi_bogon' }

    const location = rec(j.location)
    const asnObj = rec(j.asn)
    const company = rec(j.company)

    // رقم الـ ASN (الرد الجديد: object — القديم أحيانًا نص "AS12322 Free SAS")
    let asnNumber: number | null = num(asnObj.asn)
    if (asnNumber == null && typeof j.asn === 'string') {
      const m = /AS(\d+)/i.exec(j.asn)
      if (m) asnNumber = parseInt(m[1]!, 10)
    }

    const asOrg =
      str(asnObj.org) ||
      str(company.name) ||
      (typeof j.company === 'string' ? str(j.company) : null) ||
      null

    if (
      !asnNumber &&
      !asOrg &&
      !str(location.country_code) &&
      !str(location.country)
    ) {
      return { data: null, hint: 'ipapi_empty' }
    }

    const cType = str(company.type)?.toLowerCase() ?? null
    const aType = str(asnObj.type)?.toLowerCase() ?? null
    const providerType =
      cType === 'hosting' || aType === 'hosting' ? 'hosting' : cType || aType

    const vpnObj = rec(j.vpn)

    return {
      data: {
        source: 'ipapi.is',
        geo: {
          countryCode: str(location.country_code)?.toUpperCase() ?? null,
          countryName: str(location.country) || str(j.country),
          region: str(location.state) || str(j.region),
          city: str(location.city) || str(j.city),
          latitude: num(location.latitude) ?? num(j.lat),
          longitude: num(location.longitude) ?? num(j.lon),
          timezone: str(location.timezone) || str(j.timezone),
        },
        asn: {
          asn: asnNumber,
          asOrg,
          // route (CIDR) أدق من range النصي
          network: str(asnObj.route) || str(company.network),
        },
        proxyFlag: j.is_proxy === true || j.is_vpn === true,
        hostingFlag: j.is_datacenter === true,
        mobileFlag: j.is_mobile === true,
        torFlag: j.is_tor === true,
        abuserFlag: j.is_abuser === true,
        crawlerFlag: j.is_crawler === true,
        satelliteFlag: j.is_satellite === true,
        anycastFlag: j.is_anycast === true,
        providerType,
        companyAbuseTier: parseAbuseTier(company.abuser_score),
        asnAbuseTier: parseAbuseTier(asnObj.abuser_score),
        vpnService: str(vpnObj.service)?.slice(0, 40) ?? null,
      },
    }
  } catch {
    breakerFail()
    warnLimited('timeout', 'ipapi.is timeout/network error')
    return { data: null, hint: 'ipapi_timeout' }
  }
}

// ------------------------------------------------------
// تصنيف مركّب
// ------------------------------------------------------

function classifyKind(params: {
  tor: boolean
  asn: number | null
  asOrg: string | null
  proxyFlag: boolean
  hostingFlag: boolean
  mobileFlag: boolean
  /** هل ipapi.is رد فعلًا (يعني الأعلام موثوقة، وغيابها = "لا") */
  providerKnown: boolean
  providerType: string | null
  ip: string
}): { kind: IpKind; reasons: string[]; confidence: number } {
  const reasons: string[] = []
  const org = params.asOrg || ''
  const pType = params.providerType
  const providerSaysIsp = params.providerKnown && pType === 'isp'

  if (params.tor) {
    reasons.push('tor_exit_list')
    return { kind: 'TOR', reasons, confidence: 0.97 }
  }

  if (params.proxyFlag) {
    reasons.push('provider_proxy_flag')
    return { kind: 'VPN_PROXY', reasons, confidence: 0.9 }
  }

  if (VPN_ORG_RE.test(org)) {
    reasons.push('as_org_vpn_keyword')
    return {
      kind: 'VPN_PROXY',
      reasons,
      confidence: providerSaysIsp ? 0.62 : 0.82,
    }
  }

  // Datacenter: ASN معروف > hosting flag > نوع المزوّد > كلمات الـ org
  if (params.asn != null && DATACENTER_ASN.has(params.asn)) {
    reasons.push(`datacenter_asn:${params.asn}`)
    return { kind: 'DATACENTER', reasons, confidence: 0.9 }
  }

  if (params.hostingFlag) {
    reasons.push('provider_hosting_flag')
    return { kind: 'DATACENTER', reasons, confidence: 0.88 }
  }

  if (params.providerKnown && pType === 'hosting') {
    reasons.push('provider_type_hosting')
    return { kind: 'DATACENTER', reasons, confidence: 0.8 }
  }

  if (HOSTING_ORG_RE.test(org)) {
    // لو المزوّد قال ISP أو موبايل، كلمة استضافة في الاسم مش كفاية
    if (providerSaysIsp || params.mobileFlag) {
      reasons.push('hosting_keyword_overridden_by_provider')
    } else {
      reasons.push('as_org_hosting_keyword')
      return { kind: 'DATACENTER', reasons, confidence: 0.75 }
    }
  }

  // موبايل: أعلام المزوّد أقوى من الـ regex
  if (params.mobileFlag) {
    reasons.push('provider_mobile_flag')
    return { kind: 'MOBILE', reasons, confidence: 0.85 }
  }

  if (params.providerKnown) {
    // ipapi.is قال "مش موبايل" → نصدّقه إلا لو الاسم فيه كلمة موبايل صريحة
    if (STRONG_MOBILE_ORG_RE.test(org)) {
      reasons.push('as_org_mobile_strong')
      return { kind: 'MOBILE', reasons, confidence: 0.55 }
    }
  } else if (MOBILE_ORG_RE.test(org)) {
    reasons.push('as_org_mobile')
    return { kind: 'MOBILE', reasons, confidence: 0.7 }
  }

  if (providerSaysIsp) {
    reasons.push('provider_type_isp')
    return { kind: 'RESIDENTIAL', reasons, confidence: 0.72 }
  }

  if (RESIDENTIAL_ORG_RE.test(org)) {
    reasons.push('as_org_residential')
    return { kind: 'RESIDENTIAL', reasons, confidence: 0.68 }
  }

  if (
    params.providerKnown &&
    (pType === 'business' || pType === 'education' || pType === 'government')
  ) {
    reasons.push(`provider_type_${pType}`)
    return { kind: 'RESIDENTIAL', reasons, confidence: 0.5 }
  }

  // آخر حل: بادئة سحابة تقريبية — فقط لو مفيش أي معلومة ASN/org
  if (
    params.asn == null &&
    !org &&
    isIPv4Strict(params.ip) &&
    DC_PREFIX_HINTS.some((p) => params.ip.startsWith(p))
  ) {
    reasons.push('ipv4_prefix_cloud_hint')
    return { kind: 'DATACENTER', reasons, confidence: 0.45 }
  }

  if (params.asn == null && !org) {
    reasons.push('insufficient_asn_data')
    return { kind: 'UNKNOWN', reasons, confidence: 0.28 }
  }

  // افتراض محافظ: ISP غير مصنّف → residential بثقة منخفضة
  reasons.push('default_residential_assumption')
  return { kind: 'RESIDENTIAL', reasons, confidence: 0.42 }
}

function networkRiskForKind(
  kind: IpKind,
  signals: IpReputationSignals,
  confidence: number,
): number {
  const UNKNOWN_BASE = 0.38
  let s = 0
  switch (kind) {
    case 'TOR':
      s = 0.93
      break
    case 'VPN_PROXY':
      s = 0.74
      break
    case 'DATACENTER':
      s = 0.66
      break
    case 'UNKNOWN':
      s = UNKNOWN_BASE
      break
    case 'MOBILE':
      s = 0.11
      break
    case 'RESIDENTIAL':
      s = 0.07
      break
    default:
      s = 0.32
  }

  // تصنيف ضعيف الثقة → نقرّب الخطر من منطقة "مجهول" بدل ما نبالغ
  if (confidence < 0.7 && s > UNKNOWN_BASE) {
    s = UNKNOWN_BASE + (s - UNKNOWN_BASE) * (confidence / 0.7)
  }

  if (signals.backendAllowlisted) {
    return Math.min(s, 0.05)
  }
  if (signals.backendKnownBotnet) s = Math.max(s, 0.92)
  if (signals.backendBanned) s = Math.max(s, 0.96)
  if (signals.backendRiskPoints >= 15) s = Math.min(1, s + 0.2)
  else if (signals.backendRiskPoints >= 8) s = Math.min(1, s + 0.12)
  if (signals.backendScore != null && signals.backendScore >= 8) {
    s = Math.min(1, s + 0.12)
  } else if (signals.backendScore != null && signals.backendScore >= 5) {
    s = Math.min(1, s + 0.06)
  }

  // سمعة الـ abuse عند المزوّد (الشركة أقوى من الـ ASN)
  const bump = (t: number | null | undefined): number =>
    t == null ? 0 : t >= 0.9 ? 0.15 : t >= 0.65 ? 0.09 : t >= 0.35 ? 0.04 : 0
  const abuseBump = Math.max(
    bump(signals.providerAbuseTier),
    0, // الـ tier المجمّع محسوب مسبقًا (max شركة، نص ASN)
  )
  if (abuseBump > 0) s = Math.min(1, s + abuseBump)
  if (signals.isAbuserFlag === true) {
    s = Math.min(1, s + (kind === 'MOBILE' ? 0.05 : 0.1))
  }

  if (signals.isCgnat) s = Math.min(1, s + 0.03)

  return Math.max(0, Math.min(1, Number(s.toFixed(4))))
}

function computeBadIp(
  kind: IpKind,
  signals: IpReputationSignals,
  networkRiskScore: number,
  confidence: number,
): boolean {
  if (signals.backendAllowlisted) return false
  if (signals.isTorExit || kind === 'TOR') return true
  if (signals.backendKnownBotnet || signals.backendBanned) return true
  if (kind === 'VPN_PROXY') return true
  // datacenter بثقة ضعيفة (مجرد hint) ما يتحسبش IP سيء
  if (kind === 'DATACENTER' && networkRiskScore >= 0.55 && confidence >= 0.6) {
    return true
  }
  if (signals.backendRiskPoints >= 10) return true
  if (signals.backendScore != null && signals.backendScore >= 8) return true
  return false
}

// ------------------------------------------------------
// البروفايل الشبكي (الجزء اللي بيتكاش) — بدون أي حاجة خاصة بالـ org
// ------------------------------------------------------

interface NetworkProfile {
  v: 3
  kind: IpKind
  confidence: number
  geo: IpGeo
  asn: IpAsnInfo
  reasons: string[]
  hints: string[]
  sources: string[]
  providerKnown: boolean
  providerType: string | null
  /** max(شركة، ASN/2) كـ tier */
  abuseTier: number | null
  flags: {
    proxy: boolean
    hosting: boolean
    mobile: boolean
    tor: boolean
    abuser: boolean
    crawler: boolean
    satellite: boolean
    anycast: boolean
  }
  rich: boolean
}

async function buildNetworkProfile(
  ip: string,
  edge: EdgeInfo,
): Promise<NetworkProfile> {
  const sources: string[] = []
  const hints: string[] = []
  const reasonsExtra: string[] = []

  let geo: IpGeo = { ...edge.geo }
  let asn: IpAsnInfo = { ...edge.asn }

  const flags = {
    proxy: false,
    hosting: false,
    mobile: false,
    tor: false,
    abuser: false,
    crawler: false,
    satellite: false,
    anycast: false,
  }
  let providerKnown = false
  let providerType: string | null = null
  let abuseTier: number | null = null

  const edgeRich = Boolean(edge.geo.countryCode && edge.asn.asn != null)
  const skipExt =
    edgeRich &&
    (process.env.IP_GEO_SKIP_WHEN_EDGE_RICH === '1' ||
      process.env.IP_GEO_SKIP_WHEN_EDGE_RICH === 'true')
  const lookupExpected = geoLookupEnabled() && !skipExt

  if (lookupExpected) {
    const r = await enrichGeoExternal(ip)
    if (r.hint) hints.push(r.hint)
    const ext = r.data
    if (ext) {
      providerKnown = true
      sources.push(ext.source)
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
      flags.proxy = ext.proxyFlag
      flags.hosting = ext.hostingFlag
      flags.mobile = ext.mobileFlag
      flags.tor = ext.torFlag
      flags.abuser = ext.abuserFlag
      flags.crawler = ext.crawlerFlag
      flags.satellite = ext.satelliteFlag
      flags.anycast = ext.anycastFlag
      providerType = ext.providerType

      const c = ext.companyAbuseTier
      const a = ext.asnAbuseTier
      const aHalf = a == null ? null : a * 0.5
      abuseTier =
        c == null && aHalf == null ? null : Math.max(c ?? 0, aHalf ?? 0)

      if (ext.vpnService) reasonsExtra.push(`vpn_service:${ext.vpnService}`)
    }
  }

  const classified = classifyKind({
    tor: flags.tor,
    asn: asn.asn,
    asOrg: asn.asOrg,
    proxyFlag: flags.proxy,
    hostingFlag: flags.hosting,
    mobileFlag: flags.mobile,
    providerKnown,
    providerType,
    ip,
  })

  // لو الغني = جبنا الأعلام فعلًا، أو الحافة كافية ومش مستنيين ipapi
  const rich =
    flags.tor ||
    providerKnown ||
    (!lookupExpected && Boolean(geo.countryCode && asn.asn != null))

  return {
    v: 3,
    kind: classified.kind,
    confidence: classified.confidence,
    geo,
    asn,
    reasons: [...classified.reasons, ...reasonsExtra],
    hints,
    sources,
    providerKnown,
    providerType,
    abuseTier,
    flags,
    rich,
  }
}

// ------------------------------------------------------
// كاش: L1 (ذاكرة) + L2 (Redis) + dedupe للطلبات المتزامنة
// ------------------------------------------------------

const l1 = new Map<string, { exp: number; v: NetworkProfile }>()

function l1Get(key: string): NetworkProfile | null {
  const e = l1.get(key)
  if (!e) return null
  if (e.exp < Date.now()) {
    l1.delete(key)
    return null
  }
  // LRU: نحرّكه لآخر الـ Map
  l1.delete(key)
  l1.set(key, e)
  return e.v
}

function l1Set(key: string, v: NetworkProfile, ttlMs: number): void {
  if (l1.has(key)) l1.delete(key)
  else if (l1.size >= L1_MAX) {
    const oldest = l1.keys().next().value
    if (oldest !== undefined) l1.delete(oldest)
  }
  l1.set(key, { exp: Date.now() + ttlMs, v })
}

function validProfile(p: unknown): p is NetworkProfile {
  const o = rec(p)
  return (
    o.v === 3 &&
    typeof o.kind === 'string' &&
    typeof o.confidence === 'number' &&
    Object.keys(rec(o.geo)).length > 0 &&
    Object.keys(rec(o.asn)).length > 0 &&
    Object.keys(rec(o.flags)).length > 0 &&
    Array.isArray(o.reasons) &&
    Array.isArray(o.hints) &&
    Array.isArray(o.sources)
  )
}

async function readNetCache(key: string): Promise<NetworkProfile | null> {
  try {
    const raw = await getRedis().get(NET_PREFIX + key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return validProfile(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeNetCache(key: string, p: NetworkProfile): Promise<void> {
  try {
    await getRedis().set(
      NET_PREFIX + key,
      JSON.stringify(p),
      'EX',
      p.rich ? CACHE_TTL_RICH_SEC : CACHE_TTL_POOR_SEC,
    )
  } catch {
    /* ignore */
  }
}

const inflightNet = new Map<string, Promise<NetworkProfile>>()

async function getNetworkProfile(
  ip: string,
  edge: EdgeInfo,
  bypass: boolean,
): Promise<{
  profile: NetworkProfile
  cache: 'memory_cache' | 'redis_cache' | null
}> {
  const key = networkCacheKey(ip)

  if (!bypass) {
    const m = l1Get(key)
    if (m) return { profile: m, cache: 'memory_cache' }

    const r = await readNetCache(key)
    if (r) {
      l1Set(key, r, r.rich ? L1_TTL_RICH_MS : L1_TTL_POOR_MS)
      return { profile: r, cache: 'redis_cache' }
    }

    const running = inflightNet.get(key)
    if (running) return { profile: await running, cache: null }
  }

  const p = buildNetworkProfile(ip, edge)
  inflightNet.set(key, p)
  try {
    const profile = await p
    l1Set(key, profile, profile.rich ? L1_TTL_RICH_MS : L1_TTL_POOR_MS)
    void writeNetCache(key, profile)
    return { profile, cache: null }
  } finally {
    if (inflightNet.get(key) === p) inflightNet.delete(key)
  }
}

// ------------------------------------------------------
// Backend lookup مع مهلة (طازة دائمًا) + dedupe
// ------------------------------------------------------

const inflightBackend = new Map<string, Promise<ReputationLookupData | null>>()

async function safeBackendLookup(
  input: IpReputationInput,
): Promise<ReputationLookupData | null> {
  if (!input.organizationId) return null

  const k = [
    input.organizationId,
    input.ip,
    input.deviceFingerprint ?? '',
    input.ja3 ?? '',
    input.ja4 ?? '',
  ].join('|')

  const running = inflightBackend.get(k)
  if (running) return running

  const run = (async (): Promise<ReputationLookupData | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const work = lookupReputation({
        organizationId: input.organizationId as string,
        ipAddress: input.ip,
        deviceFingerprint: input.deviceFingerprint ?? undefined,
        ja3Fingerprint: input.ja3 ?? undefined,
        ja4Fingerprint: input.ja4 ?? undefined,
      })
      const timed = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), BACKEND_TIMEOUT_MS)
      })
      const res = await Promise.race([work, timed])
      return (res as ReputationLookupData) || null
    } catch {
      return null
    } finally {
      if (timer) clearTimeout(timer)
    }
  })()

  inflightBackend.set(k, run)
  try {
    return await run
  } finally {
    if (inflightBackend.get(k) === run) inflightBackend.delete(k)
  }
}

// ------------------------------------------------------
// التقييم الرئيسي
// ------------------------------------------------------

function countryMismatchHint(
  actual: string | null,
  expected?: string | null,
): string[] {
  if (expected && actual && actual.toUpperCase() !== expected.toUpperCase()) {
    return [`country_mismatch:${actual}!=${expected.toUpperCase()}`]
  }
  return []
}

export async function inspectIpReputation(
  input: IpReputationInput,
): Promise<IpReputationResult> {
  const start = Date.now()
  const ip = normalizeIp(input.ip)
  const reasons: string[] = []
  const hints: string[] = []
  const sources: string[] = ['local_rules']

  // عنوان غير صالح
  if (!ip || (!isIPv4Strict(ip) && !isIPv6(ip))) {
    return {
      ip: ip || '0.0.0.0',
      kind: 'UNKNOWN',
      networkRiskScore: 0.4,
      confidence: 0.2,
      geo: emptyGeo(),
      asn: emptyAsn(),
      signals: emptySignals(),
      reasons: ['invalid_ip'],
      hints: ['invalid_ip_format'],
      sources,
      timingMs: Date.now() - start,
      badIp: false,
      badIpContributionHint: 8,
    }
  }

  // 1) خاص / loopback / CGNAT / bogon (محلي وسريع — قبل أي كاش)
  const loc = isPrivateOrLocal(ip)
  if (loc.private || loc.loopback) {
    return {
      ip,
      kind: 'UNKNOWN',
      networkRiskScore: 0,
      confidence: 1,
      geo: emptyGeo(),
      asn: emptyAsn(),
      signals: {
        ...emptySignals(),
        isPrivate: loc.private,
        isLoopback: loc.loopback,
        isCgnat: loc.cgnat,
      },
      reasons: [
        loc.loopback
          ? 'loopback'
          : loc.cgnat
            ? 'cgnat_shared'
            : loc.bogon
              ? 'reserved_bogon'
              : 'private_ip',
      ],
      hints: ['skip_public_reputation'],
      sources,
      timingMs: Date.now() - start,
      badIp: false,
      badIpContributionHint: 0,
    }
  }

  if (input.refreshTorList) {
    void refreshTorExitList()
  } else {
    void ensureTorList()
  }

  // 2) هيدرز الحافة
  const edge = geoFromHeaders(input.headers)
  sources.push(...edge.sources)

  // 3) Tor + بروفايل الشبكة (كاش/ipapi) + Backend بالتوازي
  const useBackend = input.useBackend !== false && Boolean(input.organizationId)

  const [torRedis, net, backend] = await Promise.all([
    isTorExit(ip),
    getNetworkProfile(ip, edge, input.bypassCache === true),
    useBackend ? safeBackendLookup({ ...input, ip }) : Promise.resolve(null),
  ])

  const p = net.profile
  if (net.cache) sources.push(net.cache)
  sources.push(...p.sources)

  const tor = torRedis || edge.tor || p.flags.tor
  if (torRedis) sources.push('tor_exit_redis')

  if (backend) sources.push('backend_reputation')
  else if (useBackend) hints.push('backend_lookup_miss_or_timeout')

  hints.push(...p.hints)

  // geo/asn: بيانات البروفايل + ملء النواقص من الحافة (حتى مع الكاش)
  const geo: IpGeo = {
    countryCode: p.geo.countryCode ?? edge.geo.countryCode,
    countryName: p.geo.countryName ?? edge.geo.countryName,
    region: p.geo.region ?? edge.geo.region,
    city: p.geo.city ?? edge.geo.city,
    latitude: p.geo.latitude ?? edge.geo.latitude,
    longitude: p.geo.longitude ?? edge.geo.longitude,
    timezone: p.geo.timezone ?? edge.geo.timezone,
  }
  const asn: IpAsnInfo = {
    asn: p.asn.asn ?? edge.asn.asn,
    asOrg: p.asn.asOrg ?? edge.asn.asOrg,
    network: p.asn.network ?? edge.asn.network,
  }

  // النوع النهائي (Tor الحي بيكسب)
  let kind: IpKind = p.kind
  let confidence = p.confidence
  reasons.push(...p.reasons)
  if (tor && kind !== 'TOR') {
    kind = 'TOR'
    confidence = 0.97
    reasons.unshift(torRedis ? 'tor_exit_list' : 'tor_edge_or_provider_flag')
  }

  const b = backend

  const signals: IpReputationSignals = {
    isPrivate: false,
    isLoopback: false,
    isTorExit: tor,
    isDatacenterLikely: kind === 'DATACENTER',
    isVpnLikely: kind === 'VPN_PROXY',
    isMobileLikely: kind === 'MOBILE',
    isResidentialLikely: kind === 'RESIDENTIAL',
    isHostingFlag: p.flags.hosting,
    isProxyFlag: p.flags.proxy,
    isCgnat: false,
    backendKnownBotnet: b?.effective?.isKnownBotnet === true,
    backendRiskPoints: b?.effective?.reputationRiskPoints ?? 0,
    backendScore: b?.found ? b.effective.score : null,
    backendBanned: b?.effective?.isCurrentlyBanned === true,
    backendAllowlisted: b?.effective?.isAllowlisted === true,
    isAbuserFlag: p.flags.abuser,
    isCrawlerFlag: p.flags.crawler,
    isSatelliteFlag: p.flags.satellite,
    isAnycastFlag: p.flags.anycast,
    providerType: p.providerType,
    providerAbuseTier: p.abuseTier,
  }

  if (kind === 'TOR') hints.push('tor_network')
  if (kind === 'DATACENTER') hints.push('hosting_network')
  if (kind === 'VPN_PROXY') hints.push('vpn_or_proxy')
  if (!geo.countryCode) hints.push('geo_missing')
  if (asn.asn == null) hints.push('asn_missing')
  if (signals.backendAllowlisted) hints.push('backend_allowlisted')

  // إشارات إضافية ذكية
  if (p.flags.crawler) hints.push('known_crawler')
  if (p.flags.satellite) hints.push('satellite_network')
  if (p.flags.anycast) hints.push('anycast_ip')
  if (p.flags.abuser) hints.push('provider_abuser_flag')
  if (kind === 'MOBILE' || p.flags.satellite) hints.push('shared_ip_likely')
  if (!p.providerKnown && geoLookupEnabled() && !p.hints.some((h) => h.startsWith('ipapi_'))) {
    hints.push('provider_data_unavailable')
  }

  // تناقض الحافة مع ipapi.is (hint فقط — بيغذّي geo_anomaly_hint)
  if (
    p.providerKnown &&
    edge.geo.countryCode &&
    p.geo.countryCode &&
    edge.geo.countryCode !== p.geo.countryCode
  ) {
    hints.push(`country_edge_mismatch:${p.geo.countryCode}!=${edge.geo.countryCode}`)
  }
  hints.push(...countryMismatchHint(geo.countryCode, input.expectedCountry))

  const networkRiskScore = networkRiskForKind(kind, signals, confidence)
  const badIp = computeBadIp(kind, signals, networkRiskScore, confidence)
  const badIpContributionHint = Math.round(
    Math.min(30, networkRiskScore * 28 + (badIp ? 4 : 0)),
  )

  return {
    ip,
    kind,
    networkRiskScore,
    confidence: Number(confidence.toFixed(3)),
    geo,
    asn,
    signals,
    reasons,
    hints: Array.from(new Set(hints)),
    sources: Array.from(new Set(sources)),
    timingMs: Date.now() - start,
    badIp,
    badIpContributionHint,
  }
}

// ------------------------------------------------------
// فراغات مساعدة
// ------------------------------------------------------

function emptyGeo(): IpGeo {
  return {
    countryCode: null,
    countryName: null,
    region: null,
    city: null,
    latitude: null,
    longitude: null,
    timezone: null,
  }
}

function emptyAsn(): IpAsnInfo {
  return { asn: null, asOrg: null, network: null }
}

function emptySignals(): IpReputationSignals {
  return {
    isPrivate: false,
    isLoopback: false,
    isTorExit: false,
    isDatacenterLikely: false,
    isVpnLikely: false,
    isMobileLikely: false,
    isResidentialLikely: false,
    isHostingFlag: false,
    isProxyFlag: false,
    isCgnat: false,
    backendKnownBotnet: false,
    backendRiskPoints: 0,
    backendScore: null,
    backendBanned: false,
    backendAllowlisted: false,
  }
}

// ------------------------------------------------------
// تصدير للـ AI + أحداث
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

/** شكل مختصر متوافق مع AnalyzeRequest.ip_reputation */
export function ipReputationToAnalyzePayload(
  r: IpReputationResult,
): Record<string, unknown> {
  return {
    score: Math.round(r.networkRiskScore * 100),
    is_tor_exit: r.signals.isTorExit || r.kind === 'TOR',
    is_proxy: r.kind === 'VPN_PROXY' || r.signals.isProxyFlag,
    is_datacenter: r.kind === 'DATACENTER' || r.signals.isHostingFlag,
    is_known_attacker:
      r.signals.backendKnownBotnet || r.signals.backendBanned || r.badIp,
    asn: r.asn.asn,
    asn_org: r.asn.asOrg,
    country: r.geo.countryCode,
    city: r.geo.city,
    geo_anomaly_hint: r.hints.find((h) => h.startsWith('country_')) || null,
    reputation_sources: r.sources,
    raw: {
      kind: r.kind,
      confidence: r.confidence,
      reasons: r.reasons,
      networkRiskScore: r.networkRiskScore,
      // إضافات داخل raw فقط (مفيش تغيير في شكل الحقول الأساسية)
      provider_type: r.signals.providerType ?? null,
      provider_abuse_tier: r.signals.providerAbuseTier ?? null,
      is_abuser: r.signals.isAbuserFlag === true,
      is_crawler: r.signals.isCrawlerFlag === true,
      is_satellite: r.signals.isSatelliteFlag === true,
      shared_ip_likely: r.hints.includes('shared_ip_likely'),
      hints: r.hints,
    },
  }
}

export function geoAnomalyHint(
  r: IpReputationResult,
  expectedCountry?: string | null,
): string[] {
  return countryMismatchHint(r.geo.countryCode, expectedCountry)
}

export default {
  inspectIpReputation,
  ipReputationForAi,
  ipReputationToAnalyzePayload,
  refreshTorExitList,
  geoAnomalyHint,
  normalizeIp,
}