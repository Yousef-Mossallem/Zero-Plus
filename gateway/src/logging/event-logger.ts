// ======================================================
// ZERO PLUS GATEWAY — logging/event-logger.ts
// ------------------------------------------------------
// يسجّل كل قرار أمني ويرسله للـ Backend:
//   POST /internal/gateway/events
//   POST /internal/gateway/events/batch
//
// - غير حاجز للطلب (fire-and-forget + طابور خفيف)
// - يبني GatewaySecurityEvent كامل من سياق الـ pipeline
// - يضم risk / route / policy / rate / JS / advanced / edge
// ======================================================

import { randomUUID } from 'node:crypto'
import {
  sendSecurityEvent,
  sendSecurityEventsBatch,
  applyReputation,
  type GatewaySecurityEvent,
  type EventDecision,
  type HttpMethod,
  type DetectionStageValue,
  type ChallengeTypeValue,
  type IpTypeValue,
  type ReputationSignal,
  type SignalSeverity,
} from '../services/backend.client'
import type { RiskResult } from '../core/risk.engine'
import type { PolicyDecision } from '../core/policy.engine'
import type { RouteDecision } from '../detection/suspicion-router'
import type { RateLimitResult } from '../detection/rate-limiter'
import type { JsChallengeResult } from '../challenge/js-challenge'
import type { AdvancedChallengeResult } from '../challenge/advanced-fingerprint-challenge'

// ------------------------------------------------------
// أنواع الإدخال من app
// ------------------------------------------------------

export interface EventLoggerInput {
  organizationId: string
  serverId: string
  ipAddress: string
  path: string
  method: string
  requestId?: string
  userAgent?: string | null
  referer?: string | null

  riskScore: number
  decision: EventDecision | string
  processingTimeMs?: number

  /** من risk.engine */
  riskResult?: RiskResult | null
  /** من suspicion-router */
  routeDecision?: RouteDecision | null
  /** من policy.engine */
  policyDecision?: PolicyDecision | null
  /** من rate-limiter */
  rateLimit?: RateLimitResult | null

  ja3?: string | null
  ja4?: string | null
  deviceFingerprint?: string | null

  anomalyScore?: number | null
  confidence?: number | null
  surgeDetected?: boolean
  pathSensitive?: boolean
  recommendation?: string | null

  countryCode?: string | null
  asn?: number | null
  ipType?: IpTypeValue | string | null

  isChallenged?: boolean
  challengeType?: ChallengeTypeValue | string | null
  challengePassed?: boolean | null

  jsChallenge?: JsChallengeResult | null
  advancedChallenge?: AdvancedChallengeResult | null

  reputationEntryId?: string | null
  /** ملخص جاهز؛ وإلا يُبنى تلقائيًا */
  reasonSummary?: string | null
  reasonDetails?: Record<string, unknown> | null

  decidedAtStage?: DetectionStageValue | string | null

  /**
   * true (افتراضي): أرسل أيضًا أدلة سمعة عند BLOCK / فشل تحدي
   */
  mirrorReputation?: boolean
}

export interface EventLoggerResult {
  queued: boolean
  sent?: boolean
  eventId?: string
  error?: string
}

// ------------------------------------------------------
// طابور دفعات (خفيف في الذاكرة)
// ------------------------------------------------------

const BATCH_MAX = 40
const BATCH_FLUSH_MS = 400
const queue: GatewaySecurityEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushQueue()
  }, BATCH_FLUSH_MS)
}

async function flushQueue(): Promise<void> {
  if (flushing || queue.length === 0) return
  flushing = true
  try {
    while (queue.length > 0) {
      const chunk = queue.splice(0, BATCH_MAX)
      try {
        await sendSecurityEventsBatch(chunk)
      } catch (err) {
        // محاولة واحد-واحد كاحتياطي
        for (const ev of chunk) {
          try {
            await sendSecurityEvent(ev)
          } catch (e) {
            console.error(
              '[event-logger] send failed',
              (e as Error).message,
              ev.requestId,
            )
          }
        }
      }
    }
  } finally {
    flushing = false
  }
}

/** عند الإغلاق — فرّغ الطابور */
export async function flushEventLogger(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await flushQueue()
}

// ------------------------------------------------------
// تحويلات
// ------------------------------------------------------

const METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
])

function mapMethod(m: string): HttpMethod {
  const u = (m || 'GET').toUpperCase()
  return (METHODS.has(u) ? u : 'GET') as HttpMethod
}

function mapDecision(d: string): EventDecision {
  const u = (d || 'ALLOW').toUpperCase()
  if (u === 'ALLOW') return 'ALLOW'
  if (u === 'MONITOR') return 'MONITOR'
  if (u === 'RATE_LIMIT' || u === 'RATE_LIMITED') return 'RATE_LIMIT'
  if (u === 'CHALLENGE') return 'CHALLENGE'
  if (
    u === 'BLOCK' ||
    u === 'BAN' ||
    u === 'TEMPORARY_BAN' ||
    u === 'PERMANENT_BAN'
  ) {
    return 'BLOCK'
  }
  return 'MONITOR'
}

