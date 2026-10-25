// ======================================================
// ZERO PLUS GATEWAY — challenge/clearance.ts
// ------------------------------------------------------
// Clearance = كوكي موقّع بعد نجاح التحدي
// المدة من سياسة الشركة: passTokenTtlMinutes (افتراضي 60)
//
// السيرفر يوقّع HMAC؛ الزائر ما يقدرش يزوّر من غير السر
// ======================================================

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config'
import type { OrgPolicyFromBackend } from '../services/backend.client'

// ------------------------------------------------------
// Defaults = Prisma: passTokenTtlMinutes = 60
// ------------------------------------------------------

export const CLEARANCE_DEFAULTS = {
  ttlMinutes: 60,
  cookieName: 'zp_clearance', // يفضّل يطابق config.clearance.cookieName
  version: 1,
} as const

// ------------------------------------------------------
// أنواع
// ------------------------------------------------------

export interface ClearancePolicy {
  /** مدة الصلاحية بالدقائق — من الباك */
  ttlMinutes: number
}

export interface ClearancePayload {
  v: number
  /** organizationId */
  o: string
  /** ip وقت الإصدار (اختياري للربط) */
  ip: string
  /** device fp إن وُجد */
  d: string | null
  /** issued at unix sec */
  iat: number
  /** expire at unix sec */
  exp: number
  /** nonce */
  n: string
}

export interface IssueClearanceInput {
  organizationId: string
  ip: string
  deviceFingerprint?: string | null
  /** passTokenTtlMinutes من سياسة الشركة */
  policy?: Partial<ClearancePolicy> | Partial<OrgPolicyFromBackend> | null
}

export interface VerifyClearanceInput {
  token: string
  organizationId: string
  ip: string
  deviceFingerprint?: string | null
  /** لو true: IP لازم يطابق (أشد) */
  bindIp?: boolean
  /** لو true: الجهاز لازم يطابق لو كان مربوط */
  bindDevice?: boolean
}

export interface VerifyClearanceResult {
  valid: boolean
  reason?:
    | 'missing'
    | 'malformed'
    | 'bad_signature'
    | 'expired'
    | 'org_mismatch'
    | 'ip_mismatch'
    | 'device_mismatch'
  payload?: ClearancePayload
  /** ثواني متبقية */
  secondsLeft?: number
}

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------

function secret(): string {
  const s = config.clearance?.secret || process.env.CLEARANCE_SECRET
  if (!s || s.length < 16) {
    throw new Error('[clearance] CLEARANCE secret missing or too short')
  }
  return s
}

function cookieName(): string {
  return config.clearance?.cookieName || CLEARANCE_DEFAULTS.cookieName
}

function clampTtlMinutes(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return CLEARANCE_DEFAULTS.ttlMinutes
  }
  // بين 1 دقيقة و 7 أيام
  return Math.min(60 * 24 * 7, Math.max(1, Math.floor(n)))
}

