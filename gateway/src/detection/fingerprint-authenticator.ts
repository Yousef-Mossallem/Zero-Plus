// ======================================================
// ZERO PLUS GATEWAY — detection/fingerprint-authenticator.ts
// ------------------------------------------------------
// مسؤولية الملف:
//   1) استخراج بصمة TLS (JA3 / JA4) من هيدرز الحافة (Nginx) فقط
//   2) استخراج / تطبيع بصمة الجهاز (device fingerprint)
//   3) منع التزوير: أي X-JA4 / X-JA3 جاي من الزائر مباشرة من غير Edge يُتجاهل
//   4) إخراج بيانات نظيفة تدخل RequestContext → risk.engine / ban / reputation
//
// مش مسؤول عن:
//   - قرار ALLOW/BLOCK (ده risk + policy)
//   - كتابة Redis ban (ban.manager)
//   - تصنيف Datacenter (ip-reputation)
//
// تطوير: من غير Nginx → ja4/ja3 = null والدالة تكمّل عادي
// إنتاج: Nginx يبعت X-JA4 / X-JA3 / X-TLS-* / X-Edge-Server
// ======================================================

import type { IncomingHttpHeaders } from 'http'
import type { Signals } from '../types'

// ------------------------------------------------------
// ثوابت الهيدرز (متوافقة مع conf.d/gateway.conf)
// ------------------------------------------------------

/** هيدر يؤكد إن الطلب عدّى من Nginx بتاع Zero Plus */
export const HEADER_EDGE_SERVER = 'x-edge-server'

/** بصمة JA4 من الحافة */
export const HEADER_JA4 = 'x-ja4'

/** بصمة JA3 من الحافة */
export const HEADER_JA3 = 'x-ja3'

export const HEADER_TLS_VERSION = 'x-tls-version'
export const HEADER_TLS_CIPHER = 'x-tls-cipher'

/**
 * بصمة الجهاز — يرسلها المتصفح بعد JS أو تُحفظ في كوكي.
 * الـ Gateway نفسه يقدر يضبط الكوكي لاحقًا؛ هنا بنقرأ فقط.
 */
export const HEADER_DEVICE_FP = 'x-device-fingerprint'
export const COOKIE_DEVICE_FP = 'zp_fp'

/** قيمة X-Edge-Server المتوقعة من nginx.conf */
export const EXPECTED_EDGE_TOKEN = 'zero-plus-nginx'

// ------------------------------------------------------
// أنواع الخرج
// ------------------------------------------------------

export interface TlsFingerprint {
  /** JA4 خام بعد التنظيف — null لو مش متاح */
  ja4: string | null
  /** JA3 خام بعد التنظيف */
  ja3: string | null
  tlsVersion: string | null
  tlsCipher: string | null
  /**
   * true = الهيدرز جاية من حافة موثوقة (Nginx)
   * false = طلب مباشر على الـ Gateway (تطوير) أو محاولة تزوير
   */
  fromTrustedEdge: boolean
}

export interface DeviceFingerprintInfo {
  /** المعرّف بعد التطبيع — أو null */
  value: string | null
  /** منين اتقرأت */
  source: 'header' | 'cookie' | 'none'
}

export interface FingerprintAuthResult {
  tls: TlsFingerprint
  device: DeviceFingerprintInfo
  /**
   * ملخص جاهز للدمج في Signals / RequestContext
   */
  forSignals: Pick<
    Signals,
    'ja4' | 'ja3' | 'deviceFingerprint'
  >
  /**
   * ملاحظات للـ logging / risk reasons (مش أخطاء قاتلة)
   */
  notes: string[]
}

/** مدخل مرن: Fastify request أو كائن مبسّط في الاختبارات */
export interface FingerprintAuthInput {
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>
  /** كوكي خام: "a=1; zp_fp=abc" أو object */
  cookies?: Record<string, string | undefined> | string | undefined
  /** لو معروف من config إننا وراء Nginx */
  trustEdgeHeader?: boolean
  /** تجاوز قيمة X-Edge-Server المتوقعة (اختبارات) */
  expectedEdgeToken?: string
}

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------

