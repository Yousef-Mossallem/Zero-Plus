/**
 * risk/signalsCollector.ts  (أو services/signals.collector.ts)
 * ==================================================================
 * تجميع كل إشارات الطلب في شكلين جاهزين:
 *   1) RiskSignals          → core/risk.engine.calculateRisk
 *   2) BuildAnalyzeInput    → services/ai.client.analyzePre/PostDecision
 *
 * الهدف: الـ AI يستقبل صورة كاملة ومتسقة فيتعلّم ويُوصي بدقّة،
 *         والـ Risk يُحسب من نفس المصدر من غير تلزيق يدوي في app.ts.
 *
 * لا يفعل:
 *   - نداء HTTP / Redis / AI
 *   - قرار ALLOW/BLOCK
 *   - تنفيذ تحدي أو حظر
 *
 * app.ts يمرّر مخرجات الموديولات → collector → risk + AI.
 * ==================================================================
 */

import type {
  BuildAnalyzeInput,
  AnalysisPhase,
  FingerprintAuthPayload,
  IpReputationPayload,
  RateLimitPayload,
  JsChallengeTelemetry,
  AdvancedFingerprintTelemetry,
  ClearancePayload,
  PreviousAiContext,
  GatewayOutcomePayload,
  FutureAction,
  ChallengeOutcome,
} from '../services/ai.client';

import {
  mapIpReputationForAi,
  buildAnalyzeRequest,
  type AnalyzeRequestBody,
} from '../services/ai.client';

import {
  buildRiskSignals,
  emptyRiskSignals,
  type RiskSignals,
  type RateLevel,
  type RiskResult,
} from '../core/risk.engine';

import type { IpReputationResult } from '../detection/ip-reputation';
import { ipReputationForAi, ipReputationToAnalyzePayload } from '../detection/ip-reputation';

import type { IntakeClassifyResult } from '../detection/intakeClassifier';
import { intakeForAi } from '../detection/intakeClassifier';

import type { RouteDecision } from '../detection/suspicion-router';

// ------------------------------------------------------------------
// أنواع مرنة لمخرجات الموديولات (حتى لو الشكل اتغيّر جزئيًا)
// ------------------------------------------------------------------

export interface RateLimitSnapshot {
  limited?: boolean;
  softExceeded?: boolean;
  hardExceeded?: boolean;
  level?: RateLevel | 'none' | 'soft' | 'hard';
  currentCount?: number | null;
  limit?: number | null;
  windowSec?: number | null;
  remaining?: number | null;
  retryAfterSec?: number | null;
  policyName?: string | null;
  raw?: Record<string, unknown>;
}

export interface FingerprintSnapshot {
  ja4?: string | null;
  ja3?: string | null;
  deviceFingerprint?: string | null;
  deviceFpSource?: string | null;
  ja4ValidFormat?: boolean | null;
  ja3ValidFormat?: boolean | null;
  edgeServerTokenOk?: boolean | null;
  fingerprintBanKey?: string | null;
  suspicious?: boolean;
  suspicionScore?: number | null;
  signals?: Record<string, unknown> | null;
}

export interface ClearanceSnapshot {
  present?: boolean;
  valid?: boolean;
  expired?: boolean;
  revoked?: boolean;
  issuedAt?: string | null;
  expiresAt?: string | null;
  ttlMinutes?: number | null;
  source?: string | null;
}

export interface BanHistorySnapshot {
  isBlacklisted?: boolean;
  isBanned?: boolean;
  banStatus?: string | null;
  priorFailures?: number | null;
  reputationScore?: number | null;
  knownBotnet?: boolean;
  allowlisted?: boolean;
  /** 0..1 يدوي إن حابب */
  priorHistoryScore?: number | null;
}