export function resolveClearanceTtlMinutes(
  policy?: Partial<ClearancePolicy> | Partial<OrgPolicyFromBackend> | null,
): number {
  if (!policy || typeof policy !== 'object') {
    return config.clearance?.ttlSeconds
      ? Math.max(1, Math.floor(config.clearance.ttlSeconds / 60))
      : CLEARANCE_DEFAULTS.ttlMinutes
  }
  const r = policy as Record<string, unknown>
  return clampTtlMinutes(
    r.ttlMinutes ?? r.passTokenTtlMinutes ?? CLEARANCE_DEFAULTS.ttlMinutes,
  )
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function b64urlJson(obj: unknown): string {
  return b64url(Buffer.from(JSON.stringify(obj), 'utf8'))
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64')
}

function sign(bodyB64: string): string {
  const mac = createHmac('sha256', secret()).update(bodyB64).digest()
  return b64url(mac)
}

function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

// ------------------------------------------------------
// Issue
// ------------------------------------------------------

/**
 * يبني توكن clearance موقّع
 * الشكل: base64url(payload).signature
 */
export function issueClearanceToken(input: IssueClearanceInput): {
  token: string
  payload: ClearancePayload
  maxAgeSec: number
} {
  const ttlMinutes = resolveClearanceTtlMinutes(input.policy)
  const maxAgeSec = ttlMinutes * 60
  const now = Math.floor(Date.now() / 1000)

  const payload: ClearancePayload = {
    v: CLEARANCE_DEFAULTS.version,
    o: input.organizationId,
    ip: input.ip,
    d: input.deviceFingerprint ?? null,
    iat: now,
    exp: now + maxAgeSec,
    n: b64url(randomBytes(16)),
  }

  const body = b64urlJson(payload)
  const token = `${body}.${sign(body)}`
  return { token, payload, maxAgeSec }
}

/**
 * يضبط الكوكي على الرد
 */
export function setClearanceCookie(
  reply: FastifyReply,
  input: IssueClearanceInput,
): ClearancePayload {
  const { token, payload, maxAgeSec } = issueClearanceToken(input)

  reply.setCookie(cookieName(), token, {
    path: '/',
    httpOnly: true,
    secure: config.server?.isProd === true,
    sameSite: 'lax',
    maxAge: maxAgeSec,
  })

  return payload
}

// ------------------------------------------------------
// Verify
// ------------------------------------------------------

export function verifyClearanceToken(
  input: VerifyClearanceInput,
): VerifyClearanceResult {
  const token = (input.token || '').trim()
  if (!token) return { valid: false, reason: 'missing' }

  const parts = token.split('.')
  if (parts.length !== 2) return { valid: false, reason: 'malformed' }

  const [body, sig] = parts as [string, string]
  const expected = sign(body)
  if (!safeEqualStr(sig, expected)) {
    return { valid: false, reason: 'bad_signature' }
  }

  let payload: ClearancePayload
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8')) as ClearancePayload
  } catch {
    return { valid: false, reason: 'malformed' }
  }

  if (
    !payload ||
    payload.v !== CLEARANCE_DEFAULTS.version ||
    typeof payload.exp !== 'number' ||
    typeof payload.o !== 'string'
  ) {
    return { valid: false, reason: 'malformed' }
  }

  const now = Math.floor(Date.now() / 1000)
  if (payload.exp < now) return { valid: false, reason: 'expired', payload }

  if (payload.o !== input.organizationId) {
    return { valid: false, reason: 'org_mismatch', payload }
  }

  const bindIp = input.bindIp === true
  if (bindIp && payload.ip && payload.ip !== input.ip) {
    return { valid: false, reason: 'ip_mismatch', payload }
  }

  const bindDevice = input.bindDevice !== false // افتراضي: اربط الجهاز لو موجود
  if (
    bindDevice &&
    payload.d &&
    input.deviceFingerprint &&
    payload.d !== input.deviceFingerprint
  ) {
    return { valid: false, reason: 'device_mismatch', payload }
  }

  return {
    valid: true,
    payload,
    secondsLeft: payload.exp - now,
  }
}

/**
 * يقرأ الكوكي من الطلب ويتحقق
 */
export function verifyClearanceFromRequest(
  request: FastifyRequest,
  opts: {
    organizationId: string
    ip: string
    deviceFingerprint?: string | null
    bindIp?: boolean
    bindDevice?: boolean
  },
): VerifyClearanceResult {
  const raw =
    request.cookies?.[cookieName()] ||
    (request.headers['x-zp-clearance'] as string | undefined) ||
    ''

  return verifyClearanceToken({
    token: raw,
    organizationId: opts.organizationId,
    ip: opts.ip,
    deviceFingerprint: opts.deviceFingerprint,
    bindIp: opts.bindIp,
    bindDevice: opts.bindDevice,
  })
}

export function clearClearanceCookie(reply: FastifyReply): void {
  reply.clearCookie(cookieName(), { path: '/' })
}

/**
 * إلغاء منطقي: امسح الكوكي (+ لاحقًا blacklist الـ nonce في Redis لو حابب)
 */
export function revokeClearance(reply: FastifyReply): void {
  clearClearanceCookie(reply)
}

// ------------------------------------------------------
export default {
  issueClearanceToken,
  setClearanceCookie,
  verifyClearanceToken,
  verifyClearanceFromRequest,
  clearClearanceCookie,
  revokeClearance,
  resolveClearanceTtlMinutes,
  CLEARANCE_DEFAULTS,
}