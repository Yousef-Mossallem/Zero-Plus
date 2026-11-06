// ======================================================
// ZERO PLUS GATEWAY — Fastify Application (كامل موصول)
// Host → Backend → [Simulation Auth] → Ban → Clearance → [Expired JS]
// → IP-Rep → Rate → Risk → Router → Policy JS flags
// → Advanced / JS / Ban / Forward
// + event-logger + Origin Probe (202) + Challenge Expiry Sweeper
//
// سياسة التحدي:
//   enableJsChallenge / challengeAllVisitors
//
// أحداث تحدي JS (بدون pending):
//   - إصدار التحدي (401 + صفحة السكربت) → مفيش حدث للباك
//   - حل ناجح            → ALLOW
//   - حل مرفوض           → BLOCK فوراً
//   - انتهاء المدة       → BLOCK من الـ Sweeper (تايمر) حتى لو الزائر مرجعش
//
// الـ Sweeper:
//   - كل ~10 ثواني: claimExpiredOpenChallenges (حجز ذري في Redis)
//   - لكل تحدي منتهي: ban policy + حدث BLOCK + مرآة سمعة
//   - لو الباك واقع وقت المعالجة: إعادة محاولة (حد أقصى 3) بدل ما التحدي يضيع
//   - المسار القديم (5b) لسه موجود كاحتياطي، ونفس الحجز يمنع المعالجة مرتين
//
// سرعة / مرونة:
//   - كاش لـ resolvePolicyByHost (TTL قصير + dedupe للطلبات المتزامنة)
//   - stale-if-error: لو الباك وقع، نكمل بآخر سياسة معروفة بدل 502
//   - reputation lookup و IP inspection بالتوازي
//
// التحقق من المحاكاة (Simulation) — بعد معرفة org/server مباشرة:
//   - authenticateSimulation مع الهيدرز + expectedOrganizationId
//     + expectedServerId + expectedDomain
//   - لو فشل التوكن ووُجد أي هيدر X-ZP-Sim-*: نتجاهل كل هيدرات X-ZP-Sim-*
//     (بنشيلها من الطلب كأنها غير موجودة)، فلا نثق بـ AI / JS / Country
//   - لو نجح: toSimulationContext → ctx.simulation
//
// متغيرات بيئة اختيارية:
//   GATEWAY_CHALLENGE_SWEEP_MS      (افتراضي 10000، 0 = إيقاف الـ sweeper)
//   GATEWAY_POLICY_CACHE_TTL_MS     (افتراضي 10000، 0 = إيقاف الكاش)
//   GATEWAY_POLICY_STALE_MS         (افتراضي 300000)
//   GATEWAY_LOG_ADVANCED_ISSUE      (افتراضي true، false = متسجلش حدث إصدار advanced)
// ======================================================

