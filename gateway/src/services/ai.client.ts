// ======================================================
// ZERO PLUS GATEWAY — services/ai.client.ts
// ------------------------------------------------------
// العميل الرسمي الوحيد للـ AI Service (POST /analyze)
//
// مسؤوليات:
//   1) بناء AnalyzeRequest كامل من سياق الـ Gateway (Phase 1 + 2)
//   2) نداء آمن: timeout + shared secret + بدون تسريب أسرار
//   3) Parse AnalyzeResponse والتحقق الخفيف من الشكل
//   4) Fail-open: أي فشل → null (الـ Risk/Policy يكملوا لوحدهم)
//   5) مساعدة دمج التوصية مع قرار الجتواي (من غير تنفيذ مباشر هنا)
//   6) مفاتيح Redis للـ future_action (التخزين/القراءة في app أو redis helper)
//
// مش مسؤول عن:
//   - قرار ALLOW/BLOCK النهائي (app + risk + policy)
//   - تنفيذ Challenge / revoke (app.ts)
//   - تعلم الموديل (ده جوّه ai-service)
//
// قواعد الدمج المتفق عليها (تُنفَّذ في app.ts باستخدام helpers هنا):
//   - أول طلب / من غير future مخزّن: AI = إشارة داخل Risk + recommendation تُؤخذ في الحسبان
//   - طلب لاحق بعد future من AI: الجتواي ينفّذ future (تحدي / rate_limit / revoke_clearance / monitor…)
//     مش "block/allow خام من AI لوحده" كاستبدال كامل للـ Policy — إلا لو السياسة تسمح صراحة
//   - تحدي واحد فقط لنفس الطلب (لو الجتواي مخطط JS+advanced والـ AI قال JS → JS ثم لاحقًا advanced
//     على طلب تاني أو حسب ترتيب المسار — مش تحديين متزامنين)
//   - revoke_clearance → شيل التصريح + اعتبر الزائر جديد (إعادة مسار الفحص)
// ======================================================

import axios, { AxiosError, AxiosInstance } from 'axios'
import { createHash } from 'node:crypto'
import { config } from '../config'

// ======================================================
// أنواع متوافقة مع ai-service schemas (request.py / response.py)
// ======================================================

export type AnalysisPhase = 'pre_decision' | 'post_decision'

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'OTHER'

export type FutureAction =
  | 'allow_normal'
  | 'revalidate_clearance'
  | 'javascript_challenge'
  | 'advanced_fingerprint_check'
  | 'rate_limit'
  | 'monitor'
  | 'block'

export type ChallengeOutcome =
  | 'passed'
  | 'failed'
  | 'timeout'
  | 'skipped'
  | 'not_applicable'

export type OriginResultStatus =
  | 'success'
  | 'error'
  | 'timeout'
  | 'blocked'
  | 'not_reached'

export type AiRecommendation =
  | 'allow'
  | 'monitor'
  | 'rate_limit'
  | 'javascript_challenge'
  | 'advanced_fingerprint'
  | 'strict'
  | 'revoke_clearance'
  | 'block'

export type PathSensitivityLevel = 'low' | 'medium' | 'high' | 'critical'
export type ConfidenceLevel = 'low' | 'medium' | 'high'

// ----- Nested request blocks -----

