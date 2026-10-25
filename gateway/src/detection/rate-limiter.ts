// ======================================================
// ZERO PLUS GATEWAY — detection/rate-limiter.ts
// ------------------------------------------------------
// Soft limit  = rateLimitRequests / rateLimitWindowSec   (افتراضي 30 / 60)
// Hard limit  = maxRequestsPerIp / maxRequestsWindowSec (افتراضي 300 / 60)
// Ban on hard = banOnMaxRequests من سياسة الشركة
//
// العدادات على Redis — عزل per organizationId + IP (+ جهاز اختياري)
// السياسة تجي من الباك (resolvePolicy) وتتتمرّر هنا — الملف ما يجلبش HTTP بنفسه
// ======================================================

import type Redis from 'ioredis'
import { getRedis } from '../services/redis.client'
import type { OrgPolicyFromBackend } from '../services/backend.client'

// ------------------------------------------------------
// Defaults = نفس Prisma Policy
// ------------------------------------------------------

export const RATE_LIMIT_DEFAULTS = {
  softRequests: 30,
  softWindowSec: 60,
  hardRequests: 300,
  hardWindowSec: 60,
  banOnHardLimit: true,
} as const

// ------------------------------------------------------
// أنواع
// ------------------------------------------------------

/** حدود مستخرجة من سياسة الشركة */
export interface RateLimitPolicy {
  softRequests: number
  softWindowSec: number
  hardRequests: number
  hardWindowSec: number
  /** عند تجاوز الـ hard: هل نعتبره يستحق حظر؟ */
  banOnHardLimit: boolean
}

export type RateLimitLevel = 'ok' | 'soft' | 'hard'

export interface RateLimitInput {
  organizationId: string
  ip: string
  /** لو موجود يتعدّ على مفتاح منفصل كمان (أدق مع CGNAT) */
  deviceFingerprint?: string | null
  /** من mapBackendPolicy أو من OrgPolicyFromBackend */
  policy?: Partial<RateLimitPolicy> | Partial<OrgPolicyFromBackend> | null
}

export interface RateLimitResult {
  level: RateLimitLevel
  /** true لو تجاوز soft (تبطيء / challenge) */
  softExceeded: boolean
  /** true لو تجاوز hard (cap أو ban) */
  hardExceeded: boolean
  /** للـ policy.engine: maxRequestsExceeded */
  maxRequestsExceeded: boolean
  /** هل السياسة تطلب حظر عند hard؟ */
  shouldBanOnHard: boolean
  /** يفعّل highRequestRate في risk.engine */
  highRequestRate: boolean
  counts: {
    soft: number
    hard: number
    softLimit: number
    hardLimit: number
  }
  windows: {
    softSec: number
    hardSec: number
  }
  /** هيدرز قياسية للرد */
  headers: Record<string, string>
}

// ------------------------------------------------------
// مفاتيح Redis
// ------------------------------------------------------

function keySoftIp(orgId: string, ip: string) {
  return `zp:rl:soft:ip:${orgId}:${ip}`
}
function keyHardIp(orgId: string, ip: string) {
  return `zp:rl:hard:ip:${orgId}:${ip}`
}
function keySoftDev(orgId: string, fp: string) {
  return `zp:rl:soft:dev:${orgId}:${fp}`
}
function keyHardDev(orgId: string, fp: string) {
  return `zp:rl:hard:dev:${orgId}:${fp}`
}

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------

function redis(): Redis {
  return getRedis() as Redis
}

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function sanitizeOrgId(orgId: string): string {
  const t = (orgId || '').trim()
  if (!t || !/^[a-zA-Z0-9_\-]+$/.test(t) || t.length > 80) {
    throw new Error('[rate-limiter] invalid organizationId')
  }
  return t
}

function sanitizeIp(ip: string): string {
  const t = (ip || '').trim()
  if (t.length < 3 || t.length > 64 || !/^[0-9a-fA-F:.]+$/.test(t)) {
    throw new Error('[rate-limiter] invalid ip')
  }
  return t
}

function sanitizeFp(fp: string | null | undefined): string | null {
  if (!fp) return null
  const t = fp.trim()
  if (t.length < 8 || t.length > 128) return null
  if (!/^[a-zA-Z0-9_\-:.=]+$/.test(t)) return null
  return t
}

/**
 * يحوّل سياسة الباك أو الشكل المختصر → RateLimitPolicy
 */
export function resolveRateLimitPolicy(
  raw?: Partial<RateLimitPolicy> | Partial<OrgPolicyFromBackend> | null,
): RateLimitPolicy {
  if (!raw || typeof raw !== 'object') {
    return {
      softRequests: RATE_LIMIT_DEFAULTS.softRequests,
      softWindowSec: RATE_LIMIT_DEFAULTS.softWindowSec,
      hardRequests: RATE_LIMIT_DEFAULTS.hardRequests,
      hardWindowSec: RATE_LIMIT_DEFAULTS.hardWindowSec,
      banOnHardLimit: RATE_LIMIT_DEFAULTS.banOnHardLimit,
    }
  }

  const r = raw as Record<string, unknown>

  // دعم أسماء Prisma / الباك
  const softRequests = clampInt(
    r.softRequests ?? r.rateLimitRequests,
    RATE_LIMIT_DEFAULTS.softRequests,
    1,
    1_000_000,
  )
  const softWindowSec = clampInt(
    r.softWindowSec ?? r.rateLimitWindowSec,
    RATE_LIMIT_DEFAULTS.softWindowSec,
    1,
    86400,
  )
  const hardRequests = clampInt(
    r.hardRequests ?? r.maxRequestsPerIp,
    RATE_LIMIT_DEFAULTS.hardRequests,
    1,
    1_000_000,
  )
  const hardWindowSec = clampInt(
    r.hardWindowSec ?? r.maxRequestsWindowSec,
    RATE_LIMIT_DEFAULTS.hardWindowSec,
    1,
    86400,
  )
  const banOnHardLimit =
    typeof r.banOnHardLimit === 'boolean'
      ? r.banOnHardLimit
      : typeof r.banOnMaxRequests === 'boolean'
        ? (r.banOnMaxRequests as boolean)
        : RATE_LIMIT_DEFAULTS.banOnHardLimit

  // hard لازم ≥ soft منطقيًا
  const hard = Math.max(hardRequests, softRequests)

  return {
    softRequests,
    softWindowSec,
    hardRequests: hard,
    hardWindowSec,
    banOnHardLimit,
  }
}