export interface ChallengeSnapshot {
  js?: {
    challenged?: boolean;
    outcome?: ChallengeOutcome | string | null;
    solveTimeMs?: number | null;
    minSolveMs?: number | null;
    maxSolveMs?: number | null;
    suspicionScore?: number | null;
    challengeId?: string | null;
    hardFailure?: boolean | null;
    expired?: boolean | null;
    phase?: string | null;
    raw?: Record<string, unknown> | null;
  } | null;
  advanced?: {
    challenged?: boolean;
    outcome?: ChallengeOutcome | string | null;
    score?: number | null;
    failThreshold?: number | null;
    reviewThreshold?: number | null;
    uaFamily?: string | null;
    ja4LooksValid?: boolean | null;
    ja3LooksValid?: boolean | null;
    uaTlsConsistency?: number | null;
    sessionKey?: string | null;
    raw?: Record<string, unknown> | null;
  } | null;
}

export interface SimulationSnapshot {
  active?: boolean;
  runId?: string | null;
  persona?: string | null;
  jsDirective?: string | null;
  aiScoreOverride?: number | null;
  countryHint?: string | null;
}

export interface ServerLoadSnapshot {
  load?: number | null;
  hint?: 'low' | 'medium' | 'high' | 'critical' | string | null;
  originLatencyMs?: number | null;
  originStatusCode?: number | null;
  originResult?: string | null;
}

/**
 * كل ما يجمعه الـ pipeline قبل/بعد القرار
 */
export interface CollectorContext {
  // هوية الطلب
  orgId: string;
  requestId: string;
  sessionId?: string | null;
  ip: string;
  path: string;
  method: string;
  host?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  contentLength?: number | null;

  // طبقات
  intake?: IntakeClassifyResult | null;
  ipReputation?: IpReputationResult | null;
  fingerprint?: FingerprintSnapshot | null;
  rateLimit?: RateLimitSnapshot | null;
  clearance?: ClearanceSnapshot | null;
  banHistory?: BanHistorySnapshot | null;
  challenges?: ChallengeSnapshot | null;
  simulation?: SimulationSnapshot | null;
  server?: ServerLoadSnapshot | null;

  // AI سابق / future مُطبَّق
  previousAi?: PreviousAiContext | null;
  futureActionApplied?: FutureAction | null;

  /**
   * درجة AI لهذه الجولة (Phase 1) إن اتحسبت بدري
   * أو من المحاكاة — تُحقن في Risk
   */
  aiAnomalyScore?: number | null;

  /** بعد calculateRisk — لـ Phase 1 risk_score_so_far أو Phase 2 */
  riskResult?: RiskResult | null;
  routeDecision?: RouteDecision | null;
  policyDecision?: string | null;
  actualAction?: string | null;

  /** Phase 2 */
  gatewayOutcome?: GatewayOutcomePayload | null;

  /** حقول إضافية حرة */
  extra?: Record<string, unknown> | null;
}

export interface CollectedSignals {
  /** جاهز لـ calculateRisk */
  riskSignals: RiskSignals;
  /** جاهز لـ analyzePreDecision / analyzeWithAi */
  aiBuild: BuildAnalyzeInput;
  /** جسم POST كامل (للتشخيص أو إرسال مباشر) */
  analyzeBody: AnalyzeRequestBody;
  /** حزمة مضغوطة للّوج */
  summary: CollectedSummary;
  /** meta */
  meta: {
    orgId: string;
    requestId: string;
    phase: AnalysisPhase;
    hasIpRep: boolean;
    hasFingerprint: boolean;
    hasRate: boolean;
    hasClearance: boolean;
    hasJsTelemetry: boolean;
    hasAdvancedTelemetry: boolean;
    isSimulation: boolean;
    collectedAt: string;
  };
}

export interface CollectedSummary {
  ipKind?: string | null;
  badIp?: boolean;
  networkRisk?: number | null;
  rateLevel?: string | null;
  clearanceValid?: boolean | null;
  fingerprintSuspicious?: boolean | null;
  intakePriority?: string | null;
  intakeLane?: string | null;
  aiScoreInjected?: number | null;
  priorHistory?: boolean;
  path?: string;
  method?: string;
}

// ------------------------------------------------------------------
// تطبيع داخلي
// ------------------------------------------------------------------