export interface FingerprintAuthPayload {
  has_usable_device_fp?: boolean | null
  device_fp?: string | null
  device_fp_source?: string | null
  ja4?: string | null
  ja3?: string | null
  ja4_valid_format?: boolean | null
  ja3_valid_format?: boolean | null
  edge_server_token_ok?: boolean | null
  fingerprint_ban_key?: string | null
  signals?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface IpReputationPayload {
  score?: number | null
  is_tor_exit?: boolean | null
  is_proxy?: boolean | null
  is_datacenter?: boolean | null
  is_known_attacker?: boolean | null
  asn?: number | null
  asn_org?: string | null
  country?: string | null
  city?: string | null
  geo_anomaly_hint?: string | null
  reputation_sources?: string[] | null
  raw?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface RateLimitPayload {
  limited?: boolean | null
  current_count?: number | null
  limit?: number | null
  window_sec?: number | null
  remaining?: number | null
  policy_name?: string | null
  retry_after_sec?: number | null
  [key: string]: unknown
}

export interface JsChallengeTelemetry {
  challenged?: boolean | null
  outcome?: ChallengeOutcome | null
  solve_time_ms?: number | null
  min_solve_ms?: number | null
  max_solve_ms?: number | null
  suspicion_score?: number | null
  challenge_id?: string | null
  hard_failure?: boolean | null
  expired_open?: boolean | null
  raw?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface AdvancedFingerprintTelemetry {
  challenged?: boolean | null
  outcome?: ChallengeOutcome | null
  score?: number | null
  fail_threshold?: number | null
  review_threshold?: number | null
  ua_family?: string | null
  ja4_looks_valid?: boolean | null
  ja3_looks_valid?: boolean | null
  ua_tls_consistency?: number | null
  session_key?: string | null
  raw?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface ClearancePayload {
  present?: boolean | null
  valid?: boolean | null
  expired?: boolean | null
  revoked?: boolean | null
  issued_at?: string | null
  expires_at?: string | null
  ttl_minutes?: number | null
  source?: string | null
  [key: string]: unknown
}

export interface PreviousAiContext {
  anomaly_score?: number | null
  recommendation?: string | null
  future_action?: FutureAction | null
  model_version?: string | null
  decided_at?: string | null
  [key: string]: unknown
}

export interface GatewayOutcomePayload {
  request_id?: string | null
  ai_model_version?: string | null
  ai_anomaly_score?: number | null
  ai_recommendation?: string | null
  gateway_risk_score?: number | null
  router_decision?: string | null
  policy_decision?: string | null
  actual_action?: string | null
  challenge_result?: ChallengeOutcome | null
  origin_result?: OriginResultStatus | null
  origin_status_code?: number | null
  origin_latency_ms?: number | null
  server_load?: number | null
  server_load_hint?: string | null
  notes?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface AnalyzeRequestBody {
  phase?: AnalysisPhase
  org_id?: string | null
  request_id?: string | null
  session_id?: string | null
  ip?: string | null
  path?: string | null
  method?: HttpMethod | string | null
  status_code?: number | null
  user_agent?: string | null
  referer?: string | null
  content_length?: number | null
  timestamp?: string | null
  received_at?: string | null
  ja4?: string | null
  ja3?: string | null
  device_fp?: string | null
  risk_score_so_far?: number | null
  suspicion_level?: string | null
  fingerprint_auth?: FingerprintAuthPayload | null
  ip_reputation?: IpReputationPayload | null
  rate_limit?: RateLimitPayload | null
  js_challenge?: JsChallengeTelemetry | null
  advanced_fingerprint?: AdvancedFingerprintTelemetry | null
  clearance?: ClearancePayload | null
  previous_ai?: PreviousAiContext | null
  future_action_applied?: FutureAction | null
  gateway_outcome?: GatewayOutcomePayload | null
  extra?: Record<string, unknown> | null
  [key: string]: unknown
}

// ----- Response -----

export interface AnomalyResult {
  score: number
  is_high?: boolean
  is_medium?: boolean
  model_version?: string | null
  components?: Record<string, number> | null
}

export interface SessionDriftResult {
  score: number
  is_high?: boolean
  is_medium?: boolean
  history_size?: number
  compared_against?: string | null
}

export interface SurgeResult {
  detected?: boolean
  score?: number | null
  scope?: string | null
  hint?: string | null
}

export interface PathSensitivityResult {
  level?: PathSensitivityLevel | string
  path?: string | null
  matched_rule?: string | null
}

export interface ReasonItem {
  code: string
  message: string
  weight?: number | null
  meta?: Record<string, unknown> | null
}

export interface FutureGuidance {
  action?: FutureAction | null
  reason?: string | null
  ttl_sec?: number | null
  confidence?: number | null
}

export interface LearningMeta {
  learned?: boolean
  model_version?: string | null
  org_model_exists?: boolean
  cache_hit?: boolean
  processing_ms?: number | null
}

export interface Phase2Comparison {
  request_id?: string | null
  previous_anomaly_score?: number | null
  previous_recommendation?: string | null
  actual_action?: string | null
  matched?: boolean | null
  drift_from_prediction?: number | null
  notes?: string | null
}

export interface AnalyzeResponseBody {
  request_id?: string | null
  phase?: string | null
  org_id?: string | null
  session_id?: string | null
  anomaly: AnomalyResult
  session_drift: SessionDriftResult
  surge?: SurgeResult
  path_sensitivity?: PathSensitivityResult
  recommendation: AiRecommendation | string
  confidence: number
  confidence_level?: ConfidenceLevel | string
  reasons?: ReasonItem[]
  future?: FutureGuidance
  comparison?: Phase2Comparison | null
  learning?: LearningMeta
  model_version?: string | null
  ts?: string
  [key: string]: unknown
}

/** نتيجة موحّدة للجتواي بعد النداء */
export interface AiAnalyzeResult {
  ok: boolean
  /** فشل الشبكة/الوقت/الشكل — الجتواي يكمل من غير AI */
  failed: boolean
  failReason?: string
  /** درجة الشذوذ 0..1 جاهزة لـ risk.engine */
  anomalyScore: number
  recommendation: AiRecommendation | null
  confidence: number
  sessionDriftScore: number
  surgeDetected: boolean
  pathSensitivity: string
  reasons: ReasonItem[]
  future: FutureGuidance | null
  comparison: Phase2Comparison | null
  modelVersion: string | null
  raw: AnalyzeResponseBody | null
  processingMs: number
}

// ======================================================
// إعداد من config
// ======================================================

function aiBaseUrl(): string {
  const raw =
    (config as { ai?: { url?: string } }).ai?.url ||
    process.env.AI_URL ||
    'http://127.0.0.1:8001'
  return raw.replace(/\/+$/, '')
}

function aiTimeoutMs(): number {
  const n =
    (config as { ai?: { timeoutMs?: number } }).ai?.timeoutMs ??
    Number(process.env.AI_TIMEOUT_MS || 2500)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 15_000) : 2500
}

function aiInternalSecret(): string {
  return (
    (config as { ai?: { internalSecret?: string } }).ai?.internalSecret ||
    process.env.AI_INTERNAL_SECRET ||
    process.env.GATEWAY_INTERNAL_SECRET ||
    ''
  )
}

function aiEnabled(): boolean {
  const flag = process.env.AI_ENABLED
  if (flag === '0' || flag === 'false') return false
  return true
}

// ======================================================
// HTTP client (singleton)
// ======================================================

let client: AxiosInstance | null = null

function getClient(): AxiosInstance {
  if (client) return client
  client = axios.create({
    baseURL: aiBaseUrl(),
    timeout: aiTimeoutMs(),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'ZeroPlus-Gateway/ai-client',
    },
    // لا نرمي على 4xx بشكل يوقف المسار — نتعامل يدويًا
    validateStatus: () => true,
    maxRedirects: 0,
    // منع بروكسي غير مقصود
    proxy: false,
  })
  return client
}

function authHeaders(): Record<string, string> {
  const secret = aiInternalSecret()
  const headers: Record<string, string> = {}
  if (secret) {
    // هيدر داخلي مشترك — لازم يطابق ai-service
    headers['X-AI-Internal-Key'] = secret
    // توافق اختياري مع تسمية قديمة
    headers['X-Gateway-Key'] = secret
  }
  return headers
}

// ======================================================
// Helpers — مفاتيح future في Redis (يستخدمها app)
// ======================================================

/**
 * مفتاح تخزين future_action لنفس العميل تحت org
 * identity: device_fp إن وُجد وإلا IP
 */
export function aiFutureRedisKey(params: {
  orgId: string
  ip: string
  deviceFp?: string | null
}): string {
  const id = params.deviceFp?.trim() || params.ip
  const h = createHash('sha256').update(`${params.orgId}:${id}`).digest('hex').slice(0, 32)
  return `zp:ai:future:${params.orgId}:${h}`
}

export function aiPreviousRedisKey(params: {
  orgId: string
  ip: string
  deviceFp?: string | null
}): string {
  const id = params.deviceFp?.trim() || params.ip
  const h = createHash('sha256').update(`${params.orgId}:${id}`).digest('hex').slice(0, 32)
  return `zp:ai:prev:${params.orgId}:${h}`
}

// ======================================================
// Validation خفيف للرد
// ======================================================

function isFinite01(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
}

function normalizeRecommendation(v: unknown): AiRecommendation | null {
  if (typeof v !== 'string') return null
  const allowed: AiRecommendation[] = [
    'allow',
    'monitor',
    'rate_limit',
    'javascript_challenge',
    'advanced_fingerprint',
    'strict',
    'revoke_clearance',
    'block',
  ]
  return (allowed as string[]).includes(v) ? (v as AiRecommendation) : null
}

function parseAnalyzeResponse(data: unknown): AnalyzeResponseBody | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const anomaly = d.anomaly as Record<string, unknown> | undefined
  const drift = d.session_drift as Record<string, unknown> | undefined
  if (!anomaly || !isFinite01(anomaly.score)) return null
  if (!drift || typeof drift.score !== 'number') return null
  if (typeof d.recommendation !== 'string') return null
  if (typeof d.confidence !== 'number') return null
  return data as AnalyzeResponseBody
}

function toResult(
  raw: AnalyzeResponseBody | null,
  failed: boolean,
  failReason: string | undefined,
  processingMs: number,
): AiAnalyzeResult {
  if (!raw || failed) {
    return {
      ok: false,
      failed: true,
      failReason: failReason || 'ai_unavailable',
      anomalyScore: 0,
      recommendation: null,
      confidence: 0,
      sessionDriftScore: 0,
      surgeDetected: false,
      pathSensitivity: 'low',
      reasons: [],
      future: null,
      comparison: null,
      modelVersion: null,
      raw: null,
      processingMs,
    }
  }

  const score = Math.min(1, Math.max(0, Number(raw.anomaly.score) || 0))
  return {
    ok: true,
    failed: false,
    anomalyScore: score,
    recommendation: normalizeRecommendation(raw.recommendation),
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
    sessionDriftScore: Math.min(1, Math.max(0, Number(raw.session_drift?.score) || 0)),
    surgeDetected: Boolean(raw.surge?.detected),
    pathSensitivity: String(raw.path_sensitivity?.level || 'low'),
    reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
    future: raw.future ?? null,
    comparison: raw.comparison ?? null,
    modelVersion: raw.model_version ?? raw.anomaly?.model_version ?? null,
    raw,
    processingMs,
  }
}

// ======================================================
// بناء الجسم من سياق الجتواي
// ======================================================

export interface BuildAnalyzeInput {
  phase: AnalysisPhase
  orgId: string
  requestId: string
  sessionId?: string | null
  ip: string
  path: string
  method: string
  userAgent?: string | null
  referer?: string | null
  contentLength?: number | null
  ja4?: string | null
  ja3?: string | null
  deviceFp?: string | null
  riskScoreSoFar?: number | null
  suspicionLevel?: string | null
  fingerprintAuth?: FingerprintAuthPayload | null
  ipReputation?: IpReputationPayload | null
  rateLimit?: RateLimitPayload | null
  jsChallenge?: JsChallengeTelemetry | null
  advancedFingerprint?: AdvancedFingerprintTelemetry | null
  clearance?: ClearancePayload | null
  previousAi?: PreviousAiContext | null
  futureActionApplied?: FutureAction | null
  gatewayOutcome?: GatewayOutcomePayload | null
  extra?: Record<string, unknown> | null
}

export function buildAnalyzeRequest(input: BuildAnalyzeInput): AnalyzeRequestBody {
  const method = (input.method || 'GET').toUpperCase()
  const known = new Set([
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
  ])
  const normalizedMethod = known.has(method) ? method : 'OTHER'

  let path = (input.path || '/').trim() || '/'
  if (!path.startsWith('/')) path = `/${path}`

  const body: AnalyzeRequestBody = {
    phase: input.phase,
    org_id: input.orgId,
    request_id: input.requestId,
    session_id: input.sessionId ?? null,
    ip: input.ip,
    path,
    method: normalizedMethod,
    user_agent: input.userAgent ?? null,
    referer: input.referer ?? null,
    content_length: input.contentLength ?? null,
    timestamp: new Date().toISOString(),
    received_at: new Date().toISOString(),
    ja4: input.ja4 ?? null,
    ja3: input.ja3 ?? null,
    device_fp: input.deviceFp ?? null,
    risk_score_so_far:
      input.riskScoreSoFar == null
        ? null
        : Math.min(100, Math.max(0, input.riskScoreSoFar)),
    suspicion_level: input.suspicionLevel ?? null,
    fingerprint_auth: input.fingerprintAuth ?? null,
    ip_reputation: input.ipReputation ?? null,
    rate_limit: input.rateLimit ?? null,
    js_challenge: input.jsChallenge ?? null,
    advanced_fingerprint: input.advancedFingerprint ?? null,
    clearance: input.clearance ?? null,
    previous_ai: input.previousAi ?? null,
    future_action_applied: input.futureActionApplied ?? null,
    gateway_outcome: input.phase === 'post_decision' ? input.gatewayOutcome ?? null : null,
    extra: input.extra ?? null,
  }

  return body
}

// ======================================================
// تحويل مساعدة من نتائج موديولات الجتواي الشائعة
// ======================================================

export function mapIpReputationForAi(r: {
  kind?: string
  networkRiskScore?: number
  badIp?: boolean
  geo?: { countryCode?: string | null; city?: string | null }
  asn?: { number?: number | null; org?: string | null }
  signals?: Record<string, unknown>
  sources?: string[]
  hints?: string[]
  [key: string]: unknown
} | null | undefined): IpReputationPayload | null {
  if (!r) return null
  const kind = String(r.kind || '').toUpperCase()
  return {
    score: r.networkRiskScore ?? undefined,
    is_tor_exit: kind === 'TOR' || Boolean((r.signals as any)?.tor),
    is_proxy: kind === 'VPN_PROXY' || Boolean((r.signals as any)?.proxy),
    is_datacenter: kind === 'DATACENTER',
    is_known_attacker: Boolean(r.badIp),
    asn: r.asn?.number ?? null,
    asn_org: r.asn?.org ?? null,
    country: r.geo?.countryCode ?? null,
    city: r.geo?.city ?? null,
    geo_anomaly_hint: Array.isArray(r.hints) ? r.hints.join(',') : null,
    reputation_sources: r.sources ?? null,
    raw: r as Record<string, unknown>,
  }
}

// ======================================================
// دمج التوصية مع قرار الجتواي (منطق — التنفيذ في app)
// ======================================================

export type GatewayPlannedPath =
  | 'allow'
  | 'monitor'
  | 'rate_limit'
  | 'silent_js_challenge'
  | 'advanced_fingerprint_check'
  | 'ban'
  | 'revoke_clearance'

/**
 * يدمج مسار الجتواي (من risk/router/policy) مع توصية AI.
 * - طلب "أول مرة" (لا future مُطبَّق): AI يشدد فقط أو يساوي — لا يخفف ban مقصود إلا بسياسة صريحة
 * - future_action من طلب سابق: يُفضَّل تنفيذه قبل الدمج العادي (يُمرَّر من app)
 * - تحدي واحد لكل طلب
 */
export function mergeAiWithGatewayPlan(params: {
  gatewayPath: GatewayPlannedPath
  ai: AiAnalyzeResult | null
  /** هل هذا تطبيق future من طلب سابق؟ */
  applyingStoredFuture?: boolean
}): {
  finalPath: GatewayPlannedPath
  /** لو true: لازم revoke clearance قبل أي مسار */
  mustRevokeClearance: boolean
  source: 'gateway' | 'ai' | 'merged' | 'future'
  note: string
} {
  const gw = params.gatewayPath
  const rec = params.ai?.ok ? params.ai.recommendation : null

  if (!params.ai?.ok || !rec) {
    return {
      finalPath: gw,
      mustRevokeClearance: false,
      source: 'gateway',
      note: 'ai_unavailable_or_empty',
    }
  }

  if (rec === 'revoke_clearance') {
    return {
      finalPath: gw === 'ban' ? 'ban' : 'silent_js_challenge',
      mustRevokeClearance: true,
      source: 'merged',
      note: 'ai_revoke_clearance_then_recheck',
    }
  }

  // AI يطلب تحدي — الجتواي كان allow/monitor → ارفع لتحدي (واحد)
  if (
    (rec === 'javascript_challenge' || rec === 'strict') &&
    (gw === 'allow' || gw === 'monitor')
  ) {
    return {
      finalPath: 'silent_js_challenge',
      mustRevokeClearance: false,
      source: 'merged',
      note: 'ai_challenge_overrides_soft_allow',
    }
  }

  if (
    rec === 'advanced_fingerprint' &&
    (gw === 'allow' || gw === 'monitor' || gw === 'silent_js_challenge')
  ) {
    // تحدي واحد: لو الجتواي أصلاً JS، نكمّل advanced على هذا المسار بدل تحديين منفصلين متزامنين
    return {
      finalPath: 'advanced_fingerprint_check',
      mustRevokeClearance: false,
      source: 'merged',
      note: 'ai_advanced_single_challenge',
    }
  }

  if (rec === 'rate_limit' && (gw === 'allow' || gw === 'monitor')) {
    return {
      finalPath: 'rate_limit',
      mustRevokeClearance: false,
      source: 'merged',
      note: 'ai_rate_limit',
    }
  }

  if (rec === 'monitor' && gw === 'allow') {
    return {
      finalPath: 'monitor',
      mustRevokeClearance: false,
      source: 'merged',
      note: 'ai_monitor',
    }
  }

  // ban من الجتواي يبقى ban (AI block وحده ما يستبدل السياسة إلا لو future صريح — يُعالج في app)
  if (gw === 'ban') {
    return {
      finalPath: 'ban',
      mustRevokeClearance: false,
      source: 'gateway',
      note: 'gateway_ban_holds',
    }
  }

  if (rec === 'block' && (gw === 'silent_js_challenge' || gw === 'advanced_fingerprint_check')) {
    // لا نقفز مباشرة لـ hard block من AI على نفس الطلب إن كان في مسار تحدي — كمّل التحدي
    return {
      finalPath: gw,
      mustRevokeClearance: false,
      source: 'merged',
      note: 'prefer_challenge_over_immediate_ai_block',
    }
  }

  return {
    finalPath: gw,
    mustRevokeClearance: false,
    source: 'merged',
    note: 'gateway_primary_ai_advisory',
  }
}

/**
 * هل توصية AI تُحسب "تحدي" (لتطبيق قاعدة تحدي واحد)؟
 */
export function isChallengeRecommendation(rec: AiRecommendation | null): boolean {
  return (
    rec === 'javascript_challenge' ||
    rec === 'advanced_fingerprint' ||
    rec === 'strict'
  )
}

// ======================================================
// النداء الرئيسي
// ======================================================

/**
 * Phase 1 أو 2 — fail-open دائمًا
 */
export async function analyzeWithAi(
  input: BuildAnalyzeInput,
): Promise<AiAnalyzeResult> {
  const started = Date.now()

  if (!aiEnabled()) {
    return toResult(null, true, 'ai_disabled', Date.now() - started)
  }

  if (!input.orgId || !input.requestId) {
    return toResult(null, true, 'missing_org_or_request_id', Date.now() - started)
  }

  const body = buildAnalyzeRequest(input)

  try {
    const res = await getClient().post('/analyze', body, {
      headers: authHeaders(),
      timeout: aiTimeoutMs(),
    })

    const ms = Date.now() - started

    if (res.status === 401 || res.status === 403) {
      console.error('[ai.client] unauthorized — check AI_INTERNAL_SECRET')
      return toResult(null, true, 'ai_unauthorized', ms)
    }

    if (res.status >= 500) {
      console.error('[ai.client] upstream 5xx', res.status)
      return toResult(null, true, 'ai_5xx', ms)
    }

    if (res.status >= 400) {
      console.warn('[ai.client] upstream 4xx', res.status, res.data)
      return toResult(null, true, 'ai_4xx', ms)
    }

    const parsed = parseAnalyzeResponse(res.data)
    if (!parsed) {
      console.warn('[ai.client] invalid response shape')
      return toResult(null, true, 'ai_bad_shape', ms)
    }

    return toResult(parsed, false, undefined, ms)
  } catch (err) {
    const ms = Date.now() - started
    const ax = err as AxiosError
    const reason =
      ax.code === 'ECONNABORTED'
        ? 'ai_timeout'
        : ax.code === 'ECONNREFUSED'
          ? 'ai_refused'
          : 'ai_network_error'
    console.error('[ai.client]', reason, ax.message)
    return toResult(null, true, reason, ms)
  }
}

/** اختصار Phase 1 */
export async function analyzePreDecision(
  input: Omit<BuildAnalyzeInput, 'phase'>,
): Promise<AiAnalyzeResult> {
  return analyzeWithAi({ ...input, phase: 'pre_decision' })
}

/** اختصار Phase 2 */
export async function analyzePostDecision(
  input: Omit<BuildAnalyzeInput, 'phase'> & {
    gatewayOutcome: GatewayOutcomePayload
  },
): Promise<AiAnalyzeResult> {
  return analyzeWithAi({
    ...input,
    phase: 'post_decision',
    gatewayOutcome: input.gatewayOutcome,
  })
}

/**
 * Health خفيف للـ AI (مش على مسار الزائر)
 */
export async function pingAi(): Promise<boolean> {
  if (!aiEnabled()) return false
  try {
    const res = await getClient().get('/health', {
      timeout: Math.min(2000, aiTimeoutMs()),
      headers: authHeaders(),
      validateStatus: () => true,
    })
    return res.status >= 200 && res.status < 300
  } catch {
    return false
  }
}

// ======================================================
// Default export
// ======================================================

export default {
  analyzeWithAi,
  analyzePreDecision,
  analyzePostDecision,
  buildAnalyzeRequest,
  mapIpReputationForAi,
  mergeAiWithGatewayPlan,
  isChallengeRecommendation,
  aiFutureRedisKey,
  aiPreviousRedisKey,
  pingAi,
}