/**
 * INCR + تعين TTL عند أول ضغطة في النافذة
 * يرجع العدد بعد الزيادة
 */
async function incrWithWindow(
  key: string,
  windowSec: number,
): Promise<number> {
  const r = redis()
  const count = await r.incr(key)
  if (count === 1) {
    await r.expire(key, windowSec)
  }
  // لو المفتاح اتخلق من غير TTL بالغلط
  const ttl = await r.ttl(key)
  if (ttl < 0) {
    await r.expire(key, windowSec)
  }
  return count
}

function buildHeaders(
  policy: RateLimitPolicy,
  softCount: number,
  hardCount: number,
  level: RateLimitLevel,
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Soft-Limit': String(policy.softRequests),
    'X-RateLimit-Soft-Remaining': String(
      Math.max(0, policy.softRequests - softCount),
    ),
    'X-RateLimit-Hard-Limit': String(policy.hardRequests),
    'X-RateLimit-Hard-Remaining': String(
      Math.max(0, policy.hardRequests - hardCount),
    ),
  }
  if (level === 'soft' || level === 'hard') {
    headers['Retry-After'] = String(
      level === 'hard' ? policy.hardWindowSec : policy.softWindowSec,
    )
  }
  return headers
}

// ------------------------------------------------------
// الدالة الرئيسية
// ------------------------------------------------------

/**
 * يسجّل طلب واحد ويقيّم soft/hard حسب سياسة الشركة.
 * يعدّ على IP دائمًا، وعلى الجهاز لو البصمة موجودة (يُؤخذ الأعلى).
 */
export async function checkRateLimit(
  input: RateLimitInput,
): Promise<RateLimitResult> {
  const orgId = sanitizeOrgId(input.organizationId)
  const ip = sanitizeIp(input.ip)
  const fp = sanitizeFp(input.deviceFingerprint)
  const policy = resolveRateLimitPolicy(input.policy)

  // عدّادات IP
  const softIp = await incrWithWindow(
    keySoftIp(orgId, ip),
    policy.softWindowSec,
  )
  const hardIp = await incrWithWindow(
    keyHardIp(orgId, ip),
    policy.hardWindowSec,
  )

  let softCount = softIp
  let hardCount = hardIp

  // عدّادات الجهاز (لو موجودة) — نأخذ الأسوأ
  if (fp) {
    const softDev = await incrWithWindow(
      keySoftDev(orgId, fp),
      policy.softWindowSec,
    )
    const hardDev = await incrWithWindow(
      keyHardDev(orgId, fp),
      policy.hardWindowSec,
    )
    softCount = Math.max(softCount, softDev)
    hardCount = Math.max(hardCount, hardDev)
  }

  const hardExceeded = hardCount > policy.hardRequests
  const softExceeded =
    !hardExceeded && softCount > policy.softRequests

  let level: RateLimitLevel = 'ok'
  if (hardExceeded) level = 'hard'
  else if (softExceeded) level = 'soft'

  // soft أو hard → إشارة للمخاطر
  const highRequestRate = softExceeded || hardExceeded

  return {
    level,
    softExceeded,
    hardExceeded,
    maxRequestsExceeded: hardExceeded,
    shouldBanOnHard: hardExceeded && policy.banOnHardLimit,
    highRequestRate,
    counts: {
      soft: softCount,
      hard: hardCount,
      softLimit: policy.softRequests,
      hardLimit: policy.hardRequests,
    },
    windows: {
      softSec: policy.softWindowSec,
      hardSec: policy.hardWindowSec,
    },
    headers: buildHeaders(policy, softCount, hardCount, level),
  }
}

/**
 * يطبّق هيدرز الـ rate limit على Fastify reply
 */
export function applyRateLimitHeaders(
  reply: { header: (k: string, v: string) => unknown },
  result: RateLimitResult,
): void {
  for (const [k, v] of Object.entries(result.headers)) {
    reply.header(k, v)
  }
}

/**
 * تصفير عداد (اختبارات / رفع يدوي)
 */
export async function resetRateLimitCounters(params: {
  organizationId: string
  ip: string
  deviceFingerprint?: string | null
}): Promise<void> {
  const orgId = sanitizeOrgId(params.organizationId)
  const ip = sanitizeIp(params.ip)
  const fp = sanitizeFp(params.deviceFingerprint)
  const r = redis()
  const keys = [keySoftIp(orgId, ip), keyHardIp(orgId, ip)]
  if (fp) keys.push(keySoftDev(orgId, fp), keyHardDev(orgId, fp))
  if (keys.length) await r.del(...keys)
}

// ------------------------------------------------------
export default {
  checkRateLimit,
  resolveRateLimitPolicy,
  applyRateLimitHeaders,
  resetRateLimitCounters,
  RATE_LIMIT_DEFAULTS,
}