function headerValue(
  headers: FingerprintAuthInput['headers'],
  name: string,
): string | null {
  const key = name.toLowerCase()
  // Node يطبع الهيدرز lower-case
  const raw =
    (headers as Record<string, string | string[] | undefined>)[key] ??
    (headers as Record<string, string | string[] | undefined>)[name]

  if (raw === undefined || raw === null) return null
  const v = Array.isArray(raw) ? raw[0] : raw
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * تطبيع بصمة TLS: طول معقول + حروف مسموحة فقط
 * (منع حقن لوج / قيم عشوائية طويلة)
 */
function sanitizeTlsFingerprint(value: string | null, maxLen = 256): string | null {
  if (!value) return null
  const cleaned = value.trim()
  if (cleaned.length < 4 || cleaned.length > maxLen) return null
  // JA3 غالبًا hex بأرقام وفواصل؛ JA4 فيه حروف و _ و -
  if (!/^[a-zA-Z0-9_,.=:\-]+$/.test(cleaned)) return null
  return cleaned
}

/**
 * تطبيع device fingerprint
 */
function sanitizeDeviceFp(value: string | null, maxLen = 128): string | null {
  if (!value) return null
  const cleaned = value.trim()
  if (cleaned.length < 8 || cleaned.length > maxLen) return null
  if (!/^[a-zA-Z0-9_\-:.=]+$/.test(cleaned)) return null
  return cleaned
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

function resolveCookies(input: FingerprintAuthInput): Record<string, string> {
  if (!input.cookies) {
    const fromHeader = headerValue(input.headers, 'cookie')
    return parseCookieHeader(fromHeader)
  }
  if (typeof input.cookies === 'string') {
    return parseCookieHeader(input.cookies)
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.cookies)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  return out
}

/**
 * هل نثق إن الطلب عدّى من Nginx؟
 * - وجود X-Edge-Server = القيمة المتوقعة
 * - أو trustEdgeHeader=true من config (شبكة داخلية مضمونة)
 */
function isTrustedEdge(
  headers: FingerprintAuthInput['headers'],
  trustEdgeHeader: boolean,
  expectedToken: string,
): boolean {
  const edge = headerValue(headers, HEADER_EDGE_SERVER)
  if (edge && edge === expectedToken) return true
  // في بعض البيئات الـ Gateway ورا reverse proxy داخلي بدون الهيدر —
  // فقط لو الإعداد صرّح بذلك
  if (trustEdgeHeader && edge === null) {
    // لا نعتبره موثوق تلقائيًا من غير هيدر؛ أفضل أمانًا
    return false
  }
  return false
}

// ------------------------------------------------------
// المنطق الرئيسي
// ------------------------------------------------------

/**
 * يستخرج بصمات TLS + الجهاز من الطلب الحالي.
 * آمن للتطوير (من غير Nginx) وللإنتاج (مع Edge).
 */
export function authenticateFingerprints(
  input: FingerprintAuthInput,
): FingerprintAuthResult {
  const notes: string[] = []
  const expected =
    input.expectedEdgeToken ?? EXPECTED_EDGE_TOKEN
  const trustFlag = input.trustEdgeHeader === true

  const trusted = isTrustedEdge(input.headers, trustFlag, expected)

  // ---- TLS من الحافة فقط ----
  let ja4: string | null = null
  let ja3: string | null = null
  let tlsVersion: string | null = null
  let tlsCipher: string | null = null

  if (trusted) {
    ja4 = sanitizeTlsFingerprint(headerValue(input.headers, HEADER_JA4))
    ja3 = sanitizeTlsFingerprint(headerValue(input.headers, HEADER_JA3))
    tlsVersion = sanitizeTlsFingerprint(
      headerValue(input.headers, HEADER_TLS_VERSION),
      64,
    )
    tlsCipher = sanitizeTlsFingerprint(
      headerValue(input.headers, HEADER_TLS_CIPHER),
      128,
    )

    if (!ja4 && !ja3) {
      notes.push('trusted_edge_without_ja_fingerprint')
    }
  } else {
    // طلب مباشر على الـ Gateway أو هيدر مزوّر
    const spoofedJa4 = headerValue(input.headers, HEADER_JA4)
    const spoofedJa3 = headerValue(input.headers, HEADER_JA3)
    if (spoofedJa4 || spoofedJa3) {
      notes.push('ignored_untrusted_ja_headers')
    }
    notes.push('no_trusted_edge')
    // tls version/cipher كمان مش موثوقين لو الزائر يقدر يزوّدهم كـ headers
  }

  // ---- Device fingerprint: هيدر ثم كوكي ----
  const cookies = resolveCookies(input)
  let deviceValue: string | null = null
  let deviceSource: DeviceFingerprintInfo['source'] = 'none'

  const fromHeader = sanitizeDeviceFp(
    headerValue(input.headers, HEADER_DEVICE_FP),
  )
  if (fromHeader) {
    deviceValue = fromHeader
    deviceSource = 'header'
  } else {
    const fromCookie = sanitizeDeviceFp(cookies[COOKIE_DEVICE_FP] ?? null)
    if (fromCookie) {
      deviceValue = fromCookie
      deviceSource = 'cookie'
    }
  }

  if (!deviceValue) {
    notes.push('no_device_fingerprint')
  }

  const tls: TlsFingerprint = {
    ja4,
    ja3,
    tlsVersion,
    tlsCipher,
    fromTrustedEdge: trusted,
  }

  const device: DeviceFingerprintInfo = {
    value: deviceValue,
    source: deviceSource,
  }

  return {
    tls,
    device,
    forSignals: {
      ja4: tls.ja4,
      ja3: tls.ja3,
      deviceFingerprint: device.value,
    },
    notes,
  }
}

/**
 * دمج النتيجة في كائن Signals موجود (mutate أو نسخة).
 */
export function applyFingerprintsToSignals(
  signals: Signals,
  result: FingerprintAuthResult,
): Signals {
  return {
    ...signals,
    ja4: result.forSignals.ja4,
    ja3: result.forSignals.ja3,
    deviceFingerprint: result.forSignals.deviceFingerprint,
  }
}

/**
 * هل البصمة كافية للمقارنة مع banlist على مستوى الجهاز؟
 */
export function hasUsableDeviceFingerprint(
  result: FingerprintAuthResult,
): boolean {
  return result.device.value !== null
}

/**
 * مفتاح تجميع للـ Redis / ban (IP + device إن وُجد).
 */
export function buildFingerprintBanKey(params: {
  orgId: string
  ip: string
  deviceFingerprint: string | null
}): string {
  if (params.deviceFingerprint) {
    return `ban:dev:${params.orgId}:${params.deviceFingerprint}`
  }
  return `ban:ip:${params.orgId}:${params.ip}`
}

/**
 * مساعدة من Fastify request مباشرة
 *
 * مثال:
 *   const fp = authenticateFromFastifyRequest(request, { trustEdgeHeader: false })
 */
export function authenticateFromFastifyRequest(
  request: {
    headers: IncomingHttpHeaders
    cookies?: Record<string, string | undefined>
  },
  options?: {
    trustEdgeHeader?: boolean
    expectedEdgeToken?: string
  },
): FingerprintAuthResult {
  return authenticateFingerprints({
    headers: request.headers,
    cookies: request.cookies,
    trustEdgeHeader: options?.trustEdgeHeader,
    expectedEdgeToken: options?.expectedEdgeToken,
  })
}

// ------------------------------------------------------
// تصدير افتراضي مريح
// ------------------------------------------------------

export default {
  authenticateFingerprints,
  authenticateFromFastifyRequest,
  applyFingerprintsToSignals,
  hasUsableDeviceFingerprint,
  buildFingerprintBanKey,
  HEADER_EDGE_SERVER,
  HEADER_JA4,
  HEADER_JA3,
  HEADER_DEVICE_FP,
  COOKIE_DEVICE_FP,
  EXPECTED_EDGE_TOKEN,
}