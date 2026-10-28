// ======================================================
// ZERO PLUS GATEWAY — challenge/challenge-token.ts
// ------------------------------------------------------
// وظيفة الملف:
//   إصدار والتحقق من "توكن تحدّي لمرة واحدة" (one-time / anti-replay)
//   يستخدمه js-challenge و advanced-fingerprint (أو أي تحدّي لاحق).
//
// ماذا يمنع؟
//   - إعادة إرسال نفس رد التحدي (replay)
//   - استخدام توكن منتهي أو تابع لشركة/مسار آخر
//   - تزوير الحمولة من غير سر السيرفر (HMAC)
//
// ماذا لا يفعل؟
//   - لا يرسم UI / لا يشغّل JS
//   - لا يصدر clearance (ده clearance.ts بعد النجاح)
//   - لا يقرر الحظر النهائي (app / ban.manager)
//
// التخزين: Redis (إلزامي للإنتاج) — حالة الاستهلاك + TTL
// التوقيع: HMAC-SHA256 على جسم التوكن
// ======================================================

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto'
import { getRedis } from '../services/redis.client'
import { config } from '../config'

// ------------------------------------------------------
// إعدادات
// ------------------------------------------------------

const TOKEN_VERSION = 1 as const
const REDIS_PREFIX = 'zp:chtok:'
const REDIS_USED_PREFIX = 'zp:chtok:used:'

/** افتراضي: دقيقتان لحل التحدي */
export const DEFAULT_CHALLENGE_TOKEN_TTL_SEC = 120

/** أنواع التحديات المدعومة */
export type ChallengeKind = 'js' | 'advanced' | 'captcha' | 'generic'

export interface IssueChallengeTokenInput {
  organizationId: string
  kind: ChallengeKind
  /** IP وقت الإصدار */
  ip: string
  /** بصمة جهاز إن وُجدت */
  deviceFingerprint?: string | null
  /** Host / domain */
  host?: string | null
  /** مسار كان عليه الطلب */
  path?: string | null
  /** TTL بالثواني */
  ttlSec?: number
  /**
   * بيانات إضافية تُربط بالتوكين (مثل rounds أو nonce داخلي)
   * تتخزن في Redis وتتحقق عند الاستهلاك
   */
  bind?: Record<string, string | number | boolean | null>
  /** requestId للتتبع */
  requestId?: string | null
}

export interface ChallengeTokenPayload {
  v: typeof TOKEN_VERSION
  /** token id — فريد */
  jti: string
  kind: ChallengeKind
  orgId: string
  ip: string
  d: string | null
  host: string | null
  path: string | null
  /** issued at unix seconds */
  iat: number
  /** expire at unix seconds */
  exp: number
  /** nonce عشوائي */
  n: string
  rid: string | null
}

export interface IssuedChallengeToken {
  /** الشكل النهائي: base64url(payload).signature */
  token: string
  payload: ChallengeTokenPayload
  /** TTL الفعلي بالثواني */
  ttlSec: number
  /** مفتاح Redis للحالة */
  redisKey: string
}

export type ChallengeTokenFailReason =
  | 'missing'
  | 'malformed'
  | 'bad_version'
  | 'bad_signature'
  | 'expired'
  | 'not_found'
  | 'already_used'
  | 'org_mismatch'
  | 'kind_mismatch'
  | 'ip_mismatch'
  | 'device_mismatch'
  | 'host_mismatch'
  | 'bind_mismatch'
  | 'store_error'

export interface VerifyChallengeTokenInput {
  token: string
  organizationId: string
  kind: ChallengeKind
  ip: string
  deviceFingerprint?: string | null
  host?: string | null
  /**
   * true = ارفض لو IP تغيّر (أشد)
   * false = سجّل فقط في النتيجة (أنسب لـ CGNAT/موبايل)
   */
  bindIp?: boolean
  bindDevice?: boolean
  bindHost?: boolean
  /** يجب أن تطابق bind المخزّن */
  expectedBind?: Record<string, string | number | boolean | null>
  /** بعد النجاح يُستهلك (مرة واحدة). false = peek فقط */
  consume?: boolean
}

export interface VerifyChallengeTokenResult {
  valid: boolean
  reason?: ChallengeTokenFailReason
  payload?: ChallengeTokenPayload
  /** ثواني متبقية */
  secondsLeft?: number
  /** هل IP اختلف عن الإصدار */
  ipChanged?: boolean
  /** bind المسترجع من Redis */
  bind?: Record<string, string | number | boolean | null> | null
  /** تلميحات غير قاتلة للـ AI */
  hints: string[]
}

export interface ChallengeTokenTelemetry {
  kind: 'challenge_token'
  jti: string | null
  challengeKind: ChallengeKind | null
  organizationId: string
  valid: boolean
  reason?: ChallengeTokenFailReason
  secondsLeft?: number
  ipChanged: boolean
  hints: string[]
  iat?: number
  exp?: number
}

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------

