// ======================================================
// ZERO PLUS GATEWAY — logging/event-logger.ts
// ------------------------------------------------------
// يسجّل كل قرار أمني ويرسله للـ Backend:
//   POST /internal/gateway/events
//   POST /internal/gateway/events/batch
//
// - غير حاجز للطلب (fire-and-forget + طابور + سقف أمان)
// - risk / route / policy / rate / JS / advanced / edge / geo
// - AI (جديد): anomaly / recommendation / confidence / drift / surge /
//   path sensitivity / future / comparison / merge / clearance revoke
// - مرآة سمعة عند BLOCK أو فشل تحدي حقيقي
// - Simulation Lab: simulationRunId + persona + sim metadata
//   (التوكن يتحقق في app/sim-auth — هنا تمرير فقط)
//
// JS: phase expired/failed/error = فشل حقيقي → challengePassed=false
//
// خريطة الحقول → Prisma SecurityEvent:
//   anomalyScore   ← ai.anomalyScore (0..1)
//   confidence     ← ai.confidence (0..1)
//   surgeDetected  ← ai.surgeDetected
//   pathSensitive  ← ai.pathSensitivity ∈ {high, critical}
//   recommendation ← ai.recommendation
//   decidedAtStage ← AI_ANOMALY / SURGE_DETECTED / CLEARANCE_REVOKED عند اللزوم
//   reasonDetails.ai / .aiMerge / .anomalySource ← باقي تفاصيل الـ AI
//   (مفيش أعمدة جديدة في Prisma — كله في الأعمدة الموجودة + reasonDetails)
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
} from '../services/backend.client'
import type {
  AiAnalyzeResult,
  FutureAction,
  mergeAiWithGatewayPlan,
} from '../services/ai.client'
import type { RiskResult } from '../core/risk.engine'
import type { PolicyDecision } from '../core/policy.engine'
import type { RouteDecision } from '../detection/suspicion-router'
import type { RateLimitResult } from '../detection/rate-limiter'
import type { JsChallengeResult } from '../challenge/js-challenge'
import { isJsChallengeHardFailure } from '../challenge/js-challenge'
import type { AdvancedChallengeResult } from '../challenge/advanced-fingerprint-challenge'
import type { IpReputationResult } from '../detection/ip-reputation'
import type { SimulationContext } from '../detection/sim-auth'

// ------------------------------------------------------
// أنواع الإدخال
// ------------------------------------------------------

/** نتيجة mergeAiWithGatewayPlan (finalPath / source / note / mustRevokeClearance) */
export type AiMergeInfo = ReturnType<typeof mergeAiWithGatewayPlan>

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

  riskResult?: RiskResult | null
  routeDecision?: RouteDecision | null
  policyDecision?: PolicyDecision | null
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
  asOrg?: string | null
  region?: string | null
  city?: string | null
  latitude?: number | null
  longitude?: number | null
  timezone?: string | null
  countryName?: string | null

  ipType?: IpTypeValue | string | null
  ipReputation?: IpReputationResult | null

  isChallenged?: boolean
  challengeType?: ChallengeTypeValue | string | null
  challengePassed?: boolean | null

  jsChallenge?: JsChallengeResult | null
  advancedChallenge?: AdvancedChallengeResult | null

  reputationEntryId?: string | null
  reasonSummary?: string | null
  reasonDetails?: Record<string, unknown> | null
  decidedAtStage?: DetectionStageValue | string | null

  /**
   * undefined/true: مرآة سمعة عند BLOCK أو فشل تحدي
   * false: لا applyReputation
   */
  mirrorReputation?: boolean

  // ----- AI (جديد) -----
  /** نتيجة analyzePreDecision (Phase 1) — مصدر anomaly/confidence/recommendation */
  ai?: AiAnalyzeResult | null
  /** نتيجة analyzePostDecision (Phase 2) — للمقارنة (comparison) فقط لو وُجدت */
  aiPost?: AiAnalyzeResult | null
  /** ناتج mergeAiWithGatewayPlan — يحدد هل الـ AI هو اللي غيّر المسار */
  aiMerge?: AiMergeInfo | null
  /** future_action مخزّن من طلب سابق وتم تنفيذه في هذا الطلب */
  futureActionApplied?: FutureAction | null
  /** تم سحب الـ clearance في هذا الطلب (revoke_clearance) */
  clearanceRevoked?: boolean

  // ----- Simulation Lab -----
  /** من سياق المحاكاة بعد توكن صالح */
  simulation?: SimulationContext | null
  /** أو تمرير مباشر */
  simulationRunId?: string | null
  simulationPersona?: string | null
  /** true لو الطلب جاء من Worker محاكاة موثوق */
  isSimulation?: boolean
}