function clamp01(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function asChallengeOutcome(
  v: string | ChallengeOutcome | null | undefined,
): ChallengeOutcome | null {
  if (!v) return null;
  const s = String(v);
  const allowed: ChallengeOutcome[] = [
    'passed',
    'failed',
    'timeout',
    'skipped',
    'not_applicable',
  ];
  return (allowed as string[]).includes(s) ? (s as ChallengeOutcome) : null;
}

function deriveRateLevel(r?: RateLimitSnapshot | null): RateLevel {
  if (!r) return 'none';
  if (r.level === 'hard' || r.hardExceeded) return 'hard';
  if (r.level === 'soft' || r.softExceeded) return 'soft';
  if (r.limited && (r.remaining === 0 || (r.currentCount != null && r.limit != null && r.currentCount >= r.limit))) {
    return 'hard';
  }
  if (r.limited) return 'soft';
  return 'none';
}

function derivePriorHistory(b?: BanHistorySnapshot | null): {
  priorHistory: boolean;
  priorHistoryScore: number | null;
} {
  if (!b) return { priorHistory: false, priorHistoryScore: null };
  if (b.allowlisted) return { priorHistory: false, priorHistoryScore: 0 };

  if (typeof b.priorHistoryScore === 'number') {
    return {
      priorHistory: b.priorHistoryScore > 0,
      priorHistoryScore: clamp01(b.priorHistoryScore),
    };
  }

  let score = 0;
  if (b.isBlacklisted || b.isBanned) score = Math.max(score, 1);
  if (b.knownBotnet) score = Math.max(score, 0.95);
  if (b.banStatus && b.banStatus !== 'NONE') score = Math.max(score, 0.85);
  if (typeof b.priorFailures === 'number' && b.priorFailures > 0) {
    score = Math.max(score, Math.min(1, 0.25 * b.priorFailures));
  }
  if (typeof b.reputationScore === 'number') {
    // افترض 0..10 سمعة سيئة عالية
    if (b.reputationScore >= 8) score = Math.max(score, 0.9);
    else if (b.reputationScore >= 5) score = Math.max(score, 0.55);
    else if (b.reputationScore >= 3) score = Math.max(score, 0.3);
  }

  return {
    priorHistory: score > 0,
    priorHistoryScore: score > 0 ? score : null,
  };
}

function deriveSuspiciousFingerprint(fp?: FingerprintSnapshot | null): {
  suspiciousFingerprint: boolean;
  suspiciousFingerprintScore: number | null;
} {
  if (!fp) return { suspiciousFingerprint: false, suspiciousFingerprintScore: null };

  if (typeof fp.suspicionScore === 'number') {
    const s = clamp01(fp.suspicionScore);
    return { suspiciousFingerprint: s > 0, suspiciousFingerprintScore: s };
  }

  if (fp.suspicious) {
    return { suspiciousFingerprint: true, suspiciousFingerprintScore: 1 };
  }

  // إشارات ضعف صامتة (مش بالضرورة “سوء” كامل)
  let soft = 0;
  if (!fp.ja4 && !fp.ja3) soft += 0.15;
  if (fp.edgeServerTokenOk === false) soft += 0.35;
  if (fp.ja4ValidFormat === false || fp.ja3ValidFormat === false) soft += 0.4;
  if (!fp.deviceFingerprint && (fp.ja4 || fp.ja3)) soft += 0.1;

  if (soft <= 0) {
    return { suspiciousFingerprint: false, suspiciousFingerprintScore: null };
  }
  return {
    suspiciousFingerprint: soft >= 0.35,
    suspiciousFingerprintScore: Math.min(1, soft),
  };
}

// ------------------------------------------------------------------
// تحويلات للـ AI payloads
// ------------------------------------------------------------------

export function collectFingerprintAuth(
  fp?: FingerprintSnapshot | null,
): FingerprintAuthPayload | null {
  if (!fp) return null;
  return {
    has_usable_device_fp: Boolean(fp.deviceFingerprint),
    device_fp: fp.deviceFingerprint ?? null,
    device_fp_source: fp.deviceFpSource ?? null,
    ja4: fp.ja4 ?? null,
    ja3: fp.ja3 ?? null,
    ja4_valid_format: fp.ja4ValidFormat ?? null,
    ja3_valid_format: fp.ja3ValidFormat ?? null,
    edge_server_token_ok: fp.edgeServerTokenOk ?? null,
    fingerprint_ban_key: fp.fingerprintBanKey ?? null,
    signals: fp.signals ?? null,
  };
}

export function collectIpReputationPayload(
  ip?: IpReputationResult | null,
): IpReputationPayload | null {
  if (!ip) return null;
  // تفضيل الماب المتوافق مع ai.client + إثراء من toAnalyze إن وُجد
  const mapped = mapIpReputationForAi({
    kind: ip.kind,
    networkRiskScore: ip.networkRiskScore,
    badIp: ip.badIp,
    geo: {
      countryCode: ip.geo?.countryCode,
      city: ip.geo?.city,
    },
    asn: {
      number: ip.asn?.asn ?? null,
      org: ip.asn?.asOrg ?? null,
    },
    signals: ip.signals as unknown as Record<string, unknown>,
    sources: ip.sources,
    hints: ip.hints,
  });

  try {
    const rich = ipReputationToAnalyzePayload(ip);
    return {
      ...mapped,
      ...rich,
      raw: {
        ...(typeof mapped?.raw === 'object' && mapped.raw ? mapped.raw : {}),
        telemetry: ipReputationForAi(ip),
      },
    };
  } catch {
    return mapped;
  }
}

export function collectRateLimitPayload(
  r?: RateLimitSnapshot | null,
): RateLimitPayload | null {
  if (!r) return null;
  const level = deriveRateLevel(r);
  return {
    limited: Boolean(r.limited || level !== 'none'),
    current_count: r.currentCount ?? null,
    limit: r.limit ?? null,
    window_sec: r.windowSec ?? null,
    remaining: r.remaining ?? null,
    policy_name: r.policyName ?? level,
    retry_after_sec: r.retryAfterSec ?? null,
    raw: {
      level,
      softExceeded: r.softExceeded ?? false,
      hardExceeded: r.hardExceeded ?? false,
      ...(r.raw || {}),
    },
  };
}

export function collectClearancePayload(
  c?: ClearanceSnapshot | null,
): ClearancePayload | null {
  if (!c) {
    return {
      present: false,
      valid: false,
      expired: false,
      revoked: false,
    };
  }
  return {
    present: Boolean(c.present),
    valid: Boolean(c.valid),
    expired: Boolean(c.expired),
    revoked: Boolean(c.revoked),
    issued_at: c.issuedAt ?? null,
    expires_at: c.expiresAt ?? null,
    ttl_minutes: c.ttlMinutes ?? null,
    source: c.source ?? null,
  };
}

export function collectJsTelemetry(
  ch?: ChallengeSnapshot | null,
): JsChallengeTelemetry | null {
  const js = ch?.js;
  if (!js) return null;
  return {
    challenged: Boolean(js.challenged),
    outcome: asChallengeOutcome(js.outcome as ChallengeOutcome | string | null),
    solve_time_ms: js.solveTimeMs ?? null,
    min_solve_ms: js.minSolveMs ?? null,
    max_solve_ms: js.maxSolveMs ?? null,
    suspicion_score: js.suspicionScore ?? null,
    challenge_id: js.challengeId ?? null,
    hard_failure: js.hardFailure ?? null,
    expired_open: js.expired ?? null,
    raw: {
      phase: js.phase ?? null,
      ...(js.raw || {}),
    },
  };
}

export function collectAdvancedTelemetry(
  ch?: ChallengeSnapshot | null,
): AdvancedFingerprintTelemetry | null {
  const a = ch?.advanced;
  if (!a) return null;
  return {
    challenged: Boolean(a.challenged),
    outcome: asChallengeOutcome(a.outcome as ChallengeOutcome | string | null),
    score: a.score ?? null,
    fail_threshold: a.failThreshold ?? null,
    review_threshold: a.reviewThreshold ?? null,
    ua_family: a.uaFamily ?? null,
    ja4_looks_valid: a.ja4LooksValid ?? null,
    ja3_looks_valid: a.ja3LooksValid ?? null,
    ua_tls_consistency: a.uaTlsConsistency ?? null,
    session_key: a.sessionKey ?? null,
    raw: a.raw ?? null,
  };
}

// ------------------------------------------------------------------
// Risk من السياق
// ------------------------------------------------------------------

export function collectRiskSignals(ctx: CollectorContext): RiskSignals {
  const ip = ctx.ipReputation;
  const rateLevel = deriveRateLevel(ctx.rateLimit);
  const prior = derivePriorHistory(ctx.banHistory);
  const fpSus = deriveSuspiciousFingerprint(ctx.fingerprint);

  // AI: صريح أو من simulation override
  let aiScore: number | null =
    ctx.aiAnomalyScore === undefined ? null : ctx.aiAnomalyScore;
  if (
    (aiScore === null || aiScore === undefined) &&
    ctx.simulation?.active &&
    typeof ctx.simulation.aiScoreOverride === 'number'
  ) {
    aiScore = clamp01(ctx.simulation.aiScoreOverride);
  }

  // allowlist يصفّر سوء التاريخ/IP في الـ risk (القرار الأمني لسه في ban.manager)
  const allowlisted = ctx.banHistory?.allowlisted === true;

  return buildRiskSignals({
    badIp: allowlisted ? false : Boolean(ip?.badIp),
    networkRiskScore: allowlisted ? 0 : ip?.networkRiskScore ?? null,
    badIpScore: allowlisted ? 0 : ip?.networkRiskScore ?? null,
    rateLevel,
    aiAnomalyScore: aiScore,
    suspiciousFingerprint: fpSus.suspiciousFingerprint,
    suspiciousFingerprintScore: fpSus.suspiciousFingerprintScore,
    priorHistory: allowlisted ? false : prior.priorHistory,
    priorHistoryScore: allowlisted ? 0 : prior.priorHistoryScore,
  });
}

// ------------------------------------------------------------------
// extra غني للـ AI (تعلّم أقوى)
// ------------------------------------------------------------------

function buildExtra(ctx: CollectorContext): Record<string, unknown> {
  const extra: Record<string, unknown> = {
    ...(ctx.extra || {}),
  };

  if (ctx.intake) {
    extra.intake = intakeForAi(ctx.intake);
  }

  if (ctx.simulation?.active) {
    extra.simulation = {
      active: true,
      runId: ctx.simulation.runId ?? null,
      persona: ctx.simulation.persona ?? null,
      jsDirective: ctx.simulation.jsDirective ?? null,
      countryHint: ctx.simulation.countryHint ?? null,
      // لا نرسل توكنات
    };
  }

  if (ctx.routeDecision) {
    extra.route = {
      route: ctx.routeDecision.route,
      reason: ctx.routeDecision.reason,
      band: ctx.routeDecision.band,
      normalizedScore: ctx.routeDecision.normalizedScore,
    };
  }

  if (ctx.riskResult) {
    extra.risk = {
      score: ctx.riskResult.score,
      aiUnavailable: ctx.riskResult.aiUnavailable,
      components: ctx.riskResult.components.map((c) => ({
        signal: c.signal,
        contribution: c.contribution,
        ratio: c.ratio,
      })),
    };
  }

  if (ctx.banHistory) {
    extra.ban_history = {
      isBlacklisted: ctx.banHistory.isBlacklisted ?? false,
      isBanned: ctx.banHistory.isBanned ?? false,
      banStatus: ctx.banHistory.banStatus ?? null,
      priorFailures: ctx.banHistory.priorFailures ?? null,
      reputationScore: ctx.banHistory.reputationScore ?? null,
      knownBotnet: ctx.banHistory.knownBotnet ?? false,
      allowlisted: ctx.banHistory.allowlisted ?? false,
    };
  }

  if (ctx.server) {
    extra.server = {
      load: ctx.server.load ?? null,
      load_hint: ctx.server.hint ?? null,
      origin_latency_ms: ctx.server.originLatencyMs ?? null,
    };
  }

  if (ctx.host) extra.host = ctx.host;

  // تلميحات اتساق Edge × JS (مهم للتعلّم)
  const ja4Edge = ctx.fingerprint?.ja4 ?? null;
  const ja3Edge = ctx.fingerprint?.ja3 ?? null;
  extra.signal_consistency = {
    has_edge_ja4: Boolean(ja4Edge),
    has_edge_ja3: Boolean(ja3Edge),
    has_device_fp: Boolean(ctx.fingerprint?.deviceFingerprint),
    clearance_valid: ctx.clearance?.valid ?? false,
    tls_bucket: ctx.intake?.tlsBucket ?? null,
    lane: ctx.intake?.lane ?? null,
  };

  return extra;
}

// ------------------------------------------------------------------
// بناء AI input
// ------------------------------------------------------------------

export function collectAiBuild(
  ctx: CollectorContext,
  phase: AnalysisPhase,
): BuildAnalyzeInput {
  const fp = ctx.fingerprint;
  const riskScore =
    ctx.riskResult?.score ??
    (typeof ctx.gatewayOutcome?.gateway_risk_score === 'number'
      ? ctx.gatewayOutcome.gateway_risk_score
      : null);

  const suspicion =
    ctx.routeDecision?.band ||
    ctx.intake?.priority ||
    ctx.routeDecision?.reason ||
    null;

  return {
    phase,
    orgId: ctx.orgId,
    requestId: ctx.requestId,
    sessionId: ctx.sessionId ?? null,
    ip: ctx.ip,
    path: ctx.path || '/',
    method: ctx.method || 'GET',
    userAgent: ctx.userAgent ?? null,
    referer: ctx.referer ?? null,
    contentLength: ctx.contentLength ?? null,
    ja4: fp?.ja4 ?? null,
    ja3: fp?.ja3 ?? null,
    deviceFp: fp?.deviceFingerprint ?? null,
    riskScoreSoFar: riskScore,
    suspicionLevel: suspicion != null ? String(suspicion) : null,
    fingerprintAuth: collectFingerprintAuth(fp),
    ipReputation: collectIpReputationPayload(ctx.ipReputation),
    rateLimit: collectRateLimitPayload(ctx.rateLimit),
    jsChallenge: collectJsTelemetry(ctx.challenges),
    advancedFingerprint: collectAdvancedTelemetry(ctx.challenges),
    clearance: collectClearancePayload(ctx.clearance),
    previousAi: ctx.previousAi ?? null,
    futureActionApplied: ctx.futureActionApplied ?? null,
    gatewayOutcome:
      phase === 'post_decision'
        ? ctx.gatewayOutcome ??
          buildGatewayOutcomeFromContext(ctx)
        : null,
    extra: buildExtra(ctx),
  };
}

export function buildGatewayOutcomeFromContext(
  ctx: CollectorContext,
): GatewayOutcomePayload {
  return {
    request_id: ctx.requestId,
    ai_anomaly_score:
      typeof ctx.aiAnomalyScore === 'number' ? ctx.aiAnomalyScore : null,
    ai_recommendation: ctx.previousAi?.recommendation ?? null,
    gateway_risk_score: ctx.riskResult?.score ?? null,
    router_decision: ctx.routeDecision?.route ?? null,
    policy_decision: ctx.policyDecision ?? null,
    actual_action: ctx.actualAction ?? null,
    challenge_result: asChallengeOutcome(
      ctx.challenges?.js?.outcome as ChallengeOutcome | string | null,
    ),
    origin_result: (ctx.server?.originResult as GatewayOutcomePayload['origin_result']) ?? null,
    origin_status_code: ctx.server?.originStatusCode ?? null,
    origin_latency_ms: ctx.server?.originLatencyMs ?? null,
    server_load: ctx.server?.load ?? null,
    server_load_hint: ctx.server?.hint ?? null,
    notes: {
      route_reason: ctx.routeDecision?.reason ?? null,
      intake_priority: ctx.intake?.priority ?? null,
      simulation_run_id: ctx.simulation?.runId ?? null,
    },
  };
}

// ------------------------------------------------------------------
// التجميع الكامل
// ------------------------------------------------------------------

export function collectAllSignals(
  ctx: CollectorContext,
  phase: AnalysisPhase = 'pre_decision',
): CollectedSignals {
  const riskSignals = collectRiskSignals(ctx);
  const aiBuild = collectAiBuild(ctx, phase);
  const analyzeBody = buildAnalyzeRequest(aiBuild);

  const rateLevel = deriveRateLevel(ctx.rateLimit);
  const prior = derivePriorHistory(ctx.banHistory);

  const summary: CollectedSummary = {
    ipKind: ctx.ipReputation?.kind ?? null,
    badIp: ctx.ipReputation?.badIp ?? false,
    networkRisk: ctx.ipReputation?.networkRiskScore ?? null,
    rateLevel,
    clearanceValid: ctx.clearance?.valid ?? null,
    fingerprintSuspicious: ctx.fingerprint?.suspicious ?? null,
    intakePriority: ctx.intake?.priority ?? null,
    intakeLane: ctx.intake?.lane ?? null,
    aiScoreInjected:
      ctx.aiAnomalyScore ??
      (ctx.simulation?.active ? ctx.simulation.aiScoreOverride ?? null : null),
    priorHistory: prior.priorHistory,
    path: ctx.path,
    method: ctx.method,
  };

  return {
    riskSignals,
    aiBuild,
    analyzeBody,
    summary,
    meta: {
      orgId: ctx.orgId,
      requestId: ctx.requestId,
      phase,
      hasIpRep: Boolean(ctx.ipReputation),
      hasFingerprint: Boolean(
        ctx.fingerprint?.ja4 ||
          ctx.fingerprint?.ja3 ||
          ctx.fingerprint?.deviceFingerprint,
      ),
      hasRate: Boolean(ctx.rateLimit),
      hasClearance: Boolean(ctx.clearance?.present),
      hasJsTelemetry: Boolean(ctx.challenges?.js),
      hasAdvancedTelemetry: Boolean(ctx.challenges?.advanced),
      isSimulation: Boolean(ctx.simulation?.active),
      collectedAt: new Date().toISOString(),
    },
  };
}

/** Phase 1 — قبل القرار (غالبًا من غير js/advanced outcome) */
export function collectForPreDecision(ctx: CollectorContext): CollectedSignals {
  return collectAllSignals(ctx, 'pre_decision');
}

/**
 * Phase 2 — بعد التنفيذ
 * يفضّل تمرير riskResult + route + actualAction + challenges مكتملة + gatewayOutcome
 */
export function collectForPostDecision(
  ctx: CollectorContext,
): CollectedSignals {
  const withOutcome: CollectorContext = {
    ...ctx,
    gatewayOutcome: ctx.gatewayOutcome ?? buildGatewayOutcomeFromContext(ctx),
  };
  return collectAllSignals(withOutcome, 'post_decision');
}

/**
 * دمج جزئي: حدّث سياق موجود بمخرجات جديدة (AI score، risk، route…)
 */
export function mergeCollectorContext(
  base: CollectorContext,
  patch: Partial<CollectorContext>,
): CollectorContext {
  return {
    ...base,
    ...patch,
    fingerprint: patch.fingerprint
      ? { ...base.fingerprint, ...patch.fingerprint }
      : base.fingerprint,
    rateLimit: patch.rateLimit
      ? { ...base.rateLimit, ...patch.rateLimit }
      : base.rateLimit,
    clearance: patch.clearance
      ? { ...base.clearance, ...patch.clearance }
      : base.clearance,
    banHistory: patch.banHistory
      ? { ...base.banHistory, ...patch.banHistory }
      : base.banHistory,
    challenges: patch.challenges
      ? {
          js: patch.challenges.js ?? base.challenges?.js,
          advanced: patch.challenges.advanced ?? base.challenges?.advanced,
        }
      : base.challenges,
    simulation: patch.simulation
      ? { ...base.simulation, ...patch.simulation }
      : base.simulation,
    server: patch.server ? { ...base.server, ...patch.server } : base.server,
    extra: { ...(base.extra || {}), ...(patch.extra || {}) },
  };
}

// ------------------------------------------------------------------
// تصدير
// ------------------------------------------------------------------

export default {
  collectAllSignals,
  collectForPreDecision,
  collectForPostDecision,
  collectRiskSignals,
  collectAiBuild,
  collectFingerprintAuth,
  collectIpReputationPayload,
  collectRateLimitPayload,
  collectClearancePayload,
  collectJsTelemetry,
  collectAdvancedTelemetry,
  buildGatewayOutcomeFromContext,
  mergeCollectorContext,
};