function mapStage(
  input: EventLoggerInput,
): DetectionStageValue | undefined {
  if (input.decidedAtStage) {
    return input.decidedAtStage as DetectionStageValue
  }
  const route = input.routeDecision?.route
  if (route === 'ban') return 'BAN_LIST'
  if (route === 'silent_js_challenge') return 'JS_CHALLENGE'
  if (route === 'rate_limit_with_challenge') return 'HARD_LIMIT'
  if (route === 'advanced_fingerprint_check') return 'TLS_FINGERPRINT'
  if (input.policyDecision?.action?.includes('ban')) return 'POLICY'
  if (input.rateLimit?.hardExceeded) return 'HARD_LIMIT'
  if (input.jsChallenge) return 'JS_CHALLENGE'
  if (input.advancedChallenge) return 'TLS_FINGERPRINT'
  if (input.anomalyScore != null && input.anomalyScore > 0.3) {
    return 'AI_ANOMALY'
  }
  return 'POLICY'
}

function mapChallengeType(
  input: EventLoggerInput,
): ChallengeTypeValue | undefined {
  if (input.challengeType) {
    return input.challengeType as ChallengeTypeValue
  }
  const route = input.routeDecision?.route
  if (route === 'silent_js_challenge' || input.jsChallenge) {
    return 'JS_SILENT'
  }
  if (route === 'advanced_fingerprint_check' || input.advancedChallenge) {
    return 'TLS_FINGERPRINT'
  }
  if (route === 'rate_limit_with_challenge') return 'RATE_LIMIT_SOFT'
  return undefined
}

function buildReasonSummary(input: EventLoggerInput): string {
  if (input.reasonSummary) return input.reasonSummary

  const parts: string[] = []
  parts.push(`risk=${input.riskScore}`)
  if (input.routeDecision?.route) {
    parts.push(`route=${input.routeDecision.route}`)
  }
  if (input.routeDecision?.reason) {
    parts.push(`why=${input.routeDecision.reason}`)
  }
  if (input.policyDecision?.action) {
    parts.push(`policy=${input.policyDecision.action}`)
  }
  if (input.rateLimit?.level && input.rateLimit.level !== 'ok') {
    parts.push(`rl=${input.rateLimit.level}`)
  }
  if (input.jsChallenge) {
    parts.push(
      `js=${input.jsChallenge.phase}/${input.jsChallenge.passed ? 'ok' : 'fail'}`,
    )
  }
  if (input.advancedChallenge) {
    parts.push(
      `adv=${input.advancedChallenge.telemetry.verdict}/s=${input.advancedChallenge.telemetry.localSuspicionScore.toFixed(2)}`,
    )
  }
  if (input.anomalyScore != null) {
    parts.push(`ai=${input.anomalyScore}`)
  }
  if (input.ipType) parts.push(`ipType=${input.ipType}`)
  return parts.join(' | ').slice(0, 500)
}

function buildReasonDetails(
  input: EventLoggerInput,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...(input.reasonDetails || {}),
  }

  if (input.riskResult) {
    base.riskComponents = input.riskResult.components
  }
  if (input.routeDecision) {
    base.route = {
      route: input.routeDecision.route,
      reason: input.routeDecision.reason,
      ban: input.routeDecision.ban ?? null,
    }
  }
  if (input.policyDecision) {
    base.policy = input.policyDecision
  }
  if (input.rateLimit) {
    base.rateLimit = {
      level: input.rateLimit.level,
      softExceeded: input.rateLimit.softExceeded,
      hardExceeded: input.rateLimit.hardExceeded,
      highRequestRate: input.rateLimit.highRequestRate,
      shouldBanOnHard: input.rateLimit.shouldBanOnHard,
      counts: input.rateLimit.counts,
      windows: input.rateLimit.windows,
    }
  }
  if (input.ja3 || input.ja4 || input.deviceFingerprint) {
    base.fingerprints = {
      ja3: input.ja3 ?? null,
      ja4: input.ja4 ?? null,
      device: input.deviceFingerprint ?? null,
    }
  }
  if (input.jsChallenge) {
    base.jsChallenge = {
      phase: input.jsChallenge.phase,
      passed: input.jsChallenge.passed,
      localSuspicionScore: input.jsChallenge.telemetry.localSuspicionScore,
      failReasons: input.jsChallenge.telemetry.failReasons,
      suspicionHints: input.jsChallenge.telemetry.suspicionHints,
      solveDurationMs: input.jsChallenge.telemetry.solveDurationMs,
      token: input.jsChallenge.telemetry.token ?? null,
      // متصفح مختصر للتخزين (مش كامل لو ضخم)
      browserSummary: input.jsChallenge.telemetry.browser
        ? {
            webdriver: input.jsChallenge.telemetry.browser.nav.webdriver,
            platform: input.jsChallenge.telemetry.browser.nav.platform,
            hw: input.jsChallenge.telemetry.browser.nav.hardwareConcurrency,
            webglOk: input.jsChallenge.telemetry.browser.webgl.ok,
            plugins: input.jsChallenge.telemetry.browser.nav.pluginsLength,
          }
        : null,
    }
  }
  if (input.advancedChallenge) {
    const adv = input.advancedChallenge.telemetry
    base.advancedChallenge = {
      phase: input.advancedChallenge.phase,
      passed: input.advancedChallenge.passed,
      verdict: adv.verdict,
      localSuspicionScore: adv.localSuspicionScore,
      failCodes: adv.failCodes,
      hintCodes: adv.hintCodes,
      layers: adv.layers,
      patternHits: adv.patternHits,
      sessionChanged: adv.sessionChanged,
      edge: adv.edge,
      token: adv.token ?? null,
    }
  }

  return base
}