export interface EventLoggerResult {
  queued: boolean
  sent?: boolean
  eventId?: string
  error?: string
}

// ------------------------------------------------------
// طابور دفعات
// ------------------------------------------------------

const BATCH_MAX = 40
const BATCH_FLUSH_MS = 400
const QUEUE_HARD_CAP = 5000
const FALLBACK_CONCURRENCY = 5

const queue: GatewaySecurityEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushQueue()
  }, BATCH_FLUSH_MS)
  if (typeof flushTimer === 'object' && flushTimer && 'unref' in flushTimer) {
    ;(flushTimer as { unref: () => void }).unref()
  }
}

async function sendOneByOne(chunk: GatewaySecurityEvent[]): Promise<void> {
  for (let i = 0; i < chunk.length; i += FALLBACK_CONCURRENCY) {
    const slice = chunk.slice(i, i + FALLBACK_CONCURRENCY)
    await Promise.all(
      slice.map(async (ev) => {
        try {
          await sendSecurityEvent(ev)
        } catch (e) {
          console.error(
            '[event-logger] send failed',
            (e as Error).message,
            ev.requestId,
          )
        }
      }),
    )
  }
}

async function flushQueue(): Promise<void> {
  if (flushing || queue.length === 0) return
  flushing = true
  try {
    while (queue.length > 0) {
      const chunk = queue.splice(0, BATCH_MAX)
      try {
        const res = await sendSecurityEventsBatch(chunk)
        if (res?.summary?.failed) {
          for (const r of res.results) {
            if (!r.ok) {
              const ev = chunk[r.index]
              console.error('[event-logger] batch item rejected', {
                index: r.index,
                code: r.code,
                message: r.message,
                requestId: ev?.requestId,
                decision: ev?.decision,
              })
            }
          }
        }
      } catch {
        await sendOneByOne(chunk)
      }
    }
  } finally {
    flushing = false
    if (queue.length > 0) scheduleFlush()
  }
}

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