import { randomUUID } from "node:crypto";
import Fastify, {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import cookie from "@fastify/cookie";
import { config } from "./config";
import { getRedis, closeRedis } from "./services/redis.client";
import { probeOrigin } from "./services/origin.probe";
import {
  resolvePolicyByHost,
  lookupReputation,
  type OrgPolicyFromBackend,
  type GatewayServer,
  type PolicyResolveData,
} from "./services/backend.client";
import { calculateRisk, type RiskResult } from "./core/risk.engine";
import {
  decidePolicy,
  type CompanyPolicy,
  type PolicyDecision,
} from "./core/policy.engine";
import {
  routeSuspicion,
  type RouteDecision,
} from "./detection/suspicion-router";
import {
  authenticateFromFastifyRequest,
  applyFingerprintsToSignals,
} from "./detection/fingerprint-authenticator";
import {
  authenticateSimulation,
  toSimulationContext,
  type SimulationAuthResult,
  type SimulationContext,
} from "./detection/sim-auth";
import {
  checkBan,
  applyBanFromDecision,
  applyBan,
} from "./detection/ban.manager";
import {
  checkRateLimit,
  applyRateLimitHeaders,
  type RateLimitResult,
} from "./detection/rate-limiter";
import {
  inspectIpReputation,
  type IpReputationResult,
} from "./detection/ip-reputation";
import {
  verifyClearanceFromRequest,
  setClearanceCookie,
  revokeClearance,
  setJsPassCookie,
  verifyJsPassFromRequest,
  clearJsPassCookie,
} from "./challenge/clearance";
import {
  handleJsChallenge,
  isJsChallengeResponse,
  checkAndConsumeExpiredOpenChallenge,
  claimExpiredOpenChallenges,
  getOpenChallenge,
  markChallengeOpen,
  isJsChallengeHardFailure,
  type JsChallengeResult,
  type ExpiredChallengeItem,
  type OpenChallengeRecord,
} from "./challenge/js-challenge";
import {
  handleAdvancedFingerprintChallenge,
  isAdvancedChallengeResponse,
  type AdvancedChallengeResult,
} from "./challenge/advanced-fingerprint-challenge";
import { logSecurityEvent, flushEventLogger } from "./logging/event-logger";
import { forwardToOrigin } from "./proxy/forwardToOrigin";
import type { RequestContext, Signals } from "./types";

// ======================================================
// Origin Probe
// ======================================================

const runningProbes = new Set<string>();
const MAX_CONCURRENT_PROBES = 2;

const CHALLENGE_FAIL_PREFIX = "zp:chal:fail:";
const CHALLENGE_FAIL_TTL_SEC = 24 * 3600;

function isBlockedOrigin(rawUrl: string): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const { hostname } = new URL(rawUrl);
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host === "::1" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

// ======================================================
// إعدادات التشغيل (بيئة)
// ======================================================

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** كل كام ms الـ sweeper يدوّر على تحديات منتهية (0 = إيقاف) */
const SWEEP_INTERVAL_MS = envNumber("GATEWAY_CHALLENGE_SWEEP_MS", 10_000);
const SWEEP_MIN_INTERVAL_MS = 2_000;
const SWEEP_BATCH = 100;
const SWEEP_MAX_ROUNDS = 5;
const SWEEP_CONCURRENCY = 5;
const SWEEP_MAX_RETRIES = 3;
const SWEEP_RETRY_DELAY_MS = 15_000;
const SWEEP_IPREP_TIMEOUT_MS = 2_500;
const SWEEP_RETRY_MAP_MAX = 5_000;

/** كاش سياسة الـ host (0 = إيقاف) */
const POLICY_CACHE_TTL_MS = envNumber("GATEWAY_POLICY_CACHE_TTL_MS", 10_000);
const POLICY_STALE_MS = envNumber("GATEWAY_POLICY_STALE_MS", 5 * 60_000);
const POLICY_CACHE_MAX = 5_000;

/** تسجيل حدث إصدار تحدي advanced (CHALLENGE). تحدي JS مبيتسجلش وقت الإصدار */
const LOG_ADVANCED_ISSUE_EVENT =
  (process.env.GATEWAY_LOG_ADVANCED_ISSUE ?? "true").toLowerCase() !== "false";

// ======================================================
// Runtime context
// ======================================================

export interface GatewayRuntimeContext extends RequestContext {
  resolved: PolicyResolveData | null;
  server: GatewayServer | null;
  companyPolicy: Partial<CompanyPolicy> | null;
  policyDecision: PolicyDecision | null;
  routeDecision: RouteDecision | null;
  rateLimit: RateLimitResult | null;
  jsChallenge: JsChallengeResult | null;
  advancedChallenge: AdvancedChallengeResult | null;
  ipReputation: IpReputationResult | null;
  policyUsedFallback: boolean;
  backendReachable: boolean;
  finalDecision: string | null;
  challengeFailCount?: number;
  /** سياق المحاكاة المعتمد (بعد نجاح authenticateSimulation) — وإلا null */
  simulation: SimulationContext | null;
  /** true = وصلت هيدرات X-ZP-Sim-* والتوكن فشل، فاتشالت وانتجاهلت */
  simulationRejected: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    ctx: GatewayRuntimeContext;
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function mapBackendPolicyToCompany(p: OrgPolicyFromBackend): CompanyPolicy {
  const challengeScore = clampScore(p.challengeMaxScore ?? 31);
  let temporaryBanScore = clampScore(
    Math.max(challengeScore + 1, p.rateLimitMaxScore ?? 81),
  );
  if (temporaryBanScore <= challengeScore) {
    temporaryBanScore = Math.min(100, challengeScore + 20);
  }
  let permanentBanScore = clampScore(p.permanentBanScore ?? 95);
  if (permanentBanScore < temporaryBanScore) {
    permanentBanScore = Math.min(100, temporaryBanScore + 10);
  }
  return {
    autoBanAfterFails: Math.max(0, Math.floor(p.autoBanAfterFails ?? 2)),
    temporaryBanMinutes: Math.max(1, p.temporaryBanMinutes ?? 120),
    permanentBanScore,
    banOnMaxRequests: Boolean(p.banOnMaxRequests),
    challengeScore,
    temporaryBanScore,
  };
}

function isJsChallengeEnabled(policy: OrgPolicyFromBackend | null): boolean {
  if (!policy) return true;
  return policy.enableJsChallenge !== false;
}

function shouldChallengeAllVisitors(
  policy: OrgPolicyFromBackend | null,
): boolean {
  if (!policy) return false;
  return policy.challengeAllVisitors === true && isJsChallengeEnabled(policy);
}

function advancedBanMinutesFromPolicy(
  policy: OrgPolicyFromBackend | null,
  fallback: number,
): number {
  const n = (policy as { advancedBanMinutes?: number } | null)
    ?.advancedBanMinutes;
  if (typeof n === "number" && n >= 1) return Math.floor(n);
  return fallback;
}

function challengeCtx(
  ctx: GatewayRuntimeContext,
  backendPolicy: OrgPolicyFromBackend | null,
) {
  return {
    organizationId: ctx.signals.orgId,
    ip: ctx.signals.ip,
    host: ctx.signals.host,
    path: ctx.signals.path,
    method: ctx.signals.method,
    userAgent: ctx.signals.userAgent,
    deviceFingerprint: ctx.signals.deviceFingerprint,
    ja4: ctx.signals.ja4,
    ja3: ctx.signals.ja3,
    requestId: ctx.id,
    policy: backendPolicy,
  };
}

// ======================================================
// Simulation (المحاكاة)
// ------------------------------------------------------
// بتتنفذ بعد معرفة org/server مباشرة:
//   - authenticateSimulation(headers + expectedOrganizationId
//     + expectedServerId + expectedDomain)
//   - فشل التوكن + وجود هيدر X-ZP-Sim-* → نشيل كل هيدرات X-ZP-Sim-*
//     من الطلب (كأنها مش موجودة). مفيش ثقة في AI / JS / Country
//   - نجاح → toSimulationContext → ctx.simulation
// ======================================================

const SIM_HEADER_PREFIX = "x-zp-sim-";

/** هل الطلب فيه أي هيدر محاكاة X-ZP-Sim-* */
function hasSimulationHeaders(request: FastifyRequest): boolean {
  for (const name of Object.keys(request.headers)) {
    if (name.toLowerCase().startsWith(SIM_HEADER_PREFIX)) return true;
  }
  return false;
}

/**
 * يشيل كل X-ZP-Sim-* من الطلب (headers + raw.headers)
 * عشان أي مرحلة بعد كده (challenge / fingerprint / forward) متشوفهمش
 */
function stripSimulationHeaders(request: FastifyRequest): number {
  let removed = 0;
  const targets: Array<Record<string, unknown>> = [
    request.headers as Record<string, unknown>,
  ];
  const rawHeaders = request.raw?.headers as
    | Record<string, unknown>
    | undefined;
  if (rawHeaders && rawHeaders !== (request.headers as unknown)) {
    targets.push(rawHeaders);
  }
  for (const bag of targets) {
    for (const name of Object.keys(bag)) {
      if (name.toLowerCase().startsWith(SIM_HEADER_PREFIX)) {
        try {
          delete bag[name];
          removed++;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return removed;
}

async function applySimulation(
  request: FastifyRequest,
  ctx: GatewayRuntimeContext,
): Promise<void> {
  ctx.simulation = null;
  ctx.simulationRejected = false;

  const hadSimHeaders = hasSimulationHeaders(request);

  let auth: SimulationAuthResult | null = null;
  let authError: string | null = null;
  try {
    auth = await authenticateSimulation({
      headers: request.headers as Record<
        string,
        string | string[] | undefined
      >,
      expectedOrganizationId: ctx.signals.orgId,
      expectedServerId: ctx.server?.id ?? "",
      expectedDomain: ctx.server?.domain ?? ctx.signals.host,
    });
  } catch (err) {
    authError = (err as Error)?.message ?? "simulation_auth_error";
  }

  if (auth && auth.ok) {
    const sim = toSimulationContext(auth);
    if (sim) {
      ctx.simulation = sim;
      request.log.info(
        { host: ctx.signals.host, orgId: ctx.signals.orgId },
        "simulation authenticated",
      );
      return;
    }
    authError = "simulation_context_empty";
  }

  // فشل التوكن (أو مفيش توكن أصلاً): لو الطلب جاي بهيدرات محاكاة → نتجاهلها كلها
  if (hadSimHeaders) {
    const removed = stripSimulationHeaders(request);
    ctx.simulationRejected = true;
    request.log.warn(
      {
        host: ctx.signals.host,
        orgId: ctx.signals.orgId,
        ip: ctx.signals.ip,
        removedHeaders: removed,
        reason:
          authError ??
          (auth as { reason?: string } | null)?.reason ??
          "simulation_auth_failed",
      },
      "simulation auth failed — X-ZP-Sim-* headers ignored",
    );
  }
}

// ======================================================
// كاش سياسة الـ host (سرعة + مرونة)
//   - TTL قصير لتقليل ضرب الباك على كل طلب
//   - dedupe: 100 طلب متزامن على نفس الـ host = طلب واحد للباك
//   - stale-if-error: لو الباك وقع نكمل بآخر سياسة معروفة (حد أقصى POLICY_STALE_MS)
//   - أخطاء 4xx (host مش موجود/اتشال) = بنمسح الكاش ومبنستخدمش stale
// ======================================================

interface PolicyCacheEntry {
  data: PolicyResolveData;
  at: number;
}

const policyCache = new Map<string, PolicyCacheEntry>();
const policyInflight = new Map<string, Promise<PolicyResolveData>>();

function trimPolicyCache(): void {
  while (policyCache.size > POLICY_CACHE_MAX) {
    const first = policyCache.keys().next();
    if (first.done) break;
    policyCache.delete(first.value);
  }
}

async function resolvePolicyCached(
  host: string,
): Promise<{ data: PolicyResolveData; stale: boolean }> {
  const now = Date.now();
  const hit = policyCache.get(host);

  if (hit && POLICY_CACHE_TTL_MS > 0 && now - hit.at < POLICY_CACHE_TTL_MS) {
    return { data: hit.data, stale: false };
  }

  let inflight = policyInflight.get(host);
  if (!inflight) {
    inflight = resolvePolicyByHost(host)
      .then((data) => {
        if (POLICY_CACHE_TTL_MS > 0) {
          policyCache.delete(host); // يرجّعه آخر الترتيب
          policyCache.set(host, { data, at: Date.now() });
          trimPolicyCache();
        }
        return data;
      })
      .finally(() => {
        policyInflight.delete(host);
      });
    policyInflight.set(host, inflight);
  }

  try {
    return { data: await inflight, stale: false };
  } catch (err) {
    const status = (err as { status?: number }).status;
    // host مش موجود / ممنوع → متستخدمش stale
    if (typeof status === "number" && status >= 400 && status < 500) {
      policyCache.delete(host);
      throw err;
    }
    if (hit && now - hit.at < POLICY_STALE_MS) {
      return { data: hit.data, stale: true };
    }
    throw err;
  }
}

// ======================================================
// Challenge fail counter + ban
// ======================================================

async function bumpChallengeFailCount(
  organizationId: string,
  ip: string,
): Promise<number> {
  try {
    const r = getRedis();
    const key = `${CHALLENGE_FAIL_PREFIX}${organizationId}:${ip}`;
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, CHALLENGE_FAIL_TTL_SEC);
    return n;
  } catch {
    return 1;
  }
}

async function resetChallengeFailCount(
  organizationId: string,
  ip: string,
): Promise<void> {
  try {
    await getRedis().del(`${CHALLENGE_FAIL_PREFIX}${organizationId}:${ip}`);
  } catch {
    /* ignore */
  }
}

async function maybeBanAfterChallengeFail(params: {
  monitorOnly: boolean;
  organizationId: string;
  ip: string;
  deviceFingerprint: string | null;
  companyPolicy: Partial<CompanyPolicy> | null;
  backendPolicy: OrgPolicyFromBackend | null;
  kind: "js" | "advanced";
  reason: string;
}): Promise<{ failCount: number; banned: boolean; banMinutes: number }> {
  const failCount = await bumpChallengeFailCount(
    params.organizationId,
    params.ip,
  );
  const threshold = Math.max(
    0,
    Math.floor(params.companyPolicy?.autoBanAfterFails ?? 2),
  );
  const shouldBan =
    !params.monitorOnly && (threshold <= 0 || failCount >= threshold);

  const baseMinutes = Math.max(
    1,
    params.companyPolicy?.temporaryBanMinutes ?? 120,
  );
  const banMinutes =
    params.kind === "advanced"
      ? advancedBanMinutesFromPolicy(params.backendPolicy, baseMinutes)
      : baseMinutes;

  if (shouldBan) {
    await applyBan({
      organizationId: params.organizationId,
      ip: params.ip,
      deviceFingerprint: params.deviceFingerprint,
      banMinutes,
      reason: params.reason,
      source: "gateway",
    });
  }

  return { failCount, banned: shouldBan, banMinutes };
}

// ======================================================
// Events
// ======================================================

/** حقول Geo/ASN/ipType من نتيجة IP reputation (مشتركة بين emitEvent والـ sweeper) */
function ipRepFields(ipRep: IpReputationResult | null) {
  return {
    ipReputation: ipRep,
    ipType: ipRep?.kind ?? null,
    countryCode: ipRep?.geo.countryCode ?? null,
    countryName: ipRep?.geo.countryName ?? null,
    region: ipRep?.geo.region ?? null,
    city: ipRep?.geo.city ?? null,
    latitude: ipRep?.geo.latitude ?? null,
    longitude: ipRep?.geo.longitude ?? null,
    timezone: ipRep?.geo.timezone ?? null,
    asn: ipRep?.asn.asn ?? null,
    asOrg: ipRep?.asn.asOrg ?? ipRep?.asn.network ?? null,
    confidence: ipRep?.confidence ?? null,
  };
}

function emitEvent(
  ctx: GatewayRuntimeContext,
  decision: string,
  extra?: { referer?: string | null },
): void {
  if (!ctx.server?.id || !ctx.signals.orgId) return;
  if (ctx.signals.orgId === "unknown") return;

  ctx.finalDecision = decision;

  const ipRep = ctx.ipReputation;
  const risk = ctx.riskResult as RiskResult | null;
  const jsHard =
    ctx.jsChallenge != null && isJsChallengeHardFailure(ctx.jsChallenge);

  logSecurityEvent({
    organizationId: ctx.signals.orgId,
    serverId: ctx.server.id,
    ipAddress: ctx.signals.ip,
    path: ctx.signals.path,
    method: ctx.signals.method,
    requestId: ctx.id,
    userAgent: ctx.signals.userAgent,
    referer: extra?.referer ?? null,
    riskScore: risk?.score ?? 0,
    decision,
    processingTimeMs: Date.now() - ctx.startTime,
    riskResult: risk,
    routeDecision: ctx.routeDecision,
    policyDecision: ctx.policyDecision,
    rateLimit: ctx.rateLimit,
    ja3: ctx.signals.ja3,
    ja4: ctx.signals.ja4,
    deviceFingerprint: ctx.signals.deviceFingerprint,
    jsChallenge: ctx.jsChallenge,
    advancedChallenge: ctx.advancedChallenge,
    ...ipRepFields(ipRep),
    anomalyScore:
      ctx.jsChallenge?.telemetry.localSuspicionScore ??
      ctx.advancedChallenge?.telemetry.localSuspicionScore ??
      ipRep?.networkRiskScore ??
      null,
    mirrorReputation:
      decision === "BLOCK" ||
      jsHard ||
      Boolean(ctx.advancedChallenge && !ctx.advancedChallenge.passed),
    reasonDetails: {
      challengeFailCount: ctx.challengeFailCount ?? null,
      jsPhase: ctx.jsChallenge?.phase ?? null,
      jsExpired: ctx.jsChallenge?.telemetry.expired === true,
      simulation: ctx.simulation != null,
      simulationRejected: ctx.simulationRejected,
    },
  });
}

/** إصدار تحدي advanced بيتسجل كـ CHALLENGE (ممكن يتعطل بـ GATEWAY_LOG_ADVANCED_ISSUE=false) */
function emitAdvancedIssueEvent(
  ctx: GatewayRuntimeContext,
  referer: string | null,
): void {
  if (LOG_ADVANCED_ISSUE_EVENT) {
    emitEvent(ctx, "CHALLENGE", { referer });
  } else {
    ctx.finalDecision = "CHALLENGE";
  }
}

// ======================================================
// Challenge Expiry Sweeper
// ------------------------------------------------------
// بيجيب التحديات اللي انتهت مدتها من غير حل ويسجلها كفشل نهائي:
//   BLOCK + مرآة سمعة + حساب الـ ban — حتى لو الزائر مرجعش.
// ======================================================

const sweeperStats = {
  enabled: false,
  running: false,
  lastRunAt: null as number | null,
  lastClaimed: 0,
  totalExpired: 0,
  totalRequeued: 0,
  totalDropped: 0,
};

/** عدد محاولات إعادة المعالجة لكل challengeId (في الذاكرة) */
const sweepRetries = new Map<string, number>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * لو معالجة التحدي المنتهي فشلت (باك واقع مثلاً):
 * نرجّعه لـ Redis بوقت انتهاء قريب عشان الدورة الجاية تحاول تاني.
 * حد أقصى SWEEP_MAX_RETRIES محاولات، ومنكتبش فوق تحدي جديد لنفس org:ip.
 */
async function requeueOrDropExpired(
  rec: OpenChallengeRecord,
  err: unknown,
  log: FastifyInstance["log"],
): Promise<void> {
  const status = (err as { status?: number }).status;
  const permanent = typeof status === "number" && status >= 400 && status < 500;
  const attempts = (sweepRetries.get(rec.challengeId) ?? 0) + 1;

  if (permanent || attempts > SWEEP_MAX_RETRIES) {
    sweepRetries.delete(rec.challengeId);
    sweeperStats.totalDropped++;
    log.warn(
      {
        challengeId: rec.challengeId,
        host: rec.host,
        attempts,
        permanent,
        err: (err as Error)?.message,
      },
      "expired challenge dropped",
    );
    return;
  }

  try {
    // تحدي جديد اتصدر لنفس الزائر → مفيش داعي نرجّع القديم
    const current = await getOpenChallenge(rec.organizationId, rec.ip);
    if (current) {
      sweepRetries.delete(rec.challengeId);
      return;
    }
    await markChallengeOpen({
      ...rec,
      expAt: Date.now() + SWEEP_RETRY_DELAY_MS,
    });
    sweepRetries.set(rec.challengeId, attempts);
    if (sweepRetries.size > SWEEP_RETRY_MAP_MAX) {
      const first = sweepRetries.keys().next();
      if (!first.done) sweepRetries.delete(first.value);
    }
    sweeperStats.totalRequeued++;
  } catch {
    sweeperStats.totalDropped++;
  }
}

async function processExpiredChallenge(
  item: ExpiredChallengeItem,
  log: FastifyInstance["log"],
): Promise<void> {
  const { rec, result } = item;

  // 1) سياسة الـ host (من الكاش غالباً)
  let resolved: PolicyResolveData;
  try {
    resolved = (await resolvePolicyCached(rec.host)).data;
  } catch (err) {
    await requeueOrDropExpired(rec, err, log);
    return;
  }

  const policy = resolved.policy;
  // تحدي JS اتعطل بعد الإصدار → مفيش فشل نسجله
  if (!isJsChallengeEnabled(policy)) {
    sweepRetries.delete(rec.challengeId);
    return;
  }

  const company = mapBackendPolicyToCompany(policy);
  const monitorOnly = resolved.server.mode === "MONITOR_ONLY";

  // 2) عداد الفشل + الحظر (لو فشل Redis نكمل ونسجل الحدث برضه)
  let failCount: number | null = null;
  let banned = false;
  let banMinutes: number | null = null;
  if (!monitorOnly) {
    try {
      const b = await maybeBanAfterChallengeFail({
        monitorOnly,
        organizationId: rec.organizationId,
        ip: rec.ip,
        deviceFingerprint: rec.deviceFingerprint ?? null,
        companyPolicy: company,
        backendPolicy: policy,
        kind: "js",
        reason: "js_challenge_timeout",
      });
      failCount = b.failCount;
      banned = b.banned;
      banMinutes = b.banMinutes;
    } catch (err) {
      log.warn(
        { err: (err as Error).message, ip: rec.ip },
        "expiry ban step failed",
      );
    }
  }

  // 3) Geo/ASN/ipType (خلفية، بمهلة قصيرة — مش بتبطّأ أي طلب)
  let ipRep: IpReputationResult | null = null;
  try {
    ipRep = await withTimeout(
      inspectIpReputation({
        ip: rec.ip,
        organizationId: rec.organizationId,
        deviceFingerprint: rec.deviceFingerprint ?? null,
        ja3: rec.ja3 ?? null,
        ja4: rec.ja4 ?? null,
        headers: {},
        useBackend: false,
      }),
      SWEEP_IPREP_TIMEOUT_MS,
    );
  } catch {
    ipRep = null;
  }

  // 4) الحدث النهائي (مفيش صف pending قديم، فده الحدث الوحيد للتحدي ده)
  logSecurityEvent({
    organizationId: rec.organizationId,
    serverId: resolved.server.id,
    ipAddress: rec.ip,
    path: rec.path,
    method: "GET",
    requestId: randomUUID(),
    userAgent: rec.userAgent ?? null,
    referer: null,
    riskScore: clampScore(result.telemetry.localSuspicionScore * 100),
    decision: monitorOnly ? "MONITOR" : "BLOCK",
    processingTimeMs: 0,
    ja3: rec.ja3 ?? null,
    ja4: rec.ja4 ?? null,
    deviceFingerprint: rec.deviceFingerprint ?? null,
    jsChallenge: result,
    ...ipRepFields(ipRep),
    anomalyScore: result.telemetry.localSuspicionScore,
    mirrorReputation: !monitorOnly,
    reasonDetails: {
      source: "expiry_sweeper",
      challengeId: rec.challengeId,
      challengeIssuedAt: rec.issuedAt,
      challengeExpAt: rec.expAt,
      challengeTtlSec: rec.ttlSec,
      challengeFailCount: failCount,
      banned,
      banMinutes,
      jsPhase: "expired",
      jsExpired: true,
    },
  });

  sweepRetries.delete(rec.challengeId);
  sweeperStats.totalExpired++;
  log.info(
    {
      challengeId: rec.challengeId,
      host: rec.host,
      ip: rec.ip,
      failCount,
      banned,
    },
    "js challenge expired (sweeper)",
  );
}

async function runChallengeSweep(log: FastifyInstance["log"]): Promise<void> {
  if (sweeperStats.running) return;
  sweeperStats.running = true;
  try {
    let claimedTotal = 0;
    for (let round = 0; round < SWEEP_MAX_ROUNDS; round++) {
      const items = await claimExpiredOpenChallenges(SWEEP_BATCH);
      claimedTotal += items.length;
      for (let i = 0; i < items.length; i += SWEEP_CONCURRENCY) {
        const slice = items.slice(i, i + SWEEP_CONCURRENCY);
        await Promise.allSettled(
          slice.map((it) => processExpiredChallenge(it, log)),
        );
      }
      // لو الدفعة مكتملة ممكن يكون فيه أكتر → كمّل فوراً
      if (items.length < SWEEP_BATCH) break;
    }
    sweeperStats.lastClaimed = claimedTotal;
    sweeperStats.lastRunAt = Date.now();
  } catch (err) {
    log.error({ err: (err as Error).message }, "challenge sweep failed");
  } finally {
    sweeperStats.running = false;
  }
}

// ======================================================
// buildApp
// ======================================================

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logging.level,
      transport: config.server.isDev
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss",
              ignore: "pid,hostname",
            },
          }
        : undefined,
    },
    bodyLimit: 1024 * 1024 * 2,
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    "*",
    { parseAs: "buffer" },
    (request, body, done) => {
      (request as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
      done(null, body);
    },
  );

  await app.register(cookie, {
    secret: config.clearance.secret,
    hook: "onRequest",
  });

  app.decorateRequest("ctx", null as unknown as GatewayRuntimeContext);

  // —— Sweeper lifecycle
  app.addHook("onReady", async () => {
    if (SWEEP_INTERVAL_MS <= 0) {
      app.log.info("challenge expiry sweeper disabled");
      return;
    }
    const every = Math.max(SWEEP_MIN_INTERVAL_MS, SWEEP_INTERVAL_MS);
    sweeperStats.enabled = true;
    sweepTimer = setInterval(() => {
      void runChallengeSweep(app.log);
    }, every);
    sweepTimer.unref();
    app.log.info({ everyMs: every }, "challenge expiry sweeper started");
  });

  app.addHook("onClose", async () => {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
    sweeperStats.enabled = false;
  });

  app.addHook("onRequest", async (request, _reply) => {
    const pathname = request.url.split("?")[0] ?? "/";
    if (
      pathname === "/internal" ||
      pathname.startsWith("/internal/") ||
      pathname === "/health" ||
      pathname === "/ready" ||
      pathname === "/debug/fingerprint"
    ) {
      return;
    }

    const host = (request.headers.host ?? "").split(":")[0]!.toLowerCase();

    let signals: Signals = {
      ip: extractRealIp(request),
      ja4: null,
      ja3: null,
      deviceFingerprint: null,
      path: pathname,
      method: request.method,
      orgId: "unknown",
      userAgent: (request.headers["user-agent"] as string) || null,
      requestSize: Number(request.headers["content-length"]) || 0,
      timestamp: Date.now(),
      hasClearance: false,
      clearanceToken: null,
      host,
    };

    const fp = authenticateFromFastifyRequest(request);
    signals = applyFingerprintsToSignals(signals, fp);

    const clearanceCookie = request.cookies[config.clearance.cookieName];
    if (clearanceCookie) {
      signals.hasClearance = true;
      signals.clearanceToken = clearanceCookie;
    }

    request.ctx = {
      id: request.id,
      signals,
      reputation: null,
      riskResult: null,
      decision: null,
      startTime: Date.now(),
      resolved: null,
      server: null,
      companyPolicy: null,
      policyDecision: null,
      routeDecision: null,
      rateLimit: null,
      jsChallenge: null,
      advancedChallenge: null,
      ipReputation: null,
      policyUsedFallback: true,
      backendReachable: false,
      finalDecision: null,
      challengeFailCount: 0,
      simulation: null,
      simulationRejected: false,
    };
  });

  app.addHook("onResponse", async (request, reply) => {
    const ctx = request.ctx as GatewayRuntimeContext | null;
    if (!ctx?.startTime) return;
    const ms = Date.now() - ctx.startTime;
    if (config.logging.logAllRequests) {
      request.log.info({
        requestId: ctx.id,
        host: ctx.signals.host,
        orgId: ctx.signals.orgId,
        path: ctx.signals.path,
        method: ctx.signals.method,
        risk: (ctx.riskResult as RiskResult | null)?.score,
        route: ctx.routeDecision?.route,
        action: ctx.policyDecision?.action,
        decision: ctx.finalDecision,
        rl: ctx.rateLimit?.level,
        ipKind: ctx.ipReputation?.kind,
        js: ctx.jsChallenge?.phase,
        adv: ctx.advancedChallenge?.phase,
        challengeFails: ctx.challengeFailCount,
        policyStale: ctx.policyUsedFallback,
        sim: ctx.simulation != null,
        simRejected: ctx.simulationRejected,
        statusCode: reply.statusCode,
        ms,
      });
    }
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as Error & { validation?: boolean; statusCode?: number };
    request.log.error({ err, requestId: request.id, url: request.url });
    if (err.validation) {
      return reply.status(400).send({
        success: false,
        error: "Validation Error",
        message: err.message,
      });
    }
    const statusCode = err.statusCode || 500;
    return reply.status(statusCode).send({
      success: false,
      error: statusCode >= 500 ? "Internal Server Error" : err.message,
      requestId: request.id,
    });
  });

  app.get("/health", async (_req, reply) => {
    try {
      await getRedis().ping();
      return {
        status: "ok",
        service: "zero-plus-gateway",
        redis: "connected",
        uptime: process.uptime(),
        probesRunning: runningProbes.size,
        challengeSweeper: { ...sweeperStats },
        policyCacheSize: policyCache.size,
      };
    } catch (e) {
      reply.status(503);
      return {
        status: "degraded",
        redis: "disconnected",
        error: (e as Error).message,
      };
    }
  });

  app.get("/ready", async (_req, reply) => {
    try {
      await getRedis().ping();
      return { ready: true };
    } catch {
      reply.status(503);
      return { ready: false };
    }
  });

  if (config.server.isDev) {
    app.get("/debug/fingerprint", async (request, reply) => {
      return reply.send({
        success: true,
        data: authenticateFromFastifyRequest(request),
      });
    });
  }

  // ======================================================
  // Internal
  // ======================================================
  await app.register(
    async (internal) => {
      internal.addHook("onRequest", async (request, reply) => {
        const key = request.headers["x-gateway-key"] as string | undefined;
        if (!key) {
          return reply
            .status(401)
            .send({ success: false, message: "Missing X-Gateway-Key header" });
        }
        if (key !== config.backend.internalSecret) {
          return reply
            .status(403)
            .send({ success: false, message: "Invalid Gateway key" });
        }
      });

      internal.post("/probe", async (request, reply) => {
        const body = parseJsonBody<{
          url: string;
          orgId: string;
          serverId?: string;
          timeoutMs?: number;
          mode?: "light" | "full";
        }>(request.body);

        if (!body?.url || !body?.orgId) {
          return reply.status(400).send({
            success: false,
            message: "url and orgId are required",
          });
        }

        try {
          if (isBlockedOrigin(body.url)) {
            return reply.status(400).send({
              success: false,
              message: "Origin address not allowed",
            });
          }
        } catch {
          return reply.status(400).send({
            success: false,
            message: "Invalid url",
          });
        }

        const key = body.serverId ?? body.url;
        if (runningProbes.has(key)) {
          return reply.status(409).send({
            success: false,
            message: "Probe already running",
          });
        }
        if (runningProbes.size >= MAX_CONCURRENT_PROBES) {
          return reply.status(429).send({
            success: false,
            message: "Too many concurrent probes",
          });
        }

        runningProbes.add(key);
        probeOrigin({
          url: body.url,
          orgId: body.orgId,
          serverId: body.serverId,
          timeoutMs: body.timeoutMs,
        })
          .then((result) => {
            request.log.info(
              {
                serverId: body.serverId,
                sustainedRps: result.summary.estimatedMaxRps,
                safeRps: result.summary.safeRps,
              },
              "Origin probe completed",
            );
          })
          .catch((err) => {
            request.log.error({ err, key }, "Origin probe failed");
          })
          .finally(() => {
            runningProbes.delete(key);
          });

        return reply.status(202).send({
          success: true,
          message: "Probe started",
          data: {
            serverId: body.serverId ?? null,
            orgId: body.orgId,
            acceptedAt: new Date().toISOString(),
          },
        });
      });

      internal.get("/status", async () => ({
        success: true,
        data: {
          service: "zero-plus-gateway",
          uptime: process.uptime(),
          probesRunning: runningProbes.size,
          maxConcurrentProbes: MAX_CONCURRENT_PROBES,
          challengeSweeper: { ...sweeperStats },
          policyCacheSize: policyCache.size,
        },
      }));
    },
    { prefix: "/internal" },
  );

  // ======================================================
  // Visitor pipeline
  // ======================================================
  app.all("/*", async (request, reply) => {
    const ctx = request.ctx as GatewayRuntimeContext;
    const host = ctx.signals.host;
    const referer = (request.headers.referer as string) || null;

    if (!host) {
      return reply.status(400).send({
        success: false,
        error: "Missing Host",
        requestId: ctx.id,
      });
    }

    let companyPolicy: Partial<CompanyPolicy> | null = null;
    let backendPolicy: OrgPolicyFromBackend | null = null;

    // 1) Backend resolve (كاش + dedupe + stale-if-error)
    try {
      const { data: resolved, stale } = await resolvePolicyCached(host);
      ctx.resolved = resolved;
      ctx.backendReachable = !stale;
      ctx.signals.orgId = resolved.organizationId;
      backendPolicy = resolved.policy;

      ctx.server = {
        id: resolved.server.id,
        domain: resolved.server.domain,
        organizationId: resolved.organizationId,
        originIp: resolved.server.originIp,
        originPort: resolved.server.originPort,
        sslEnabled: true,
        status: resolved.server.status,
        mode: resolved.server.mode,
        dnsVerified: true,
        gatewayReachable: true,
        originReachable: true,
        maxRequestsPerSecond: resolved.server.maxRequestsPerSecond,
        updatedAt: new Date().toISOString(),
      };

      companyPolicy = mapBackendPolicyToCompany(resolved.policy);
      ctx.companyPolicy = companyPolicy;
      ctx.policyUsedFallback = stale;

      if (stale) {
        request.log.warn(
          { host },
          "backend unreachable — using stale cached policy",
        );
      }

      if (resolved.server.status === "MAINTENANCE") {
        emitEvent(ctx, "BLOCK", { referer });
        return reply.status(503).send({
          success: false,
          error: "Origin under maintenance",
          requestId: ctx.id,
        });
      }
    } catch (err) {
      request.log.warn({ err, host }, "resolvePolicyByHost failed");
      return reply.status(502).send({
        success: false,
        error: "Unable to resolve protected host",
        host,
        requestId: ctx.id,
      });
    }

    const orgId = ctx.signals.orgId;

    // 1.5) التحقق من المحاكاة — بعد معرفة org/server مباشرة
    //      فشل التوكن + هيدر X-ZP-Sim-* → نتجاهل كل X-ZP-Sim-*
    //      نجاح → ctx.simulation (toSimulationContext)
    await applySimulation(request, ctx);

    const monitorOnly = ctx.server?.mode === "MONITOR_ONLY";
    const jsEnabled = isJsChallengeEnabled(backendPolicy);
    const challengeAll = shouldChallengeAllVisitors(backendPolicy);
    // الزائر عدّى تحدي JS (تحدي الكل) ومستني تقييم Risk/Router/Policy
    const jsPassedStage =
      challengeAll &&
      jsEnabled &&
      verifyJsPassFromRequest(request, {
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
      });

    // —— معالجة فشل تحدي JS (حل مرفوض أو expired من verify)
    const handleJsHardFail = async (js: JsChallengeResult, reason: string) => {
      const banInfo = await maybeBanAfterChallengeFail({
        monitorOnly,
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        companyPolicy,
        backendPolicy,
        kind: "js",
        reason,
      });
      ctx.challengeFailCount = banInfo.failCount;
      request.log.info(
        {
          phase: js.phase,
          failCount: banInfo.failCount,
          banned: banInfo.banned,
          reasons: js.telemetry.failReasons,
        },
        "js challenge hard fail",
      );
      emitEvent(ctx, "BLOCK", { referer });
      return reply.status(403).send({
        success: false,
        error:
          js.phase === "expired" ? "Challenge expired" : "Challenge failed",
        reasons: js.telemetry.failReasons,
        failCount: banInfo.failCount,
        banned: banInfo.banned,
        requestId: ctx.id,
      });
    };

    // 2) POST رد تحدي JS
    if (isJsChallengeResponse(request)) {
      const js = await handleJsChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      );
      ctx.jsChallenge = js;

      if (js.passed) {
        await resetChallengeFailCount(orgId, ctx.signals.ip);
        if (challengeAll && !monitorOnly) {
          // تحدي الكل: نجح JS بس لسه Risk/Router/Policy، فمنمنحش clearance دلوقتي
          setJsPassCookie(reply, {
            organizationId: orgId,
            ip: ctx.signals.ip,
            deviceFingerprint: ctx.signals.deviceFingerprint,
          });
        } else {
          setClearanceCookie(reply, {
            organizationId: orgId,
            ip: ctx.signals.ip,
            deviceFingerprint: ctx.signals.deviceFingerprint,
            policy: backendPolicy,
          });
        }
        emitEvent(ctx, "ALLOW", { referer });
        await forwardToOrigin(request, reply, ctx);
        return reply;
      }

      // رد متأخر بعد ما الـ sweeper سجّل الانتهاء بالفعل → مفيش فشل تاني ولا حدث
      const lateAfterExpiry =
        js.phase === "expired" &&
        js.telemetry.token?.reason === "expired" &&
        js.telemetry.suspicionHints.includes("late_after_expiry_reported");
      if (lateAfterExpiry) {
        ctx.finalDecision = "BLOCK";
        return reply.status(403).send({
          success: false,
          error: "Challenge expired",
          reasons: js.telemetry.failReasons,
          requestId: ctx.id,
        });
      }

      if (isJsChallengeHardFailure(js)) {
        return handleJsHardFail(
          js,
          js.phase === "expired"
            ? "js_challenge_timeout"
            : "js_challenge_failed",
        );
      }

      emitEvent(ctx, "BLOCK", { referer });
      return reply.status(403).send({
        success: false,
        error: "Challenge failed",
        requestId: ctx.id,
      });
    }

    // 3) POST رد advanced
    if (isAdvancedChallengeResponse(request)) {
      const adv = await handleAdvancedFingerprintChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      );
      ctx.advancedChallenge = adv;
      if (adv.responseSent) {
        emitAdvancedIssueEvent(ctx, referer);
        return reply;
      }
      if (adv.passed) {
        await resetChallengeFailCount(orgId, ctx.signals.ip);
        setClearanceCookie(reply, {
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          policy: backendPolicy,
        });
        emitEvent(ctx, "ALLOW", { referer });
        await forwardToOrigin(request, reply, ctx);
        return reply;
      }

      const banInfo = await maybeBanAfterChallengeFail({
        monitorOnly,
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        companyPolicy,
        backendPolicy,
        kind: "advanced",
        reason: "advanced_challenge_failed",
      });
      ctx.challengeFailCount = banInfo.failCount;
      emitEvent(ctx, "BLOCK", { referer });
      return reply.status(403).send({
        success: false,
        error: "Advanced fingerprint check failed",
        codes: adv.telemetry.failCodes,
        failCount: banInfo.failCount,
        banned: banInfo.banned,
        requestId: ctx.id,
      });
    }

    // 4) Ban list
    const ban = await checkBan({
      organizationId: orgId,
      ip: ctx.signals.ip,
      deviceFingerprint: ctx.signals.deviceFingerprint,
    });
    if (ban.banned && !monitorOnly) {
      emitEvent(ctx, "BLOCK", { referer });
      return reply.status(403).send({
        success: false,
        error: "Access Denied",
        reason: "banned",
        matchedBy: ban.matchedBy,
        requestId: ctx.id,
      });
    }

    // 5) Clearance fast path
    if (ctx.signals.hasClearance && ctx.signals.clearanceToken) {
      const cleared = verifyClearanceFromRequest(request, {
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        bindIp: false,
        bindDevice: true,
      });
      if (cleared.valid) {
        emitEvent(ctx, "ALLOW", { referer });
        await forwardToOrigin(request, reply, ctx);
        return reply;
      }
      revokeClearance(reply);
    }

    // 5b) تحدي منتهي من غير حل → فشل (مسار احتياطي بجانب الـ sweeper)
    //     الحجز ذري: لو الـ sweeper سبق، checkAndConsume بترجع null ومفيش معالجة مرتين
    if (!monitorOnly && jsEnabled) {
      const expired = await checkAndConsumeExpiredOpenChallenge(
        orgId,
        ctx.signals.ip,
      );
      if (expired && isJsChallengeHardFailure(expired)) {
        ctx.jsChallenge = expired;
        return handleJsHardFail(expired, "js_challenge_timeout");
      }
    }

    // —— مسار سريع: تحدي كل الزوار (بعد ban/clearance/expired)
    const runSilentJs = async () => {
      if (!jsEnabled) {
        emitEvent(ctx, "ALLOW", { referer });
        await forwardToOrigin(request, reply, ctx);
        return reply;
      }

      // الـ JS اتحل قبل كده (تحدي الكل) → ده التحدي المطلوب، نمنح clearance ونكمل
      if (jsPassedStage) {
        clearJsPassCookie(reply);
        setClearanceCookie(reply, {
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          policy: backendPolicy,
        });
        emitEvent(ctx, "ALLOW", { referer });
        await forwardToOrigin(request, reply, ctx);
        return reply;
      }

      const js = await handleJsChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      );
      ctx.jsChallenge = js;

      if (js.responseSent) {
        // إصدار التحدي: مفيش حدث للباك (مفيش pending).
        // النتيجة النهائية بتتسجل لما التحدي يتحل / يفشل / ينتهي.
        ctx.finalDecision = "CHALLENGE";
        return reply;
      }
      if (js.phase === "disabled" || js.passed) {
        await resetChallengeFailCount(orgId, ctx.signals.ip);
        setClearanceCookie(reply, {
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          policy: backendPolicy,
        });
        emitEvent(ctx, "ALLOW", { referer });
        await forwardToOrigin(request, reply, ctx);
        return reply;
      }
      if (isJsChallengeHardFailure(js)) {
        return handleJsHardFail(
          js,
          js.phase === "expired"
            ? "js_challenge_timeout"
            : "js_challenge_failed",
        );
      }
      emitEvent(ctx, "BLOCK", { referer });
      return reply.status(403).send({
        success: false,
        error: "Challenge failed",
        requestId: ctx.id,
      });
    };

    // rate limit خفيف قبل challengeAll (حماية من الفيضان)
    const rlEarly = await checkRateLimit({
      organizationId: orgId,
      ip: ctx.signals.ip,
      deviceFingerprint: ctx.signals.deviceFingerprint,
      policy: backendPolicy,
    });
    ctx.rateLimit = rlEarly;
    applyRateLimitHeaders(reply, rlEarly);

    if (rlEarly.shouldBanOnHard && !monitorOnly) {
      await applyBan({
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        banMinutes: companyPolicy?.temporaryBanMinutes ?? 120,
        reason: "hard_rate_limit",
        source: "gateway",
      });
      emitEvent(ctx, "BLOCK", { referer });
      return reply.status(403).send({
        success: false,
        error: "Access Denied",
        reason: "hard_rate_limit",
        requestId: ctx.id,
      });
    }
    if (rlEarly.hardExceeded && !monitorOnly) {
      emitEvent(ctx, "RATE_LIMIT", { referer });
      return reply.status(429).send({
        success: false,
        error: "Too Many Requests",
        reason: "hard_rate_limit",
        requestId: ctx.id,
      });
    }

    if (monitorOnly) {
      emitEvent(ctx, "MONITOR", { referer });
      await forwardToOrigin(request, reply, ctx);
      return reply;
    }

    // تحدي الكل: قرار سريع بدون انتظار risk/reputation/ip-api
    // تحدي الكل: JS الأول. لو عدّى (jsPassedStage) نكمل على Risk/Router/Policy
    if (challengeAll && !jsPassedStage) {
      return runSilentJs();
    }

    // 6+7) Backend reputation + IP reputation بالتوازي (مستقلين عن بعض)
    const ipRepPromise: Promise<IpReputationResult | null> =
      inspectIpReputation({
        ip: ctx.signals.ip,
        organizationId: orgId,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        ja3: ctx.signals.ja3,
        ja4: ctx.signals.ja4,
        headers: request.headers as Record<
          string,
          string | string[] | undefined
        >,
        useBackend: false,
      }).catch((err) => {
        request.log.debug({ err }, "ip reputation skipped");
        return null;
      });

    let priorHistory = false;
    let badIpFromRep = false;
    let failedChallengesFromRep = 0;
    try {
      const rep = await lookupReputation({
        organizationId: orgId,
        ipAddress: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint ?? undefined,
        ja3Fingerprint: ctx.signals.ja3 ?? undefined,
        ja4Fingerprint: ctx.signals.ja4 ?? undefined,
      });
      if (rep.effective.isCurrentlyBanned && !monitorOnly) {
        await applyBan({
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          permanent: rep.effective.banStatus === "PERMANENT",
          banMinutes: rep.effective.minutesLeftOnBan ?? 120,
          reason: "backend_reputation_ban",
          source: "backend_sync",
        });
        emitEvent(ctx, "BLOCK", { referer });
        return reply.status(403).send({
          success: false,
          error: "Access Denied",
          reason: "reputation_banned",
          requestId: ctx.id,
        });
      }
      priorHistory =
        rep.effective.score >= 5 || rep.effective.failedChecksCount > 0;
      badIpFromRep =
        rep.effective.isKnownBotnet || rep.effective.reputationRiskPoints >= 10;
      failedChallengesFromRep = rep.effective.failedChecksCount ?? 0;
      ctx.reputation = {
        ip: ctx.signals.ip,
        score: rep.effective.score,
        bannedUntil: rep.effective.bannedUntil
          ? Date.parse(rep.effective.bannedUntil)
          : null,
        isPermanent: rep.effective.banStatus === "PERMANENT",
        points: rep.effective.reputationRiskPoints,
      };
    } catch (err) {
      request.log.debug({ err }, "reputation lookup skipped");
    }

    const ipRep = await ipRepPromise;
    ctx.ipReputation = ipRep;

    const badIp = badIpFromRep || Boolean(ipRep?.badIp);
    const rl = rlEarly;

    // 9–11 Risk / Router / Policy
    const risk = calculateRisk({
      badIp,
      highRequestRate: rl.highRequestRate,
      aiAnomalyScore: null,
      suspiciousFingerprint: false,
      priorHistory,
    });
    ctx.riskResult = risk as unknown as RequestContext["riskResult"];

    const routeDecision = routeSuspicion({
      riskScore: risk.score,
      isBlacklisted: ban.banned,
      policy: companyPolicy,
    });
    ctx.routeDecision = routeDecision;

    const policyDecision = decidePolicy(
      {
        riskScore: risk.score,
        failedChallenges: failedChallengesFromRep,
        maxRequestsExceeded: rl.maxRequestsExceeded,
      },
      companyPolicy,
    );
    ctx.policyDecision = policyDecision;

    request.log.info(
      {
        host,
        orgId,
        risk: risk.score,
        route: routeDecision.route,
        policy: policyDecision.action,
        rl: rl.level,
        ipKind: ipRep?.kind,
        jsEnabled,
        challengeAll,
        simulation: ctx.simulation != null,
        simulationRejected: ctx.simulationRejected,
        autoBanAfterFails: companyPolicy?.autoBanAfterFails,
        temporaryBanMinutes: companyPolicy?.temporaryBanMinutes,
      },
      "pipeline decision",
    );

    if (
      policyDecision.action === "permanent_ban" ||
      policyDecision.action === "temporary_ban" ||
      routeDecision.route === "ban"
    ) {
      const banDecision = routeDecision.ban ?? policyDecision;
      await applyBanFromDecision({
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        decision: {
          action: banDecision.action,
          banMinutes: banDecision.banMinutes,
          reason: routeDecision.reason || policyDecision.reason,
        },
      });
      emitEvent(ctx, "BLOCK", { referer });
      return reply.status(403).send({
        success: false,
        error: "Access Denied",
        reason: routeDecision.reason || policyDecision.reason,
        requestId: ctx.id,
      });
    }

    const runAdvanced = async () => {
      const adv = await handleAdvancedFingerprintChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      );
      ctx.advancedChallenge = adv;
      if (adv.responseSent) {
        emitAdvancedIssueEvent(ctx, referer);
        return reply;
      }
      if (adv.passed) {
        await resetChallengeFailCount(orgId, ctx.signals.ip);
        setClearanceCookie(reply, {
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          policy: backendPolicy,
        });
        emitEvent(ctx, "ALLOW", { referer });
        await forwardToOrigin(request, reply, ctx);
        return reply;
      }
      if (adv.telemetry.verdict === "need_client_proof") {
        return runSilentJs();
      }
      const banInfo = await maybeBanAfterChallengeFail({
        monitorOnly,
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        companyPolicy,
        backendPolicy,
        kind: "advanced",
        reason: "advanced_challenge_failed",
      });
      ctx.challengeFailCount = banInfo.failCount;
      emitEvent(ctx, "BLOCK", { referer });
      return reply.status(403).send({
        success: false,
        error: "Advanced fingerprint check failed",
        codes: adv.telemetry.failCodes,
        failCount: banInfo.failCount,
        banned: banInfo.banned,
        requestId: ctx.id,
      });
    };

    switch (routeDecision.route) {
      case "advanced_fingerprint_check":
        return runAdvanced();
      case "rate_limit_with_challenge":
        if (jsPassedStage) {
          // اتعمله تحدي بالفعل: ريت ليميت بس لو فعلًا تخطى الحد الناعم، وإلا يعدّي
          if (rl.softExceeded) {
            emitEvent(ctx, "RATE_LIMIT", { referer });
            reply.header("Retry-After", String(rl.windows.softSec));
            return reply.status(429).send({
              success: false,
              error: "Too Many Requests",
              reason: "soft_rate_limit_after_challenge",
              requestId: ctx.id,
            });
          }
          break;
        }
        if (jsEnabled && (rl.softExceeded || risk.score > 30)) {
          reply.header("Retry-After", String(rl.windows.softSec));
          return runSilentJs();
        }
        break;
      case "silent_js_challenge":
        if (jsEnabled) return runSilentJs();
        break;
      default:
        break;
    }

    if (policyDecision.action === "rate_limit") {
      emitEvent(ctx, "RATE_LIMIT", { referer });
      reply.header("Retry-After", "30");
      return reply.status(429).send({
        success: false,
        error: "Too Many Requests",
        reason: policyDecision.reason,
        requestId: ctx.id,
      });
    }

    // وصلنا للسماح النهائي: لو كان تحدي الكل، نمنح الـ clearance دلوقتي
    if (jsPassedStage) {
      clearJsPassCookie(reply);
      setClearanceCookie(reply, {
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        policy: backendPolicy,
      });
    }
    emitEvent(ctx, "ALLOW", { referer });
    await forwardToOrigin(request, reply, ctx);
    return reply;
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, async () => {
      try {
        // نوقف الـ sweeper والطلبات الأول، وبعدين نفرّغ طابور الأحداث
        await app.close();
        await flushEventLogger();
        await closeRedis();
        process.exit(0);
      } catch {
        process.exit(1);
      }
    });
  }

  return app;
}

function extractRealIp(request: FastifyRequest): string {
  const realIp = request.headers[config.security.realIpHeaderName] as string;
  if (realIp) return realIp.split(",")[0]!.trim();
  const forwarded = request.headers[
    config.security.forwardedForHeaderName
  ] as string;
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.ip || "0.0.0.0";
}

function parseJsonBody<T>(body: unknown): T | null {
  try {
    if (Buffer.isBuffer(body)) return JSON.parse(body.toString("utf8")) as T;
    if (typeof body === "string") return JSON.parse(body) as T;
    if (body && typeof body === "object") return body as T;
    return null;
  } catch {
    return null;
  }
}

export default buildApp;