function secret(): string {
  const s =
    config.clearance?.secret ||
    (config as { challenge?: { secret?: string } }).challenge?.secret ||
    process.env.CHALLENGE_TOKEN_SECRET ||
    process.env.CLEARANCE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      '[challenge-token] secret missing or too short (use CLEARANCE_SECRET or CHALLENGE_TOKEN_SECRET)',
    )
  }
  return s
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

function signBody(bodyB64: string): string {
  const mac = createHmac('sha256', secret()).update(bodyB64).digest()
  return b64url(mac)
}

function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

function newJti(): string {
  return randomBytes(18).toString('hex')
}

function newNonce(): string {
  return randomBytes(12).toString('hex')
}

function clampTtl(sec: number | undefined): number {
  if (sec == null || !Number.isFinite(sec)) return DEFAULT_CHALLENGE_TOKEN_TTL_SEC
  return Math.min(900, Math.max(30, Math.floor(sec)))
}

function redisKeyFor(jti: string): string {
  return REDIS_PREFIX + jti
}

function usedKeyFor(jti: string): string {
  return REDIS_USED_PREFIX + jti
}

interface RedisTokenRecord {
  payload: ChallengeTokenPayload
  bind: Record<string, string | number | boolean | null>
  used: boolean
}

// ------------------------------------------------------
// Issue
// ------------------------------------------------------

/**
 * يصدر توكن موقّع + يخزّن الحالة في Redis
 */
export async function issueChallengeToken(
  input: IssueChallengeTokenInput,
): Promise<IssuedChallengeToken> {
  const ttlSec = clampTtl(input.ttlSec)
  const now = Math.floor(Date.now() / 1000)
  const jti = newJti()

  const payload: ChallengeTokenPayload = {
    v: TOKEN_VERSION,
    jti,
    kind: input.kind,
    orgId: input.organizationId,
    ip: input.ip,
    d: input.deviceFingerprint ?? null,
    host: input.host ?? null,
    path: input.path ?? null,
    iat: now,
    exp: now + ttlSec,
    n: newNonce(),
    rid: input.requestId ?? null,
  }

  const body = b64urlJson(payload)
  const token = `${body}.${signBody(body)}`

  const record: RedisTokenRecord = {
    payload,
    bind: input.bind ?? {},
    used: false,
  }

  const key = redisKeyFor(jti)
  await getRedis().set(key, JSON.stringify(record), 'EX', ttlSec)

  return { token, payload, ttlSec, redisKey: key }
}

/**
 * توكن مختصر للعرض في هيدر فقط (نفس issue)
 */
export async function issueChallengeTokenHeader(
  input: IssueChallengeTokenInput,
): Promise<{ token: string; headerName: string; ttlSec: number; jti: string }> {
  const issued = await issueChallengeToken(input)
  return {
    token: issued.token,
    headerName: 'x-zp-challenge-token',
    ttlSec: issued.ttlSec,
    jti: issued.payload.jti,
  }
}

// ------------------------------------------------------
// Verify + Consume
// ------------------------------------------------------

function parseTokenShape(token: string): {
  ok: true
  body: string
  sig: string
  payload: ChallengeTokenPayload
} | {
  ok: false
  reason: ChallengeTokenFailReason
} {
  const raw = (token || '').trim()
  if (!raw) return { ok: false, reason: 'missing' }

  const parts = raw.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed' }
  const [body, sig] = parts as [string, string]

  const expected = signBody(body)
  if (!safeEqualStr(sig, expected)) return { ok: false, reason: 'bad_signature' }

  let payload: ChallengeTokenPayload
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8')) as ChallengeTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (!payload || payload.v !== TOKEN_VERSION || !payload.jti) {
    return { ok: false, reason: 'bad_version' }
  }

  return { ok: true, body, sig, payload }
}

function bindMatches(
  stored: Record<string, string | number | boolean | null>,
  expected?: Record<string, string | number | boolean | null>,
): boolean {
  if (!expected || Object.keys(expected).length === 0) return true
  for (const [k, v] of Object.entries(expected)) {
    if (String(stored[k]) !== String(v)) return false
  }
  return true
}

/**
 * يتحقق من التوكن. افتراضيًا يستهلكه (مرة واحدة).
 */