const IP_TYPES = new Set<string>([
  'RESIDENTIAL',
  'MOBILE',
  'DATACENTER',
  'VPN_PROXY',
  'TOR',
  'UNKNOWN',
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

function mapIpType(value: string | null | undefined): IpTypeValue | undefined {
  if (!value) return undefined
  const u = String(value).toUpperCase()
  return IP_TYPES.has(u) ? (u as IpTypeValue) : 'UNKNOWN'
}

function resolveSimulationMeta(input: EventLoggerInput): {
  active: boolean
  runId?: string
  persona?: string | null
  js?: string | null
  aiScore?: number | null
  countryHint?: string | null
} {
  const sim = input.simulation
  const runId =
    input.simulationRunId ||
    (sim?.active ? sim.runId : undefined) ||
    undefined
  const active =
    input.isSimulation === true ||
    !!runId ||
    (sim?.active === true)
  return {
    active,
    runId,
    persona: input.simulationPersona ?? sim?.persona ?? null,
    js: sim?.js ?? null,
    aiScore: sim?.aiScore ?? null,
    countryHint: sim?.countryHint ?? null,
  }
}

// ------------------------------------------------------
// AI helpers (جديد)
// ------------------------------------------------------

/**
 * أي نتيجة AI نعتمد عليها:
 *  - Phase 1 لو نجحت (دي اللي اتبنى عليها القرار)
 *  - وإلا Phase 2 لو نجحت
 *  - وإلا أي واحدة موجودة (عشان نسجل سبب الفشل)
 */
function resolveAi(input: EventLoggerInput): AiAnalyzeResult | null {
  const pre = input.ai ?? null
  const post = input.aiPost ?? null
  if (pre?.ok) return pre
  if (post?.ok) return post
  return pre ?? post
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** الـ AI هو اللي غيّر المسار (future مخزّن أو دمج رفع التحدي/rate-limit/monitor) */
function aiDroveDecision(input: EventLoggerInput): boolean {
  const m = input.aiMerge
  if (!m) return false
  if (m.source === 'future') return true
  return m.source === 'merged' && String(m.note || '').startsWith('ai_')
}

/** سحب clearance (من AI أو من app) — لا يُحسب لو المسار ban */
function isClearanceRevoked(input: EventLoggerInput): boolean {
  const flagged =
    input.clearanceRevoked === true ||
    input.aiMerge?.mustRevokeClearance === true
  if (!flagged) return false
  if (input.aiMerge?.finalPath === 'ban') return false
  if (input.routeDecision?.route === 'ban') return false
  return true
}

/**
 * anomalyScore النهائي + مصدره.
 * الأولوية: القيمة الممرّرة صراحة → AI الحقيقي → قيمة المحاكاة → تلميحات التحديات → سمعة الشبكة.
 * المصدر بيتسجل في reasonDetails.anomalySource عشان نفرّق AI الحقيقي عن الـ fallback.
 */
function resolveAnomaly(
  input: EventLoggerInput,
  sim: ReturnType<typeof resolveSimulationMeta>,
): { value?: number; source?: string } {
  const ai = resolveAi(input)
  const candidates: Array<[string, number | null | undefined]> = [
    ['input', input.anomalyScore],
    ['ai', ai?.ok ? clamp01(ai.anomalyScore) : undefined],
    ['simulation', sim.aiScore],
    ['js_challenge', input.jsChallenge?.telemetry.localSuspicionScore],
    ['advanced_challenge', input.advancedChallenge?.telemetry.localSuspicionScore],
    ['ip_reputation', input.ipReputation?.networkRiskScore],
  ]
  for (const [source, v] of candidates) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      return { value: v, source }
    }
  }
  return {}
}

function resolveAiPathSensitive(ai: AiAnalyzeResult | null): boolean | undefined {
  if (!ai?.ok) return undefined
  const level = String(ai.pathSensitivity || '').toLowerCase()
  return level === 'high' || level === 'critical'
}

/** تفاصيل الـ AI للـ reasonDetails — بدون raw كامل وبحدود حجم */
function buildAiDetails(
  input: EventLoggerInput,
): Record<string, unknown> | null {
  const ai = resolveAi(input)
  if (!ai) return null

  const post = input.aiPost ?? null

  const reasons = (ai.reasons ?? []).slice(0, 10).map((r) => ({
    code: r.code,
    message: cut(r.message, 200) ?? null,
    weight: r.weight ?? null,
  }))

  const future = ai.future
    ? {
        action: ai.future.action ?? null,
        reason: cut(ai.future.reason, 200) ?? null,
        ttlSec: ai.future.ttl_sec ?? null,
        confidence: ai.future.confidence ?? null,
      }
    : null

  const learning = ai.raw?.learning
    ? {
        learned: ai.raw.learning.learned ?? null,
        modelVersion: ai.raw.learning.model_version ?? null,
        orgModelExists: ai.raw.learning.org_model_exists ?? null,
        cacheHit: ai.raw.learning.cache_hit ?? null,
        processingMs: ai.raw.learning.processing_ms ?? null,
      }
    : null

  return {
    ok: ai.ok,
    failed: ai.failed,
    failReason: ai.failReason ?? null,
    anomalyScore: ai.ok ? clamp01(ai.anomalyScore) : null,
    components: ai.raw?.anomaly?.components ?? null,
    recommendation: ai.recommendation,
    confidence: ai.ok ? ai.confidence : null,
    confidenceLevel: ai.raw?.confidence_level ?? null,
    sessionDriftScore: ai.ok ? ai.sessionDriftScore : null,
    surgeDetected: ai.surgeDetected,
    surge: ai.raw?.surge
      ? {
          score: ai.raw.surge.score ?? null,
          scope: ai.raw.surge.scope ?? null,
          hint: cut(ai.raw.surge.hint, 200) ?? null,
        }
      : null,
    pathSensitivity: ai.pathSensitivity,
    modelVersion: ai.modelVersion,
    processingMs: ai.processingMs,
    reasons,
    future,
    // مقارنة Phase 2 (لو متاحة) أفضل من اللي جاي مع Phase 1
    comparison: post?.comparison ?? ai.comparison ?? null,
    learning,
    phases: {
      pre: input.ai
        ? {
            ok: input.ai.ok,
            failReason: input.ai.failReason ?? null,
            processingMs: input.ai.processingMs,
          }
        : null,
      post: post
        ? {
            ok: post.ok,
            failReason: post.failReason ?? null,
            processingMs: post.processingMs,
            anomalyScore: post.ok ? clamp01(post.anomalyScore) : null,
            recommendation: post.recommendation,
          }
        : null,
    },
  }
}

function isRealJsFailure(js: JsChallengeResult | null | undefined): boolean {
  if (!js) return false
  if (js.passed) return false
  if (js.phase === 'issue' || js.phase === 'disabled' || js.phase === 'passed') {
    return false
  }
  return isJsChallengeHardFailure(js)
}

function isJsExpired(js: JsChallengeResult | null | undefined): boolean {
  if (!js) return false
  return js.phase === 'expired' || js.telemetry?.expired === true
}

function isRealAdvancedFailure(
  adv: AdvancedChallengeResult | null | undefined,
): boolean {
  if (!adv) return false
  if (adv.passed) return false
  if (adv.responseSent) return false
  return true
}

function resolveGeoNetwork(input: EventLoggerInput): {
  countryCode?: string
  asn?: number
  asOrg?: string
  region?: string
  city?: string
  latitude?: number
  longitude?: number
  timezone?: string
  countryName?: string
  ipType?: IpTypeValue
  networkRiskScore?: number
  badIp?: boolean
  confidence?: number
  reasons?: string[]
  sources?: string[]
} {
  const sim = resolveSimulationMeta(input)
  const rep = input.ipReputation
  const countryCode =
    input.countryCode ??
    rep?.geo.countryCode ??
    sim.countryHint ??
    undefined
  const asn = input.asn ?? rep?.asn.asn ?? undefined
  const asOrg = input.asOrg ?? rep?.asn.asOrg ?? rep?.asn.network ?? undefined
  const region = input.region ?? rep?.geo.region ?? undefined
  const city = input.city ?? rep?.geo.city ?? undefined
  const latitude = input.latitude ?? rep?.geo.latitude ?? undefined
  const longitude = input.longitude ?? rep?.geo.longitude ?? undefined
  const timezone = input.timezone ?? rep?.geo.timezone ?? undefined
  const countryName = input.countryName ?? rep?.geo.countryName ?? undefined
  const ipType = mapIpType(input.ipType ?? rep?.kind ?? undefined)

  return {
    countryCode: countryCode
      ? String(countryCode).toUpperCase().slice(0, 8)
      : undefined,
    asn: typeof asn === 'number' && Number.isFinite(asn) ? asn : undefined,
    asOrg: asOrg ? String(asOrg).slice(0, 200) : undefined,
    region: region ? String(region).slice(0, 120) : undefined,
    city: city ? String(city).slice(0, 120) : undefined,
    latitude:
      typeof latitude === 'number' && Number.isFinite(latitude)
        ? latitude
        : undefined,
    longitude:
      typeof longitude === 'number' && Number.isFinite(longitude)
        ? longitude
        : undefined,
    timezone: timezone ? String(timezone).slice(0, 64) : undefined,
    countryName: countryName ? String(countryName).slice(0, 120) : undefined,
    ipType,
    networkRiskScore: rep?.networkRiskScore,
    badIp: rep?.badIp,
    confidence: rep?.confidence,
    reasons: rep?.reasons,
    sources: rep?.sources,
  }
}

function mapStage(input: EventLoggerInput): DetectionStageValue | undefined {
  if (input.decidedAtStage) {
    return input.decidedAtStage as DetectionStageValue
  }

  const ai = resolveAi(input)

  // AI طلب سحب التصريح (ولسه المسار مش ban)
  if (isClearanceRevoked(input)) return 'CLEARANCE_REVOKED'

  // فشل تحدي حقيقي
  if (isRealJsFailure(input.jsChallenge)) return 'JS_CHALLENGE'
  if (isRealAdvancedFailure(input.advancedChallenge)) return 'TLS_FINGERPRINT'

  // الـ AI هو اللي رفع المسار (future مخزّن أو تحدي/rate-limit/monitor من AI)
  if (aiDroveDecision(input)) return 'AI_ANOMALY'

  if (input.jsChallenge?.phase === 'issue') return 'JS_CHALLENGE'
  if (input.advancedChallenge?.responseSent) return 'TLS_FINGERPRINT'

  const route = input.routeDecision?.route
  if (route === 'ban') return 'BAN_LIST'
  if (route === 'silent_js_challenge') return 'JS_CHALLENGE'
  if (route === 'rate_limit_with_challenge') return 'HARD_LIMIT'
  if (route === 'advanced_fingerprint_check') return 'TLS_FINGERPRINT'
  if (input.policyDecision?.action?.includes('ban')) return 'POLICY'
  if (input.rateLimit?.hardExceeded) return 'HARD_LIMIT'

  // surge من الـ AI ومعاه إجراء (مش ALLOW)
  const decision = mapDecision(String(input.decision))
  if (ai?.ok && ai.surgeDetected && decision !== 'ALLOW') {
    return 'SURGE_DETECTED'
  }

  const aiScore =
    input.anomalyScore ?? (ai?.ok ? ai.anomalyScore : null) ?? null
  if (aiScore != null && aiScore > 0.3) {
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
  if (input.jsChallenge) return 'JS_SILENT'
  if (input.advancedChallenge) return 'TLS_FINGERPRINT'

  // المسار النهائي بعد دمج الـ AI
  const finalPath = input.aiMerge?.finalPath
  if (finalPath === 'silent_js_challenge') return 'JS_SILENT'
  if (finalPath === 'advanced_fingerprint_check') return 'TLS_FINGERPRINT'

  const route = input.routeDecision?.route
  if (route === 'silent_js_challenge') return 'JS_SILENT'
  if (route === 'advanced_fingerprint_check') return 'TLS_FINGERPRINT'
  if (route === 'rate_limit_with_challenge') return 'RATE_LIMIT_SOFT'
  return undefined
}

function resolveChallengePassed(input: EventLoggerInput): boolean | undefined {
  if (input.challengePassed != null) return input.challengePassed

  const js = input.jsChallenge
  if (js) {
    if (js.phase === 'issue') return undefined
    if (js.phase === 'disabled') return undefined
    if (isJsExpired(js)) return false
    return js.passed
  }

  const adv = input.advancedChallenge
  if (adv) {
    if (adv.responseSent) return undefined
    return adv.passed
  }
  return undefined
}

function buildReasonSummary(
  input: EventLoggerInput,
  geo: ReturnType<typeof resolveGeoNetwork>,
): string {
  if (input.reasonSummary) return input.reasonSummary

  const sim = resolveSimulationMeta(input)
  const ai = resolveAi(input)
  const parts: string[] = []
  parts.push(`risk=${input.riskScore}`)
  if (sim.active) {
    parts.push('sim=1')
    if (sim.runId) parts.push(`run=${sim.runId.slice(0, 8)}`)
    if (sim.persona) parts.push(`persona=${sim.persona}`)
  }
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
    const js = input.jsChallenge
    const state = js.phase === 'issue' ? 'pending' : js.passed ? 'ok' : 'fail'
    parts.push(`js=${js.phase}/${state}`)
    if (isJsExpired(js)) parts.push('exp=1')
  }
  if (input.advancedChallenge) {
    parts.push(
      `adv=${input.advancedChallenge.telemetry.verdict}/s=${input.advancedChallenge.telemetry.localSuspicionScore.toFixed(2)}`,
    )
  }

  // ----- AI -----
  if (ai) {
    if (ai.ok) {
      parts.push(`ai=${ai.anomalyScore.toFixed(2)}`)
      if (ai.recommendation) parts.push(`rec=${ai.recommendation}`)
      parts.push(`aic=${ai.confidence.toFixed(2)}`)
      if (ai.sessionDriftScore > 0) {
        parts.push(`drift=${ai.sessionDriftScore.toFixed(2)}`)
      }
      if (ai.surgeDetected) parts.push('surge=1')
      if (ai.future?.action) parts.push(`future=${ai.future.action}`)
    } else {
      parts.push(`ai=off(${ai.failReason || 'unavailable'})`)
    }
  } else if (input.anomalyScore != null) {
    parts.push(`ai=${input.anomalyScore}`)
  }
  if (input.aiMerge) {
    parts.push(`merge=${input.aiMerge.source}/${input.aiMerge.note}`)
  }
  if (input.futureActionApplied) {
    parts.push(`fa=${input.futureActionApplied}`)
  }
  if (isClearanceRevoked(input)) parts.push('revoke=1')

  if (geo.ipType) parts.push(`ipType=${geo.ipType}`)
  if (geo.countryCode) parts.push(`cc=${geo.countryCode}`)
  if (geo.city) parts.push(`city=${geo.city}`)
  if (geo.asn != null) parts.push(`asn=${geo.asn}`)
  return parts.join(' | ').slice(0, 500)
}

function buildReasonDetails(
  input: EventLoggerInput,
  geo: ReturnType<typeof resolveGeoNetwork>,
): Record<string, unknown> {
  const sim = resolveSimulationMeta(input)
  const base: Record<string, unknown> = {
    ...(input.reasonDetails || {}),
  }

  if (sim.active) {
    base.simulation = {
      active: true,
      runId: sim.runId ?? null,
      persona: sim.persona ?? null,
      jsDirective: sim.js ?? null,
      aiScore: sim.aiScore ?? null,
      countryHint: sim.countryHint ?? null,
    }
  }

  if (input.riskResult) {
    base.riskComponents = input.riskResult.components
    if ('aiUnavailable' in input.riskResult) {
      base.aiUnavailable = (input.riskResult as RiskResult).aiUnavailable
    }
  }

  // ----- AI (جديد) -----
  const aiDetails = buildAiDetails(input)
  if (aiDetails) {
    base.ai = aiDetails
    const ai = resolveAi(input)
    if (ai && !ai.ok) base.aiUnavailable = true
  }
  const anomaly = resolveAnomaly(input, sim)
  if (anomaly.source) base.anomalySource = anomaly.source
  if (input.aiMerge) {
    base.aiMerge = {
      finalPath: input.aiMerge.finalPath,
      source: input.aiMerge.source,
      note: input.aiMerge.note,
      mustRevokeClearance: input.aiMerge.mustRevokeClearance,
      aiDroveDecision: aiDroveDecision(input),
    }
  }
  if (input.futureActionApplied) {
    base.futureActionApplied = input.futureActionApplied
  }
  if (isClearanceRevoked(input)) {
    base.clearanceRevoked = true
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
    const js = input.jsChallenge
    const expired = isJsExpired(js)
    base.challengeExpired = expired
    base.jsChallenge = {
      phase: js.phase,
      passed: js.passed,
      hardFailure: isRealJsFailure(js),
      expired,
      localSuspicionScore: js.telemetry.localSuspicionScore,
      failReasons: js.telemetry.failReasons,
      suspicionHints: js.telemetry.suspicionHints,
      solveDurationMs: js.telemetry.solveDurationMs,
      challengeId: js.telemetry.challengeId || null,
      token: js.telemetry.token ?? null,
      browserSummary: js.telemetry.browser
        ? {
            webdriver: js.telemetry.browser.nav.webdriver,
            platform: js.telemetry.browser.nav.platform,
            hw: js.telemetry.browser.nav.hardwareConcurrency,
            webglOk: js.telemetry.browser.webgl.ok,
            plugins: js.telemetry.browser.nav.pluginsLength,
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

  base.geo = {
    countryCode: geo.countryCode ?? null,
    countryName: geo.countryName ?? null,
    region: geo.region ?? null,
    city: geo.city ?? null,
    latitude: geo.latitude ?? null,
    longitude: geo.longitude ?? null,
    timezone: geo.timezone ?? null,
  }
  base.asnInfo = {
    asn: geo.asn ?? null,
    asOrg: geo.asOrg ?? null,
  }
  if (input.ipReputation) {
    base.ipReputation = {
      kind: input.ipReputation.kind,
      networkRiskScore: input.ipReputation.networkRiskScore,
      confidence: input.ipReputation.confidence,
      badIp: input.ipReputation.badIp,
      badIpContributionHint: input.ipReputation.badIpContributionHint,
      signals: input.ipReputation.signals,
      reasons: input.ipReputation.reasons,
      hints: input.ipReputation.hints,
      sources: input.ipReputation.sources,
      timingMs: input.ipReputation.timingMs,
    }
  } else if (
    geo.networkRiskScore != null ||
    geo.badIp != null ||
    geo.ipType
  ) {
    base.ipReputation = {
      kind: geo.ipType ?? null,
      networkRiskScore: geo.networkRiskScore ?? null,
      confidence: geo.confidence ?? null,
      badIp: geo.badIp ?? null,
      reasons: geo.reasons ?? null,
      sources: geo.sources ?? null,
    }
  }

  return base
}

export function buildSecurityEvent(
  input: EventLoggerInput,
): GatewaySecurityEvent {
  const geo = resolveGeoNetwork(input)
  const sim = resolveSimulationMeta(input)
  const ai = resolveAi(input)

  const hardFail =
    isRealJsFailure(input.jsChallenge) ||
    isRealAdvancedFailure(input.advancedChallenge)

  const decision: EventDecision = hardFail
    ? 'BLOCK'
    : mapDecision(String(input.decision))

  const challenged =
    hardFail ||
    input.isChallenged === true ||
    decision === 'CHALLENGE' ||
    !!input.jsChallenge ||
    !!input.advancedChallenge ||
    input.aiMerge?.finalPath === 'silent_js_challenge' ||
    input.aiMerge?.finalPath === 'advanced_fingerprint_check' ||
    input.routeDecision?.route === 'silent_js_challenge' ||
    input.routeDecision?.route === 'advanced_fingerprint_check' ||
    input.routeDecision?.route === 'rate_limit_with_challenge'

  const challengePassed = hardFail ? false : resolveChallengePassed(input)

  // anomalyScore: ممرّر → AI حقيقي → sim → تحديات → سمعة الشبكة
  const anomaly = resolveAnomaly(input, sim).value

  // AI-derived (ما لم يتم تمريرها صراحة)
  const confidence =
    input.confidence ?? (ai?.ok ? ai.confidence : undefined) ?? geo.confidence
  const surgeDetected =
    input.surgeDetected ?? (ai?.ok ? ai.surgeDetected : undefined)
  const pathSensitive = input.pathSensitive ?? resolveAiPathSensitive(ai)
  const recommendation =
    input.recommendation ?? (ai?.ok ? ai.recommendation : null) ?? undefined

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
    confidence: confidence ?? undefined,
    reasonSummary: buildReasonSummary(input, geo),
    reasonDetails: buildReasonDetails(input, geo),
    processingTimeMs: input.processingTimeMs,
    surgeDetected,
    pathSensitive,
    recommendation: recommendation ?? undefined,
    countryCode: geo.countryCode,
    asn: geo.asn,
    ipType: geo.ipType,
    isChallenged: challenged,
    challengeType: mapChallengeType(input),
    challengePassed: challengePassed ?? undefined,
    reputationEntryId: input.reputationEntryId ?? undefined,
  }

  // ربط Run في الباك (Prisma SecurityEvent.simulationRunId)
  if (sim.runId) {
    event.simulationRunId = sim.runId
  }

  return event
}

// ------------------------------------------------------
// سمعة مرآة
// ------------------------------------------------------

const FP_RE = /^[A-Za-z0-9._:=+/\-]{4,512}$/

function cleanFp(v: string | null | undefined): string | undefined {
  return v && FP_RE.test(v) ? v : undefined
}

function cut(v: string | null | undefined, max: number): string | undefined {
  return v ? String(v).slice(0, max) : undefined
}

async function maybeMirrorReputation(input: EventLoggerInput): Promise<void> {
  if (input.mirrorReputation === false) return

  const decision = mapDecision(String(input.decision))
  const jsFail = isRealJsFailure(input.jsChallenge)
  const jsTimeout = jsFail && isJsExpired(input.jsChallenge)
  const advFail = isRealAdvancedFailure(input.advancedChallenge)

  if (decision !== 'BLOCK' && !jsFail && !advFail) return

  const geo = resolveGeoNetwork(input)
  const signals: ReputationSignal[] = []

  if (input.rateLimit?.hardExceeded) {
    signals.push({
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'HIGH',
      confidence: 0.9,
    })
  }

  if (input.ipReputation?.badIp) {
    const kind = input.ipReputation.kind
    const type =
      kind === 'TOR'
        ? 'TOR_EXIT_NODE'
        : kind === 'VPN_PROXY'
          ? 'VPN_PROXY_IP'
          : kind === 'DATACENTER'
            ? 'DATACENTER_IP'
            : null
    if (type) {
      signals.push({
        type,
        severity: kind === 'TOR' ? 'CRITICAL' : 'HIGH',
        confidence: Math.min(1, Math.max(0, input.ipReputation.confidence ?? 1)),
        note: cut(input.ipReputation.reasons?.join(',') || kind, 200),
      })
    }
  }

  // AI: أرفق anomalyScore بكل إشارة (الحقل موجود في ReputationSignal)
  const ai = resolveAi(input)
  if (ai?.ok) {
    const score = clamp01(ai.anomalyScore)
    for (const s of signals) {
      if (s.anomalyScore == null) s.anomalyScore = score
    }
  }

  const failReason = (arr: string[] | undefined, fallback: string) =>
    cut(arr?.[0] || fallback, 200)

  const challengePayload =
    jsFail && input.jsChallenge
      ? {
          type: 'JS_SILENT' as const,
          passed: false,
          durationMs: jsTimeout
            ? undefined
            : (input.jsChallenge.telemetry.solveDurationMs ?? undefined),
          failureReason: failReason(
            input.jsChallenge.telemetry.failReasons,
            jsTimeout ? 'challenge_timeout' : input.jsChallenge.phase,
          ),
        }
      : advFail && input.advancedChallenge
        ? {
            type: 'TLS_FINGERPRINT' as const,
            passed: false,
            failureReason: failReason(
              input.advancedChallenge.telemetry.failCodes,
              input.advancedChallenge.telemetry.verdict,
            ),
          }
        : undefined

  if (signals.length === 0 && !challengePayload) return

  const cc =
    geo.countryCode && /^[A-Za-z]{2}$/.test(geo.countryCode)
      ? geo.countryCode
      : undefined

  try {
    await applyReputation({
      organizationId: input.organizationId,
      serverId: input.serverId,
      ipAddress: input.ipAddress,
      signals,
      deviceFingerprint: cleanFp(input.deviceFingerprint),
      ja3Fingerprint: cleanFp(input.ja3),
      ja4Fingerprint: cleanFp(input.ja4),
      lastPath: cut(input.path, 2048),
      lastUserAgent: cut(input.userAgent, 512),
      countryCode: cc,
      asn: geo.asn && geo.asn >= 1 ? geo.asn : undefined,
      asOrg: cut(geo.asOrg, 255),
      ipType: geo.ipType,
      challenge: challengePayload,
      idempotencyKey: input.requestId ? `evt:${input.requestId}` : undefined,
    })
  } catch (err) {
    const e = err as Error & {
      details?: { errors?: unknown } & Record<string, unknown>
    }
    console.error(
      '[event-logger] reputation mirror failed',
      e.message,
      JSON.stringify(e.details?.errors ?? e.details ?? null),
    )
  }
}

function fireMirror(input: EventLoggerInput): void {
  maybeMirrorReputation(input).catch((err) => {
    console.error(
      '[event-logger] reputation mirror crashed',
      (err as Error).message,
    )
  })
}

// ------------------------------------------------------
// API العامة
// ------------------------------------------------------

export function logSecurityEvent(input: EventLoggerInput): EventLoggerResult {
  try {
    if (!input.organizationId || !input.serverId || !input.ipAddress) {
      return {
        queued: false,
        error: 'missing organizationId|serverId|ipAddress',
      }
    }
    const event = buildSecurityEvent(input)

    if (queue.length >= QUEUE_HARD_CAP) {
      queue.splice(0, queue.length - QUEUE_HARD_CAP + 1)
    }
    queue.push(event)

    if (queue.length >= BATCH_MAX) {
      void flushQueue()
    } else {
      scheduleFlush()
    }
    fireMirror(input)

    return { queued: true }
  } catch (err) {
    return { queued: false, error: (err as Error).message }
  }
}

export async function logSecurityEventImmediate(
  input: EventLoggerInput,
): Promise<EventLoggerResult> {
  try {
    const event = buildSecurityEvent(input)
    const created = await sendSecurityEvent(event)
    await maybeMirrorReputation(input)
    return { queued: false, sent: true, eventId: created.id }
  } catch (err) {
    return { queued: false, sent: false, error: (err as Error).message }
  }
}

/**
 * مدخل app.ts الوحيد: استدعاء واحد في آخر الطلب.
 * يقبل كل حقول EventLoggerInput (يشمل ai / aiPost / aiMerge / futureActionApplied
 * / clearanceRevoked / surge / pathSensitive / ...) — أي حقل جديد يتضاف في
 * EventLoggerInput يتمرر هنا تلقائيًا من غير تعديل.
 * الاختلاف الوحيد: ip بدل ipAddress، و startTime لحساب processingTimeMs.
 */
export type GatewayLogContext = Omit<
  EventLoggerInput,
  'ipAddress' | 'requestId' | 'processingTimeMs'
> & {
  ip: string
  requestId: string
  startTime: number
  /** لو اتحسب برّه — يتقدّم على startTime */
  processingTimeMs?: number
}

export function logFromGatewayContext(
  params: GatewayLogContext,
): EventLoggerResult {
  const { ip, startTime, processingTimeMs, ...rest } = params
  return logSecurityEvent({
    ...rest,
    ipAddress: ip,
    processingTimeMs: processingTimeMs ?? Date.now() - startTime,
  })
}

export default {
  logSecurityEvent,
  logSecurityEventImmediate,
  logFromGatewayContext,
  buildSecurityEvent,
  flushEventLogger,
}