/**
 * يبني جسم الحدث المطابق لـ GatewaySecurityEvent
 */
export function buildSecurityEvent(
  input: EventLoggerInput,
): GatewaySecurityEvent {
  const decision = mapDecision(String(input.decision))
  const challenged =
    input.isChallenged === true ||
    decision === 'CHALLENGE' ||
    !!input.jsChallenge ||
    !!input.advancedChallenge ||
    input.routeDecision?.route === 'silent_js_challenge' ||
    input.routeDecision?.route === 'advanced_fingerprint_check' ||
    input.routeDecision?.route === 'rate_limit_with_challenge'

  let challengePassed = input.challengePassed
  if (challengePassed == null && input.jsChallenge) {
    challengePassed = input.jsChallenge.passed
  }
  if (challengePassed == null && input.advancedChallenge) {
    challengePassed = input.advancedChallenge.passed
  }

  const anomaly =
    input.anomalyScore ??
    input.jsChallenge?.telemetry.localSuspicionScore ??
    input.advancedChallenge?.telemetry.localSuspicionScore ??
    undefined

  const event: GatewaySecurityEvent = {
    organizationId: input.organizationId,
    serverId: input.serverId,
    ipAddress: input.ipAddress,
    path: input.path || '/',
    method: mapMethod(input.method),
    riskScore: Math.min(100, Math.max(0, Math.round(input.riskScore))),
    decision,
    decidedAtStage: mapStage(input),
    userAgent: input.userAgent ?? undefined,
    referer: input.referer ?? undefined,
    requestId: input.requestId || randomUUID(),
    anomalyScore: anomaly,
    confidence: input.confidence ?? undefined,
    reasonSummary: buildReasonSummary(input),
    reasonDetails: buildReasonDetails(input),
    processingTimeMs: input.processingTimeMs,
    surgeDetected: input.surgeDetected,
    pathSensitive: input.pathSensitive,
    recommendation: input.recommendation ?? undefined,
    countryCode: input.countryCode ?? undefined,
    asn: input.asn ?? undefined,
    ipType: (input.ipType as IpTypeValue) ?? undefined,
    isChallenged: challenged,
    challengeType: mapChallengeType(input),
    challengePassed: challengePassed ?? undefined,
    reputationEntryId: input.reputationEntryId ?? undefined,
  }

  return event
}

// ------------------------------------------------------
// سمعة مرآة (اختياري)
// ------------------------------------------------------