export async function verifyChallengeToken(
  input: VerifyChallengeTokenInput,
): Promise<VerifyChallengeTokenResult> {
  const hints: string[] = []
  const consume = input.consume !== false

  const parsed = parseTokenShape(input.token)
  if (!parsed.ok) {
    return { valid: false, reason: parsed.reason, hints }
  }

  const { payload } = parsed
  const now = Math.floor(Date.now() / 1000)

  if (payload.exp < now) {
    return {
      valid: false,
      reason: 'expired',
      payload,
      secondsLeft: 0,
      hints,
    }
  }

  if (payload.orgId !== input.organizationId) {
    return { valid: false, reason: 'org_mismatch', payload, hints }
  }

  if (payload.kind !== input.kind) {
    return { valid: false, reason: 'kind_mismatch', payload, hints }
  }

  const ipChanged = payload.ip !== input.ip
  if (ipChanged) hints.push('ip_changed')

  if (input.bindIp === true && ipChanged) {
    return {
      valid: false,
      reason: 'ip_mismatch',
      payload,
      ipChanged: true,
      hints,
    }
  }

  if (input.bindDevice !== false && payload.d) {
    const dev = input.deviceFingerprint ?? null
    if (dev && payload.d !== dev) {
      return {
        valid: false,
        reason: 'device_mismatch',
        payload,
        ipChanged,
        hints,
      }
    }
    if (!dev) hints.push('device_fp_missing_on_verify')
  }

  if (input.bindHost === true && payload.host && input.host) {
    if (payload.host !== input.host) {
      return {
        valid: false,
        reason: 'host_mismatch',
        payload,
        ipChanged,
        hints,
      }
    }
  }

  // ----- Redis state -----
  const r = getRedis()
  const key = redisKeyFor(payload.jti)
  const usedKey = usedKeyFor(payload.jti)

  try {
    // استُهلك من قبل؟
    const already = await r.get(usedKey)
    if (already) {
      return {
        valid: false,
        reason: 'already_used',
        payload,
        ipChanged,
        hints: [...hints, 'replay_detected'],
      }
    }

    const raw = await r.get(key)
    if (!raw) {
      // التوقيع صالح لكن مفيش سجل — انتهاء أو مسح
      return {
        valid: false,
        reason: 'not_found',
        payload,
        ipChanged,
        hints,
      }
    }

    let record: RedisTokenRecord
    try {
      record = JSON.parse(raw) as RedisTokenRecord
    } catch {
      return { valid: false, reason: 'store_error', payload, hints }
    }

    if (record.used) {
      return {
        valid: false,
        reason: 'already_used',
        payload,
        ipChanged,
        hints: [...hints, 'replay_detected'],
      }
    }

    if (!bindMatches(record.bind || {}, input.expectedBind)) {
      return {
        valid: false,
        reason: 'bind_mismatch',
        payload,
        bind: record.bind,
        ipChanged,
        hints,
      }
    }

    if (consume) {
      const pipe = r.pipeline()
      pipe.del(key)
      // احتفظ بعلامة used لنفس مدة المتبقي على الأقل
      const left = Math.max(1, payload.exp - now)
      pipe.set(usedKey, '1', 'EX', left + 60)
      await pipe.exec()
    }

    return {
      valid: true,
      payload,
      secondsLeft: payload.exp - now,
      ipChanged,
      bind: record.bind ?? {},
      hints,
    }
  } catch {
    return {
      valid: false,
      reason: 'store_error',
      payload,
      ipChanged,
      hints,
    }
  }
}

/**
 * قراءة بدون استهلاك
 */
export async function peekChallengeToken(
  input: Omit<VerifyChallengeTokenInput, 'consume'>,
): Promise<VerifyChallengeTokenResult> {
  return verifyChallengeToken({ ...input, consume: false })
}

/**
 * إبطال يدوي
 */
export async function revokeChallengeToken(jti: string): Promise<boolean> {
  const r = getRedis()
  const n = await r.del(redisKeyFor(jti))
  await r.set(usedKeyFor(jti), '1', 'EX', DEFAULT_CHALLENGE_TOKEN_TTL_SEC)
  return n > 0
}

// ------------------------------------------------------
// تكامل سريع مع headers / body
// ------------------------------------------------------

export function extractTokenFromRequest(request: {
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}): string | null {
  const h =
    request.headers['x-zp-challenge-token'] ||
    request.headers['x-challenge-token']
  if (typeof h === 'string' && h.trim()) return h.trim()
  if (Array.isArray(h) && h[0]) return h[0].trim()

  const body = request.body
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    const o = body as Record<string, unknown>
    if (typeof o.challengeToken === 'string') return o.challengeToken
    if (typeof o.token === 'string') return o.token
  }
  return null
}

export function telemetryFromVerify(
  organizationId: string,
  kind: ChallengeKind,
  result: VerifyChallengeTokenResult,
): ChallengeTokenTelemetry {
  return {
    kind: 'challenge_token',
    jti: result.payload?.jti ?? null,
    challengeKind: kind,
    organizationId,
    valid: result.valid,
    reason: result.reason,
    secondsLeft: result.secondsLeft,
    ipChanged: result.ipChanged === true,
    hints: result.hints,
    iat: result.payload?.iat,
    exp: result.payload?.exp,
  }
}

/** بصمة ثابتة للـ bind من كائن */
export function hashBind(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj, Object.keys(obj).sort())
  return createHash('sha256').update(json).digest('hex').slice(0, 32)
}

// ------------------------------------------------------
// تصدير
// ------------------------------------------------------

export {
  TOKEN_VERSION,
  REDIS_PREFIX,
  REDIS_USED_PREFIX,
  parseTokenShape,
  signBody,
  redisKeyFor,
}

export default {
  issueChallengeToken,
  issueChallengeTokenHeader,
  verifyChallengeToken,
  peekChallengeToken,
  revokeChallengeToken,
  extractTokenFromRequest,
  telemetryFromVerify,
  hashBind,
  DEFAULT_CHALLENGE_TOKEN_TTL_SEC,
  TOKEN_VERSION,
}