async function maybeMirrorReputation(input: EventLoggerInput): Promise<void> {
  if (input.mirrorReputation === false) return
  const decision = mapDecision(String(input.decision))
  const failedChallenge =
    (input.jsChallenge && !input.jsChallenge.passed) ||
    (input.advancedChallenge && !input.advancedChallenge.passed)

  if (decision !== 'BLOCK' && !failedChallenge) return

  const signals: ReputationSignal[] = []

  if (decision === 'BLOCK') {
    signals.push({
      type: 'GATEWAY_BLOCK',
      severity: 'HIGH',
      confidence: 0.9,
      note: input.reasonSummary || 'blocked_by_gateway',
    })
  }
  if (input.jsChallenge && !input.jsChallenge.passed) {
    signals.push({
      type: 'JS_CHALLENGE_FAIL',
      severity: 'MEDIUM',
      confidence: 0.85,
      anomalyScore: input.jsChallenge.telemetry.localSuspicionScore,
      note: input.jsChallenge.telemetry.failReasons.join(','),
    })
  }
  if (input.advancedChallenge && !input.advancedChallenge.passed) {
    signals.push({
      type: 'ADVANCED_FP_FAIL',
      severity: 'HIGH',
      confidence: 0.88,
      anomalyScore: input.advancedChallenge.telemetry.localSuspicionScore,
      note: input.advancedChallenge.telemetry.failCodes.join(','),
    })
  }
  if (input.rateLimit?.hardExceeded) {
    signals.push({
      type: 'HARD_RATE_LIMIT',
      severity: 'HIGH',
      confidence: 0.9,
    })
  }

  if (signals.length === 0) return

  try {
    await applyReputation({
      organizationId: input.organizationId,
      serverId: input.serverId,
      ipAddress: input.ipAddress,
      signals,
      deviceFingerprint: input.deviceFingerprint ?? undefined,
      ja3Fingerprint: input.ja3 ?? undefined,
      ja4Fingerprint: input.ja4 ?? undefined,
      lastPath: input.path,
      lastUserAgent: input.userAgent ?? undefined,
      ipType: input.ipType ? String(input.ipType) : undefined,
      challenge: input.jsChallenge
        ? {
            type: 'JS_SILENT',
            passed: input.jsChallenge.passed,
            durationMs: input.jsChallenge.telemetry.solveDurationMs ?? undefined,
            failureReason: input.jsChallenge.telemetry.failReasons[0],
          }
        : input.advancedChallenge
          ? {
              type: 'TLS_FINGERPRINT',
              passed: input.advancedChallenge.passed,
              failureReason:
                input.advancedChallenge.telemetry.failCodes[0],
            }
          : undefined,
      idempotencyKey: input.requestId
        ? `evt:${input.requestId}`
        : undefined,
    })
  } catch (err) {
    console.error('[event-logger] reputation mirror failed', (err as Error).message)
  }
}

// ------------------------------------------------------
// API العامة
// ------------------------------------------------------

/**
 * سجّل حدثًا — غير حاجز (يُضاف للطابور)
 */
export function logSecurityEvent(input: EventLoggerInput): EventLoggerResult {
  try {
    if (!input.organizationId || !input.serverId || !input.ipAddress) {
      return {
        queued: false,
        error: 'missing organizationId|serverId|ipAddress',
      }
    }
    const event = buildSecurityEvent(input)
    queue.push(event)
    if (queue.length >= BATCH_MAX) {
      void flushQueue()
    } else {
      scheduleFlush()
    }
    // سمعة في الخلفية
    void maybeMirrorReputation(input)

    return { queued: true }
  } catch (err) {
    return { queued: false, error: (err as Error).message }
  }
}

/**
 * إرسال فوري (للاختبار أو قرارات حرجة)
 */
export async function logSecurityEventImmediate(
  input: EventLoggerInput,
): Promise<EventLoggerResult> {
  try {
    const event = buildSecurityEvent(input)
    const created = await sendSecurityEvent(event)
    void maybeMirrorReputation(input)
    return { queued: false, sent: true, eventId: created.id }
  } catch (err) {
    return { queued: false, sent: false, error: (err as Error).message }
  }
}

/**
 * مساعدة من سياق app شائع
 */
export function logFromGatewayContext(params: {
  organizationId: string
  serverId: string
  ip: string
  path: string
  method: string
  requestId: string
  userAgent?: string | null
  referer?: string | null
  riskScore: number
  decision: string
  startTime: number
  riskResult?: RiskResult | null
  routeDecision?: RouteDecision | null
  policyDecision?: PolicyDecision | null
  rateLimit?: RateLimitResult | null
  ja3?: string | null
  ja4?: string | null
  deviceFingerprint?: string | null
  jsChallenge?: JsChallengeResult | null
  advancedChallenge?: AdvancedChallengeResult | null
  anomalyScore?: number | null
  ipType?: string | null
  reputationEntryId?: string | null
}): EventLoggerResult {
  return logSecurityEvent({
    organizationId: params.organizationId,
    serverId: params.serverId,
    ipAddress: params.ip,
    path: params.path,
    method: params.method,
    requestId: params.requestId,
    userAgent: params.userAgent,
    referer: params.referer,
    riskScore: params.riskScore,
    decision: params.decision,
    processingTimeMs: Date.now() - params.startTime,
    riskResult: params.riskResult,
    routeDecision: params.routeDecision,
    policyDecision: params.policyDecision,
    rateLimit: params.rateLimit,
    ja3: params.ja3,
    ja4: params.ja4,
    deviceFingerprint: params.deviceFingerprint,
    jsChallenge: params.jsChallenge,
    advancedChallenge: params.advancedChallenge,
    anomalyScore: params.anomalyScore,
    ipType: params.ipType,
    reputationEntryId: params.reputationEntryId,
  })
}

export default {
  logSecurityEvent,
  logSecurityEventImmediate,
  logFromGatewayContext,
  buildSecurityEvent,
  flushEventLogger,
}