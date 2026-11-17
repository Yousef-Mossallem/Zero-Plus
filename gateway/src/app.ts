// ======================================================
// ZERO PLUS GATEWAY — Fastify Application (كامل موصول + AI + Pipeline)
// Host → Backend → [Simulation Auth] → (Ban ∥ AI-State) → Clearance → [Expired JS]
// → Rate → [Light lane | Monitor shadow | Challenge-all fast path]
// → Assess (IP-Rep ∥ Backend-Rep ∥ AI Phase 1) → Risk → Router → Policy
// → merge(AI + future) → Advanced / JS / Rate / Ban / Forward
// + event-logger + Origin Probe (202) + Challenge Expiry Sweeper
// + Capacity (load hint + agent heartbeat) + AI Phase 2 (خلفية)
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
//   - Ban + حالة الـ AI (Redis) بالتوازي، و IP-Rep + Backend-Rep + AI بالتوازي
//   - الـ AI بيبدأ أول ما IP-Rep يخلص (speculative) من غير ما يستنى Backend-Rep
//
// التحقق من المحاكاة (Simulation) — بعد معرفة org/server مباشرة:
//   - authenticateSimulation مع الهيدرز + expectedOrganizationId
//     + expectedServerId + expectedDomain
//   - لو فشل التوكن ووُجد أي هيدر X-ZP-Sim-*: نتجاهل كل هيدرات X-ZP-Sim-*
//     (بنشيلها من الطلب كأنها غير موجودة)، فلا نثق بـ AI / JS / Country
//   - لو نجح: toSimulationContext → ctx.simulation
//   - محاكاة موثوقة + aiScore → بنستخدمها بدل نداء الـ AI الحقيقي
//
// ======================================================
// الجديد في الـ Pipeline (مفيش طلب بيستنى طلب):
// ======================================================
//
// 1) Intake (intakeClassifier): تصنيف متزامن في onRequest (صفر I/O):
//    priority P0..P3 + lane + isLightweight. بيتحكم في:
//      - أولوية الدخول للبوابات (PriorityGate) تحت الضغط
//      - ميزانية الـ AI (P0 أطول / P3 أقصر / تحت الضغط بنتخطاه)
//      - Light Lane للأصول الثابتة/health: Ban + Rate فقط ثم Forward
//        (مفيش تحدي JS على ملف .css ولا نداء AI ولا IP-Rep)
//
// 2) PriorityGate: حد أقصى لعدد النداءات الخارجية المتزامنة (AI / Backend-Rep /
//    IP-Rep). الطلب P0/P1 بيتقدّم في الدور، والـ P3 بيتخطى بدل ما يستنى (fail-open).
//
// 3) AI (ai.client):
//    - Phase 1 (pre_decision) داخل الـ Assess بميزانية وقت (AI_BUDGET_MS).
//      لو اتأخر: نكمل من غيره، والرد المتأخر بيتخزّن لـ future للطلب الجاي.
//    - mergeAiWithGatewayPlan + تنفيذ future المخزّن (Redis) قبل الدمج.
//    - revoke_clearance / revalidate_clearance: بنشيل الكوكي ونعيد الفحص.
//    - تحدي واحد لكل طلب (المسار النهائي واحد بس).
//    - Phase 2 (post_decision) في onResponse في الخلفية بعد ما الرد يخرج
//      (مع sampling) — ما بتأخرش أي زائر.
//
// 4) Signals Collector: Risk + AI payload من نفس المصدر (مفيش تلزيق يدوي).
//
// 5) Capacity: registerServer عند كل تحديث سياسة + recordRequest + heartbeat
//    للـ Agent + قياس load محلي متزامن (LoadTracker) لقرارات الـ shedding.
//
// 6) MONITOR_ONLY: الـ Forward فوري، والتحليل الكامل (Risk/AI) بيتم shadow في
//    الخلفية ويتسجل في الحدث (wouldDo) من غير ما يبطّأ الزائر.
//
// متغيرات بيئة اختيارية:
//   GATEWAY_CHALLENGE_SWEEP_MS      (افتراضي 10000، 0 = إيقاف الـ sweeper)
//   GATEWAY_POLICY_CACHE_TTL_MS     (افتراضي 10000، 0 = إيقاف الكاش)
//   GATEWAY_POLICY_STALE_MS         (افتراضي 300000)
//   GATEWAY_LOG_ADVANCED_ISSUE      (افتراضي true، false = متسجلش حدث إصدار advanced)
//   --- AI ---
//   GATEWAY_AI_ENABLED              (افتراضي true)
//   GATEWAY_AI_BUDGET_MS            (افتراضي 400) ميزانية وقت Phase 1 على المسار الساخن
//   GATEWAY_AI_CONCURRENCY          (افتراضي 64)
//   GATEWAY_AI_STATE_TTL_SEC        (افتراضي 3600) TTL آخر سياق AI
//   GATEWAY_AI_FUTURE_BLOCK         (challenge | ban — افتراضي challenge)
//   GATEWAY_AI_POST_ENABLED         (افتراضي true) Phase 2 في الخلفية
//   GATEWAY_AI_POST_ALLOW_RATE      (افتراضي 0.25)
//   GATEWAY_AI_POST_CHALLENGE_RATE  (افتراضي 0.2)
//   GATEWAY_AI_POST_CLEARED_RATE    (افتراضي 0.05)
//   --- Pipeline ---
//   GATEWAY_LIGHT_LANE              (افتراضي true)
//   GATEWAY_LIGHT_LOG_RATE          (افتراضي 1 — سجّل كل ALLOW على Light Lane)
//   GATEWAY_SHADOW_MONITOR          (افتراضي true)
//   GATEWAY_REP_CONCURRENCY         (افتراضي 128)
//   GATEWAY_IPREP_CONCURRENCY       (افتراضي 128)
//   GATEWAY_CAPACITY_RECORD         (افتراضي true) recordRequest لكل طلب
// ======================================================

import { randomUUID, createHash } from "node:crypto";
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
  type ReputationLookupData,
} from "./services/backend.client";
import {
  analyzeWithAi,
  mergeAiWithGatewayPlan,
  aiFutureRedisKey,
  aiPreviousRedisKey,
  type AiAnalyzeResult,
  type FutureAction,
  type GatewayPlannedPath,
  type PreviousAiContext,
} from "./services/ai.client";
import {
  getCapacityManager,
  closeCapacityManager,
} from "./services/capacity.manager";
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
  classifyIntake,
  type IntakeClassifyResult,
} from "./detection/intakeClassifier";
import {
  collectRiskSignals,
  collectAiBuild,
  buildGatewayOutcomeFromContext,
  type CollectorContext,
  type RateLimitSnapshot,
  type ChallengeSnapshot,
  type BanHistorySnapshot,
} from "./risk/signalsCollector";
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
import {
  logSecurityEvent,
  logFromGatewayContext,
  flushEventLogger,
  type AiMergeInfo,
} from "./logging/event-logger";
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

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
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

// ----- AI -----
const AI_ENABLED = envBool("GATEWAY_AI_ENABLED", true);
const AI_BUDGET_MS = Math.max(50, envNumber("GATEWAY_AI_BUDGET_MS", 400));
const AI_CONCURRENCY = Math.max(1, envNumber("GATEWAY_AI_CONCURRENCY", 64));
const AI_STATE_TTL_SEC = Math.max(
  60,
  envNumber("GATEWAY_AI_STATE_TTL_SEC", 3600),
);
const AI_FUTURE_BLOCK_MODE: "challenge" | "ban" =
  (process.env.GATEWAY_AI_FUTURE_BLOCK ?? "challenge").toLowerCase() === "ban"
    ? "ban"
    : "challenge";
const AI_POST_ENABLED = envBool("GATEWAY_AI_POST_ENABLED", true);
const AI_POST_ALLOW_RATE = envNumber("GATEWAY_AI_POST_ALLOW_RATE", 0.25);
const AI_POST_CHALLENGE_RATE = envNumber("GATEWAY_AI_POST_CHALLENGE_RATE", 0.2);
const AI_POST_CLEARED_RATE = envNumber("GATEWAY_AI_POST_CLEARED_RATE", 0.05);
/** ثقة AI في "block" تخلّينا نرفع JS → advanced (من غير ban مباشر) */
const AI_BLOCK_ESCALATE_CONFIDENCE = 0.85;

// ----- Pipeline -----
const LIGHT_LANE_ENABLED = envBool("GATEWAY_LIGHT_LANE", true);
const LIGHT_LOG_RATE = Math.min(1, Math.max(0, envNumber("GATEWAY_LIGHT_LOG_RATE", 1)));
const SHADOW_MONITOR_ENABLED = envBool("GATEWAY_SHADOW_MONITOR", true);
const REP_CONCURRENCY = Math.max(1, envNumber("GATEWAY_REP_CONCURRENCY", 128));
const IPREP_CONCURRENCY = Math.max(
  1,
  envNumber("GATEWAY_IPREP_CONCURRENCY", 128),
);
const CAPACITY_RECORD_ENABLED = envBool("GATEWAY_CAPACITY_RECORD", true);

/** أقصى انتظار في طابور البوابة حسب أولوية الـ intake (P0..P3) */
const GATE_WAIT_MS: readonly number[] = [250, 150, 50, 0];
/** مضاعف ميزانية الـ AI حسب الأولوية (P0..P3) */
const AI_BUDGET_FACTOR: readonly number[] = [1.5, 1, 0.75, 0.5];

// ======================================================
// أدوات صغيرة
// ======================================================

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

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

/** سباق مع ميزانية وقت — من غير ما نرمي: done=false لو الميزانية خلصت */
function raceBudget<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ done: true; value: T } | { done: false }> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ done: false }), ms);
    p.then(
      (value) => {
        clearTimeout(t);
        resolve({ done: true, value });
      },
      () => {
        clearTimeout(t);
        resolve({ done: false });
      },
    );
  });
}

// ======================================================
// Stats (عدادات خفيفة للمراقبة)
// ======================================================

const stats = {
  requests: 0,
  lightLane: 0,
  clearedFastPath: 0,
  challengeAllFast: 0,
  shadowMonitor: 0,
  futureApplied: 0,
  clearanceRevoked: 0,
  ai: {
    called: 0,
    ok: 0,
    failed: 0,
    timeout: 0,
    shed: 0,
    skipped: 0,
    simOverride: 0,
    post: 0,
    postDropped: 0,
  },
};

// ======================================================
// PriorityGate — حد للتزامن + أولوية + shedding (من غير طابور عالق)
// ------------------------------------------------------
// - تحت الحد: الدخول فوري (صفر انتظار)
// - فوق الحد: الأقل رقمًا (P0) بيتقدّم، والانتظار له سقف زمني
// - لو السقف خلص أو الطابور مليان: null → الطلب يكمل من غير الخدمة دي (fail-open)
// ======================================================

interface GateWaiter {
  rank: number;
  seq: number;
  grant: (release: (() => void) | null) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

class PriorityGate {
  private active = 0;
  private seq = 0;
  private waiters: GateWaiter[] = [];
  readonly counters = { granted: 0, queued: 0, shed: 0 };

  constructor(
    readonly name: string,
    private readonly limit: number,
    private readonly maxQueue = 2_000,
  ) {}

  get inflight(): number {
    return this.active;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  snapshot() {
    return {
      name: this.name,
      limit: this.limit,
      inflight: this.active,
      waiting: this.waiters.length,
      ...this.counters,
    };
  }

  private makeRelease(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active--;
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < this.limit && this.waiters.length > 0) {
      let best = 0;
      for (let i = 1; i < this.waiters.length; i++) {
        const a = this.waiters[i]!;
        const b = this.waiters[best]!;
        if (a.rank < b.rank || (a.rank === b.rank && a.seq < b.seq)) best = i;
      }
      const [w] = this.waiters.splice(best, 1);
      if (!w) break;
      if (w.timer) clearTimeout(w.timer);
      this.active++;
      this.counters.granted++;
      w.grant(this.makeRelease());
    }
  }

  acquire(rank: number, maxWaitMs: number): Promise<(() => void) | null> {
    if (this.active < this.limit) {
      this.active++;
      this.counters.granted++;
      return Promise.resolve(this.makeRelease());
    }
    if (maxWaitMs <= 0 || this.waiters.length >= this.maxQueue) {
      this.counters.shed++;
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const w: GateWaiter = {
        rank,
        seq: this.seq++,
        grant: resolve,
        timer: null,
      };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        this.counters.shed++;
        resolve(null);
      }, maxWaitMs);
      this.waiters.push(w);
      this.counters.queued++;
    });
  }

  async run<T>(
    rank: number,
    maxWaitMs: number,
    fn: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    const release = await this.acquire(rank, maxWaitMs);
    if (!release) return { ok: false };
    try {
      return { ok: true, value: await fn() };
    } finally {
      release();
    }
  }
}

const aiGate = new PriorityGate("ai", AI_CONCURRENCY);
const repGate = new PriorityGate("backend_reputation", REP_CONCURRENCY);
const ipGate = new PriorityGate("ip_reputation", IPREP_CONCURRENCY);

/**
 * يشغّل fn عبر البوابة. null لو اتخطّى (shed) أو فشل — مفيش رمي أبدًا.
 */
async function gated<T>(
  gate: PriorityGate,
  rank: number,
  waitMs: number,
  fn: () => Promise<T>,
  hooks?: { onShed?: () => void; onError?: (err: unknown) => void },
): Promise<T | null> {
  try {
    const r = await gate.run(rank, waitMs, fn);
    if (r.ok) return r.value;
    hooks?.onShed?.();
    return null;
  } catch (err) {
    hooks?.onError?.(err);
    return null;
  }
}

// ======================================================
// LoadTracker — حمل محلي متزامن (صفر I/O) لقرارات الـ shedding
// ------------------------------------------------------
// نافذة 5 ثواني، RPS = مجموع آخر 5 buckets / 5
// maxRps من البولسي/الـ probe (effectiveMaxServerRps → server → policy)
// ======================================================

type LoadHint = "low" | "medium" | "high" | "critical";

interface LoadSnapshot {
  rps: number;
  loadPercent: number;
  hint: LoadHint;
  maxRps: number | null;
}

const LOAD_WINDOW_SEC = 5;

function toLoadHint(pct: number): LoadHint {
  if (pct < 60) return "low";
  if (pct < 80) return "medium";
  if (pct < 95) return "high";
  return "critical";
}

class LoadTracker {
  private servers = new Map<
    string,
    { counts: number[]; secs: number[]; maxRps: number | null }
  >();

  hit(serverId: string, maxRps: number | null): LoadSnapshot {
    const nowSec = Math.floor(Date.now() / 1000);
    let s = this.servers.get(serverId);
    if (!s) {
      if (this.servers.size >= 10_000) {
        const first = this.servers.keys().next();
        if (!first.done) this.servers.delete(first.value);
      }
      s = {
        counts: new Array<number>(LOAD_WINDOW_SEC).fill(0),
        secs: new Array<number>(LOAD_WINDOW_SEC).fill(0),
        maxRps,
      };
      this.servers.set(serverId, s);
    }
    s.maxRps = maxRps;
    const i = nowSec % LOAD_WINDOW_SEC;
    if (s.secs[i] !== nowSec) {
      s.secs[i] = nowSec;
      s.counts[i] = 0;
    }
    s.counts[i] = (s.counts[i] ?? 0) + 1;

    let total = 0;
    for (let k = 0; k < LOAD_WINDOW_SEC; k++) {
      if ((s.secs[k] ?? 0) > nowSec - LOAD_WINDOW_SEC) total += s.counts[k] ?? 0;
    }
    const rps = Math.round((total / LOAD_WINDOW_SEC) * 10) / 10;
    const loadPercent =
      maxRps != null && maxRps > 0
        ? Math.min(100, Math.round((rps / maxRps) * 100))
        : 0;
    return { rps, loadPercent, hint: toLoadHint(loadPercent), maxRps };
  }

  size(): number {
    return this.servers.size;
  }
}

const loadTracker = new LoadTracker();

// ======================================================
// Runtime context
// ======================================================

interface BackendRepSummary {
  score: number;
  failedChecks: number;
  knownBotnet: boolean;
  riskPoints: number;
  allowlisted: boolean;
  banStatus: string;
}

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

  // ----- Intake / Lane / Load -----
  intake: IntakeClassifyResult | null;
  lane: "full" | "light";
  load: LoadSnapshot | null;

  // ----- AI -----
  /** AI مسموح (env + سياسة الشركة enableAiAnomaly) */
  aiAllowed: boolean;
  aiState: AiState;
  ai: AiAnalyzeResult | null;
  /** سبب عدم وجود نتيجة AI على هذا الطلب (timeout / shed / load_critical …) */
  aiSkipped: string | null;
  aiMerge: AiMergeInfo | null;
  futureActionApplied: FutureAction | null;
  clearanceRevoked: boolean;
  /** true لو الكوكي اتحقق منه وطلع صالح (مسار سريع) */
  clearanceValid: boolean | null;
  backendRep: BackendRepSummary | null;
  sessionId: string | null;

  // ----- Observability -----
  timings: Record<string, number>;
  degraded: string[];
  /** تحليل shadow لسيرفر MONITOR_ONLY */
  shadow: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    ctx: GatewayRuntimeContext;
  }
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

function isAiAllowedByPolicy(policy: OrgPolicyFromBackend | null): boolean {
  if (!AI_ENABLED) return false;
  if (!policy) return true;
  return policy.enableAiAnomaly !== false;
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

/** شكل ثابت لسياق المحاكاة (من غير افتراض أسماء الحقول في النوع) */
function simFields(sim: SimulationContext | null): {
  active: boolean;
  runId: string | null;
  persona: string | null;
  js: string | null;
  aiScore: number | null;
  countryHint: string | null;
} | null {
  if (!sim) return null;
  const s = sim as unknown as {
    active?: boolean;
    runId?: string | null;
    persona?: string | null;
    js?: string | null;
    aiScore?: number | null;
    countryHint?: string | null;
  };
  return {
    active: s.active !== false,
    runId: s.runId ?? null,
    persona: s.persona ?? null,
    js: s.js ?? null,
    aiScore: typeof s.aiScore === "number" ? s.aiScore : null,
    countryHint: s.countryHint ?? null,
  };
}

/** درجة AI من محاكاة موثوقة (بتحل محل نداء الـ AI الحقيقي) */
function simulationAiScore(ctx: GatewayRuntimeContext): number | null {
  const s = simFields(ctx.simulation);
  if (!s || !s.active || s.aiScore == null) return null;
  return clamp01(s.aiScore);
}

// ======================================================
// كاش سياسة الـ host (سرعة + مرونة)
//   - TTL قصير لتقليل ضرب الباك على كل طلب
//   - dedupe: 100 طلب متزامن على نفس الـ host = طلب واحد للباك
//   - stale-if-error: لو الباك وقع نكمل بآخر سياسة معروفة (حد أقصى POLICY_STALE_MS)
//   - أخطاء 4xx (host مش موجود/اتشال) = بنمسح الكاش ومبنستخدمش stale
//   - عند كل جلب جديد: registerServer في CapacityManager
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

function registerCapacity(data: PolicyResolveData): void {
  try {
    getCapacityManager().registerServer(data);
  } catch {
    /* fail-open */
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
        registerCapacity(data);
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
// حالة الـ AI (Redis) — previous + future
// ------------------------------------------------------
// - previous: آخر سياق AI لنفس الزائر (يتبعت للـ AI كـ previous_ai)
// - future  : إجراء مؤجّل من AI (تحدي / rate_limit / revalidate_clearance…)
//             بيتنفّذ على الطلب الجاي قبل الدمج العادي.
// المفتاح: org + (device_fp أو IP) — من ai.client.
// قراءة الاتنين بـ MGET واحد وبالتوازي مع checkBan.
// ======================================================

interface StoredFuture {
  action: FutureAction;
  reason: string | null;
  confidence: number | null;
  setAt: number;
  expAt: number;
  source: "pre" | "post";
}

interface AiState {
  future: StoredFuture | null;
  previous: PreviousAiContext | null;
}

function emptyAiState(): AiState {
  return { future: null, previous: null };
}

const FUTURE_ACTIONS = new Set<string>([
  "allow_normal",
  "revalidate_clearance",
  "javascript_challenge",
  "advanced_fingerprint_check",
  "rate_limit",
  "monitor",
  "block",
]);

function aiKeyParts(ctx: {
  signals: { orgId: string; ip: string; deviceFingerprint: string | null };
}) {
  return {
    orgId: ctx.signals.orgId,
    ip: ctx.signals.ip,
    deviceFp: ctx.signals.deviceFingerprint,
  };
}

function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadAiState(parts: {
  orgId: string;
  ip: string;
  deviceFp: string | null;
}): Promise<AiState> {
  try {
    const r = getRedis();
    const [fRaw, pRaw] = await r.mget(
      aiFutureRedisKey(parts),
      aiPreviousRedisKey(parts),
    );
    const f = parseJsonSafe<StoredFuture>(fRaw);
    const future =
      f &&
      FUTURE_ACTIONS.has(String(f.action)) &&
      typeof f.expAt === "number" &&
      f.expAt > Date.now()
        ? f
        : null;
    return { future, previous: parseJsonSafe<PreviousAiContext>(pRaw) };
  } catch {
    return emptyAiState();
  }
}

async function persistAiState(p: {
  parts: { orgId: string; ip: string; deviceFp: string | null };
  ai: AiAnalyzeResult;
  source: "pre" | "post";
  /** allow_normal الصريح يمسح future (Phase 1 فقط) */
  allowClear: boolean;
}): Promise<void> {
  if (!p.ai.ok) return;
  try {
    const r = getRedis();
    const prev: PreviousAiContext = {
      anomaly_score: p.ai.anomalyScore,
      recommendation: p.ai.recommendation,
      future_action: p.ai.future?.action ?? null,
      model_version: p.ai.modelVersion,
      decided_at: new Date().toISOString(),
    };
    const tasks: Promise<unknown>[] = [
      r.set(
        aiPreviousRedisKey(p.parts),
        JSON.stringify(prev),
        "EX",
        AI_STATE_TTL_SEC,
      ),
    ];
    const action = p.ai.future?.action ?? null;
    if (action && action !== "allow_normal") {
      const ttl = clampInt(p.ai.future?.ttl_sec ?? 300, 30, 3600);
      const now = Date.now();
      const stored: StoredFuture = {
        action,
        reason: p.ai.future?.reason ?? null,
        confidence: p.ai.future?.confidence ?? null,
        setAt: now,
        expAt: now + ttl * 1000,
        source: p.source,
      };
      tasks.push(
        r.set(aiFutureRedisKey(p.parts), JSON.stringify(stored), "EX", ttl),
      );
    } else if (action === "allow_normal" && p.allowClear) {
      tasks.push(r.del(aiFutureRedisKey(p.parts)));
    }
    await Promise.all(tasks);
  } catch {
    /* fail-open */
  }
}

function clearAiFuture(parts: {
  orgId: string;
  ip: string;
  deviceFp: string | null;
}): void {
  try {
    void getRedis()
      .del(aiFutureRedisKey(parts))
      .catch(() => undefined);
  } catch {
    /* ignore */
  }
}

// ======================================================
// دمج AI + future مع مسار الجتواي
// ======================================================

const PATH_SEVERITY: Record<GatewayPlannedPath, number> = {
  allow: 0,
  monitor: 1,
  rate_limit: 2,
  silent_js_challenge: 3,
  revoke_clearance: 3,
  advanced_fingerprint_check: 4,
  ban: 5,
};

/** future محفوظ → المسار اللي ينفّذه الجتواي (AI block مش ban مباشر إلا بإعداد صريح) */
function futureToPath(action: FutureAction): GatewayPlannedPath | null {
  switch (action) {
    case "allow_normal":
      return null;
    case "revalidate_clearance":
      return "revoke_clearance";
    case "javascript_challenge":
      return "silent_js_challenge";
    case "advanced_fingerprint_check":
      return "advanced_fingerprint_check";
    case "rate_limit":
      return "rate_limit";
    case "monitor":
      return "monitor";
    case "block":
      return AI_FUTURE_BLOCK_MODE === "ban"
        ? "ban"
        : "advanced_fingerprint_check";
    default:
      return null;
  }
}

/**
 * ترتيب التنفيذ:
 *   1) future المخزّن (من طلب سابق) — يرفع المسار فقط (مش بيخففه)
 *   2) mergeAiWithGatewayPlan — توصية AI الحالية
 *   3) AI block بثقة عالية + مسار JS → advanced (تحدي واحد أقوى، مش ban)
 * النتيجة: مسار واحد → تحدي واحد لكل طلب.
 */
function combineWithAi(params: {
  gatewayPath: GatewayPlannedPath;
  ai: AiAnalyzeResult | null;
  future: StoredFuture | null;
}): { merge: AiMergeInfo; futureApplied: FutureAction | null } {
  let path = params.gatewayPath;
  let source: AiMergeInfo["source"] = "gateway";
  const notes: string[] = [];
  let mustRevoke = false;
  let futureApplied: FutureAction | null = null;

  const fut = params.future;
  if (fut) {
    const fp = futureToPath(fut.action);
    if (fp === "revoke_clearance") {
      mustRevoke = true;
      futureApplied = fut.action;
      source = "future";
      notes.push("future_revalidate_clearance");
      if (PATH_SEVERITY[path] < PATH_SEVERITY.silent_js_challenge) {
        path = "silent_js_challenge";
      }
    } else if (fp && PATH_SEVERITY[fp] > PATH_SEVERITY[path]) {
      path = fp;
      futureApplied = fut.action;
      source = "future";
      notes.push(`future_${fut.action}`);
    } else if (fp) {
      notes.push(`future_${fut.action}_covered`);
    }
  }

  const m = mergeAiWithGatewayPlan({
    gatewayPath: path,
    ai: params.ai,
    applyingStoredFuture: fut != null,
  });

  // الدمج بيشدد بس — مانسمحش إنه يخفف (مثلاً revoke_clearance بيرجّع JS حتى لو advanced)
  let finalPath: GatewayPlannedPath = path;
  if (PATH_SEVERITY[m.finalPath] >= PATH_SEVERITY[path]) {
    finalPath = m.finalPath;
  }
  if (m.mustRevokeClearance) mustRevoke = true;

  if (m.source !== "gateway") {
    if (source !== "future") source = m.source;
    notes.push(m.note);
  } else if (notes.length === 0) {
    notes.push(m.note);
  }

  const rec = params.ai?.ok ? params.ai.recommendation : null;
  if (
    rec === "block" &&
    (params.ai?.confidence ?? 0) >= AI_BLOCK_ESCALATE_CONFIDENCE &&
    finalPath === "silent_js_challenge"
  ) {
    finalPath = "advanced_fingerprint_check";
    if (source !== "future") source = "merged";
    notes.push("ai_block_escalates_to_advanced");
  }

  return {
    merge: {
      finalPath,
      mustRevokeClearance: mustRevoke,
      source,
      note: notes.join("|"),
    },
    futureApplied,
  };
}

/**
 * المسار اللي الجتواي كان هينفّذه من غير AI (نفس منطق الـ switch القديم بالظبط)
 */
function planGatewayPath(p: {
  banNow: boolean;
  route: RouteDecision;
  policy: PolicyDecision;
  rl: RateLimitResult;
  riskScore: number;
  jsEnabled: boolean;
  jsPassedStage: boolean;
}): GatewayPlannedPath {
  const policyBan =
    p.policy.action === "permanent_ban" || p.policy.action === "temporary_ban";
  if (p.banNow || policyBan || p.route.route === "ban") return "ban";

  switch (p.route.route) {
    case "advanced_fingerprint_check":
      return "advanced_fingerprint_check";
    case "rate_limit_with_challenge":
      if (p.jsPassedStage) {
        if (p.rl.softExceeded) return "rate_limit";
        break;
      }
      if (p.jsEnabled && (p.rl.softExceeded || p.riskScore > 30)) {
        return "silent_js_challenge";
      }
      break;
    case "silent_js_challenge":
      if (p.jsEnabled) return "silent_js_challenge";
      break;
    default:
      break;
  }

  if (p.policy.action === "rate_limit") return "rate_limit";
  return "allow";
}

// ======================================================
// Plan لكل طلب (Intake + Load → ميزانيات)
// ======================================================

interface RequestPlan {
  rank: number;
  waitMs: number;
  useAi: boolean;
  aiSkipReason: string | null;
  aiBudgetMs: number;
  useBackendRep: boolean;
  useIpRep: boolean;
}

function planRequest(ctx: GatewayRuntimeContext): RequestPlan {
  const rank = clampInt(ctx.intake?.priorityRank ?? 3, 0, 3);
  const waitMs = GATE_WAIT_MS[rank] ?? 0;
  const hint = ctx.load?.hint ?? "low";

  let useAi = ctx.aiAllowed;
  let aiSkipReason: string | null = ctx.aiAllowed ? null : "ai_disabled";

  if (useAi && simulationAiScore(ctx) != null) {
    useAi = false;
    aiSkipReason = "sim_override";
  }
  if (useAi && hint === "critical" && rank >= 2) {
    useAi = false;
    aiSkipReason = "load_critical";
  } else if (useAi && hint === "high" && rank >= 3) {
    useAi = false;
    aiSkipReason = "load_high";
  }

  let budget = AI_BUDGET_MS * (AI_BUDGET_FACTOR[rank] ?? 1);
  if (hint === "critical") budget *= 0.5;
  const aiBudgetMs = clampInt(budget, 80, 1_500);

  return {
    rank,
    waitMs,
    useAi,
    aiSkipReason,
    aiBudgetMs,
    useBackendRep: !(hint === "critical" && rank >= 3),
    useIpRep: true,
  };
}

// ======================================================
// Collector context (مصدر واحد لـ Risk + AI payload)
// ======================================================

function sessionIdFor(ctx: GatewayRuntimeContext): string {
  if (!ctx.sessionId) {
    const id = ctx.signals.deviceFingerprint || ctx.signals.ip;
    ctx.sessionId = createHash("sha256")
      .update(`${ctx.signals.orgId}:${id}`)
      .digest("hex")
      .slice(0, 24);
  }
  return ctx.sessionId;
}

function rateSnapshot(rl: RateLimitResult): RateLimitSnapshot {
  const level = rl.hardExceeded
    ? "hard"
    : rl.softExceeded || rl.highRequestRate
      ? "soft"
      : "none";
  return {
    softExceeded: Boolean(rl.softExceeded),
    hardExceeded: Boolean(rl.hardExceeded),
    level,
    windowSec: rl.windows?.softSec ?? null,
    raw: {
      highRequestRate: Boolean(rl.highRequestRate),
      maxRequestsExceeded: Boolean(rl.maxRequestsExceeded),
      counts: rl.counts as unknown,
    },
  };
}

function jsSnapshot(js: JsChallengeResult | null): ChallengeSnapshot["js"] {
  if (!js) return null;
  const expired = js.phase === "expired" || js.telemetry?.expired === true;
  const hard = isJsChallengeHardFailure(js);
  const issued = js.phase === "issue" || js.responseSent === true;
  return {
    challenged: js.phase !== "disabled",
    outcome: js.passed
      ? "passed"
      : expired
        ? "timeout"
        : hard
          ? "failed"
          : issued
            ? "not_applicable"
            : "skipped",
    solveTimeMs: js.telemetry?.solveDurationMs ?? null,
    suspicionScore: js.telemetry?.localSuspicionScore ?? null,
    challengeId: js.telemetry?.challengeId || null,
    hardFailure: hard,
    expired,
    phase: js.phase,
  };
}

function advSnapshot(
  adv: AdvancedChallengeResult | null,
): ChallengeSnapshot["advanced"] {
  if (!adv) return null;
  const verdict = adv.telemetry?.verdict;
  return {
    challenged: true,
    outcome: adv.passed
      ? "passed"
      : adv.responseSent
        ? "not_applicable"
        : verdict === "need_client_proof"
          ? "skipped"
          : "failed",
    score: adv.telemetry?.localSuspicionScore ?? null,
    raw: {
      verdict: verdict ?? null,
      failCodes: adv.telemetry?.failCodes ?? null,
    },
  };
}

function toCollectorContext(
  ctx: GatewayRuntimeContext,
  request: FastifyRequest,
  patch: Partial<CollectorContext> = {},
): CollectorContext {
  const sim = simFields(ctx.simulation);
  const base: CollectorContext = {
    orgId: ctx.signals.orgId,
    requestId: ctx.id,
    sessionId: sessionIdFor(ctx),
    ip: ctx.signals.ip,
    path: ctx.signals.path,
    method: ctx.signals.method,
    host: ctx.signals.host,
    userAgent: ctx.signals.userAgent,
    referer: (request.headers.referer as string | undefined) ?? null,
    contentLength: ctx.signals.requestSize || null,
    intake: ctx.intake,
    ipReputation: ctx.ipReputation,
    fingerprint: {
      ja4: ctx.signals.ja4,
      ja3: ctx.signals.ja3,
      deviceFingerprint: ctx.signals.deviceFingerprint,
    },
    rateLimit: ctx.rateLimit ? rateSnapshot(ctx.rateLimit) : null,
    clearance: {
      present: ctx.signals.hasClearance || ctx.clearanceRevoked,
      valid: ctx.clearanceValid === true,
      revoked: ctx.clearanceRevoked,
    },
    challenges: {
      js: jsSnapshot(ctx.jsChallenge),
      advanced: advSnapshot(ctx.advancedChallenge),
    },
    simulation: sim
      ? {
          active: sim.active,
          runId: sim.runId,
          persona: sim.persona,
          jsDirective: sim.js,
          aiScoreOverride: sim.aiScore,
          countryHint: sim.countryHint,
        }
      : null,
    server: ctx.load
      ? { load: ctx.load.loadPercent, hint: ctx.load.hint }
      : null,
    previousAi: ctx.aiState.previous,
    futureActionApplied: ctx.futureActionApplied ?? ctx.aiState.future?.action ?? null,
  };
  return { ...base, ...patch };
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
    // confidence: متتبعتش هنا — الـ logger بياخدها من AI أولًا وبعدين من ipReputation
  };
}

function isSensitiveLevel(level: string | null | undefined): boolean {
  const l = String(level || "").toLowerCase();
  return l === "high" || l === "critical";
}

function emitEvent(
  ctx: GatewayRuntimeContext,
  decision: string,
  extra?: {
    referer?: string | null;
    details?: Record<string, unknown>;
  },
): void {
  if (!ctx.server?.id || !ctx.signals.orgId) return;
  if (ctx.signals.orgId === "unknown") return;

  ctx.finalDecision = decision;

  // Light Lane: ممكن نخفف تسجيل ALLOW العادي (افتراضيًا بنسجّل الكل)
  if (
    ctx.lane === "light" &&
    decision === "ALLOW" &&
    LIGHT_LOG_RATE < 1 &&
    Math.random() >= LIGHT_LOG_RATE
  ) {
    return;
  }

  const ipRep = ctx.ipReputation;
  const risk = ctx.riskResult as RiskResult | null;
  const jsHard =
    ctx.jsChallenge != null && isJsChallengeHardFailure(ctx.jsChallenge);

  // طلبات ردود التحدي: مفيش AI Phase 1 عليها → نسجّل آخر سياق AI للزائر
  const prev = !ctx.ai ? ctx.aiState.previous : null;
  const intake = ctx.intake;
  const aiSensitive = ctx.ai?.ok ? isSensitiveLevel(ctx.ai.pathSensitivity) : false;
  const intakeSensitive = intake ? intake.priorityRank <= 1 : false;

  logFromGatewayContext({
    organizationId: ctx.signals.orgId,
    serverId: ctx.server.id,
    ip: ctx.signals.ip,
    path: ctx.signals.path,
    method: ctx.signals.method,
    requestId: ctx.id,
    userAgent: ctx.signals.userAgent,
    referer: extra?.referer ?? null,
    riskScore: risk?.score ?? 0,
    decision,
    startTime: ctx.startTime,
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
    // AI (anomaly/confidence/recommendation/surge/stage بتتحسب جوه الـ logger)
    ai: ctx.ai,
    aiMerge: ctx.aiMerge,
    futureActionApplied: ctx.futureActionApplied,
    clearanceRevoked: ctx.clearanceRevoked,
    simulation: ctx.simulation,
    pathSensitive:
      ctx.ai?.ok || intake ? aiSensitive || intakeSensitive : undefined,
    anomalyScore: prev?.anomaly_score ?? undefined,
    recommendation: prev?.recommendation ?? undefined,
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
      lane: ctx.lane,
      intake: intake
        ? {
            priority: intake.priority,
            lane: intake.lane,
            tlsBucket: intake.tlsBucket,
            deviceBucket: intake.deviceBucket,
            clientKind: intake.clientKind,
            reasons: intake.priorityReasons,
          }
        : null,
      load: ctx.load,
      aiSkipped: ctx.aiSkipped,
      previousAi: prev ?? null,
      backendReputation: ctx.backendRep,
      degraded: ctx.degraded.length > 0 ? ctx.degraded : null,
      timings: ctx.timings,
      policyStale: ctx.policyUsedFallback,
      ...(extra?.details ?? {}),
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
// AI Phase 1 (على المسار الساخن) + Phase 2 (خلفية)
// ======================================================

interface AiOutcome {
  result: AiAnalyzeResult | null;
  skipped: string | null;
}

/**
 * Phase 1: بيشتغل أول ما IP-Rep يخلص (speculative — من غير ما يستنى Backend-Rep).
 *  - ميزانية وقت: لو خلصت نكمل من غير AI والرد المتأخر بيتخزّن لـ future الطلب الجاي
 *  - البوابة: لو مزدحمة والطلب منخفض الأولوية → shed (fail-open)
 */
async function runAiPhase1(p: {
  request: FastifyRequest;
  ctx: GatewayRuntimeContext;
  companyPolicy: Partial<CompanyPolicy> | null;
  plan: RequestPlan;
}): Promise<AiOutcome> {
  const { request, ctx, plan } = p;

  // risk جزئي (IP + rate + fingerprint) — سجل الباك بييجي بعدين في الـ risk النهائي
  const partialRisk = calculateRisk(
    collectRiskSignals(toCollectorContext(ctx, request)),
  );
  const partialRoute = routeSuspicion({
    riskScore: partialRisk.score,
    isBlacklisted: false,
    policy: p.companyPolicy,
  });
  const build = collectAiBuild(
    toCollectorContext(ctx, request, {
      riskResult: partialRisk,
      routeDecision: partialRoute,
    }),
    "pre_decision",
  );

  stats.ai.called++;
  const t0 = Date.now();
  const parts = aiKeyParts(ctx);

  const aiPromise = gated(
    aiGate,
    plan.rank,
    plan.waitMs,
    () => analyzeWithAi(build),
    { onShed: () => ctx.degraded.push("ai_shed") },
  );

  const raced = await raceBudget(aiPromise, plan.aiBudgetMs);
  ctx.timings.ai = Date.now() - t0;

  if (!raced.done) {
    stats.ai.timeout++;
    ctx.degraded.push("ai_timeout");
    // الرد المتأخر مش هيتطبّق على الطلب ده، بس بنخزّنه للطلب الجاي
    void aiPromise.then((late) => {
      if (late?.ok) {
        void persistAiState({
          parts,
          ai: late,
          source: "pre",
          allowClear: true,
        });
      }
    });
    return { result: null, skipped: "ai_timeout" };
  }

  const res = raced.value;
  if (!res) {
    stats.ai.shed++;
    return { result: null, skipped: "ai_shed" };
  }
  if (!res.ok) {
    stats.ai.failed++;
    ctx.degraded.push(`ai_fail:${res.failReason ?? "unknown"}`);
    return { result: res, skipped: null };
  }

  stats.ai.ok++;
  void persistAiState({ parts, ai: res, source: "pre", allowClear: true });
  return { result: res, skipped: null };
}

function postDecisionRate(
  ctx: GatewayRuntimeContext,
  decision: string,
): number {
  if (ctx.jsChallenge?.passed || ctx.advancedChallenge?.passed) return 1;
  if (decision === "ALLOW") {
    return ctx.clearanceValid ? AI_POST_CLEARED_RATE : AI_POST_ALLOW_RATE;
  }
  if (decision === "CHALLENGE") return AI_POST_CHALLENGE_RATE;
  return 1; // BLOCK / RATE_LIMIT / MONITOR / فشل تحدي
}

/**
 * Phase 2 (post_decision) — بيتنادى من onResponse (بعد ما الرد خرج).
 * مفيش await عليه ومفيش تأخير لأي زائر. بيخلي الـ AI يتعلّم من النتيجة الفعلية
 * ويقدر يرجّع future (حتى لزائر عنده clearance → revalidate_clearance).
 */
function schedulePostDecisionAi(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: GatewayRuntimeContext,
): void {
  try {
    if (!AI_POST_ENABLED || !ctx.aiAllowed || ctx.shadow) return;
    const decision = ctx.finalDecision;
    if (!decision || !ctx.server?.id || ctx.signals.orgId === "unknown") return;
    if (ctx.lane === "light") return;
    if (simulationAiScore(ctx) != null) return;

    const rate = postDecisionRate(ctx, decision);
    if (rate <= 0 || (rate < 1 && Math.random() >= rate)) return;

    const rank = clampInt(ctx.intake?.priorityRank ?? 3, 0, 3);
    const hint = ctx.load?.hint ?? "low";
    if ((hint === "critical" && rank >= 1) || (hint === "high" && rank >= 2)) {
      stats.ai.postDropped++;
      return;
    }

    const originResult =
      decision === "ALLOW" || decision === "MONITOR"
        ? reply.statusCode >= 500
          ? "error"
          : "success"
        : "not_reached";

    const previousAi: PreviousAiContext | null = ctx.ai?.ok
      ? {
          anomaly_score: ctx.ai.anomalyScore,
          recommendation: ctx.ai.recommendation,
          future_action: ctx.ai.future?.action ?? null,
          model_version: ctx.ai.modelVersion,
          decided_at: new Date().toISOString(),
        }
      : ctx.aiState.previous;

    const baseCtx = toCollectorContext(ctx, request, {
      riskResult: ctx.riskResult as RiskResult | null,
      routeDecision: ctx.routeDecision,
      policyDecision: ctx.policyDecision?.action ?? null,
      actualAction: String(decision).toLowerCase(),
      aiAnomalyScore: ctx.ai?.ok ? ctx.ai.anomalyScore : null,
      previousAi,
      server: {
        load: ctx.load?.loadPercent ?? null,
        hint: ctx.load?.hint ?? null,
        originStatusCode: reply.statusCode,
        originLatencyMs: Date.now() - ctx.startTime,
        originResult,
      },
    });
    const outcome = {
      ...buildGatewayOutcomeFromContext(baseCtx),
      ai_model_version: ctx.ai?.modelVersion ?? null,
    };
    const build = collectAiBuild(
      { ...baseCtx, gatewayOutcome: outcome },
      "post_decision",
    );

    const parts = aiKeyParts(ctx);
    stats.ai.post++;
    void aiGate
      .run(rank, 0, () => analyzeWithAi(build))
      .then((r) => {
        if (!r.ok) {
          stats.ai.postDropped++;
          return;
        }
        if (r.value.ok) {
          void persistAiState({
            parts,
            ai: r.value,
            source: "post",
            allowClear: false,
          });
        }
      })
      .catch(() => {
        stats.ai.postDropped++;
      });
  } catch (err) {
    request.log.debug({ err }, "post-decision ai skipped");
  }
}

// ======================================================
// Assess — IP-Rep ∥ Backend-Rep ∥ AI → Risk → Router → Policy → Merge
// ------------------------------------------------------
// بيرجّع قرار من غير أي side effect (مفيش ban/تحدي/forward) —
// فيتستخدم في المسار الحي وفي الـ shadow بتاع MONITOR_ONLY.
// ======================================================

interface AssessParams {
  request: FastifyRequest;
  ctx: GatewayRuntimeContext;
  orgId: string;
  banned: boolean;
  monitorOnly: boolean;
  jsEnabled: boolean;
  jsPassedStage: boolean;
  companyPolicy: Partial<CompanyPolicy> | null;
  rl: RateLimitResult;
  plan: RequestPlan;
}

type Assessment =
  | { kind: "rep_banned"; permanent: boolean; minutes: number | null }
  | {
      kind: "ok";
      risk: RiskResult;
      routeDecision: RouteDecision;
      policyDecision: PolicyDecision;
      gatewayPath: GatewayPlannedPath;
      merge: AiMergeInfo;
    };

async function assessRequest(p: AssessParams): Promise<Assessment> {
  const { request, ctx, orgId, plan } = p;
  const t0 = Date.now();
  const headers = request.headers as Record<
    string,
    string | string[] | undefined
  >;

  // 1) IP-Rep (كاش Redis غالبًا) — بوابة مستقلة
  const ipRepP: Promise<IpReputationResult | null> = plan.useIpRep
    ? gated(
        ipGate,
        plan.rank,
        plan.waitMs,
        () =>
          inspectIpReputation({
            ip: ctx.signals.ip,
            organizationId: orgId,
            deviceFingerprint: ctx.signals.deviceFingerprint,
            ja3: ctx.signals.ja3,
            ja4: ctx.signals.ja4,
            headers,
            useBackend: false,
          }),
        {
          onShed: () => ctx.degraded.push("ip_rep_shed"),
          onError: (err) => request.log.debug({ err }, "ip reputation skipped"),
        },
      )
    : Promise.resolve(null);

  const ipRepStage = ipRepP.then((v) => {
    ctx.ipReputation = v;
    ctx.timings.ipRep = Date.now() - t0;
    return v;
  });

  // 2) Backend reputation — بالتوازي مع IP-Rep (مستقلين)
  const repP: Promise<ReputationLookupData | null> = plan.useBackendRep
    ? gated(
        repGate,
        plan.rank,
        plan.waitMs,
        () =>
          lookupReputation({
            organizationId: orgId,
            ipAddress: ctx.signals.ip,
            deviceFingerprint: ctx.signals.deviceFingerprint ?? undefined,
            ja3Fingerprint: ctx.signals.ja3 ?? undefined,
            ja4Fingerprint: ctx.signals.ja4 ?? undefined,
          }),
        {
          onShed: () => ctx.degraded.push("backend_rep_shed"),
          onError: (err) =>
            request.log.debug({ err }, "reputation lookup skipped"),
        },
      ).then((v) => {
        ctx.timings.rep = Date.now() - t0;
        return v;
      })
    : Promise.resolve(null);

  // 3) AI Phase 1 — بيبدأ أول ما IP-Rep يخلص (مش بيستنى Backend-Rep)
  const aiStage: Promise<AiOutcome> = plan.useAi
    ? ipRepStage
        .then(() =>
          runAiPhase1({
            request,
            ctx,
            companyPolicy: p.companyPolicy,
            plan,
          }),
        )
        .catch(
          (): AiOutcome => ({ result: null, skipped: "ai_error" }),
        )
    : Promise.resolve({
        result: null,
        skipped: plan.aiSkipReason ?? "ai_skipped",
      });

  // 4) Backend reputation: لو محظور فعليًا نخرج فورًا (الـ AI يكمل في الخلفية)
  const rep = await repP;
  if (rep?.effective.isCurrentlyBanned && !p.monitorOnly) {
    return {
      kind: "rep_banned",
      permanent: rep.effective.banStatus === "PERMANENT",
      minutes: rep.effective.minutesLeftOnBan ?? null,
    };
  }

  let failedChallengesFromRep = 0;
  let badIpFromRep = false;
  let banHistory: BanHistorySnapshot | undefined;
  if (rep) {
    failedChallengesFromRep = rep.effective.failedChecksCount ?? 0;
    badIpFromRep =
      rep.effective.isKnownBotnet || rep.effective.reputationRiskPoints >= 10;
    banHistory = {
      isBlacklisted: p.banned,
      isBanned: p.banned,
      banStatus: rep.effective.banStatus,
      priorFailures: rep.effective.failedChecksCount,
      reputationScore: rep.effective.score,
      knownBotnet: rep.effective.isKnownBotnet,
      allowlisted: rep.effective.isAllowlisted,
    };
    ctx.reputation = {
      ip: ctx.signals.ip,
      score: rep.effective.score,
      bannedUntil: rep.effective.bannedUntil
        ? Date.parse(rep.effective.bannedUntil)
        : null,
      isPermanent: rep.effective.banStatus === "PERMANENT",
      points: rep.effective.reputationRiskPoints,
    };
    ctx.backendRep = {
      score: rep.effective.score,
      failedChecks: rep.effective.failedChecksCount,
      knownBotnet: rep.effective.isKnownBotnet,
      riskPoints: rep.effective.reputationRiskPoints,
      allowlisted: rep.effective.isAllowlisted,
      banStatus: rep.effective.banStatus,
    };
  } else if (p.banned) {
    banHistory = { isBlacklisted: true, isBanned: true };
  }

  await ipRepStage;
  const aiOut = await aiStage;
  ctx.ai = aiOut.result;
  ctx.aiSkipped = aiOut.skipped;
  if (aiOut.skipped === "sim_override") stats.ai.simOverride++;
  else if (aiOut.skipped && aiOut.skipped !== "ai_disabled") stats.ai.skipped++;

  // 5) Risk النهائي من نفس الـ collector (AI + سجل الباك + IP + rate + fingerprint)
  const aiScore = aiOut.result?.ok ? aiOut.result.anomalyScore : null;
  const riskSignals = collectRiskSignals(
    toCollectorContext(ctx, request, {
      banHistory,
      aiAnomalyScore: aiScore,
    }),
  );
  if (badIpFromRep) {
    riskSignals.badIp = true;
    riskSignals.badIpScore = Math.max(riskSignals.badIpScore ?? 0, 0.7);
  }
  const risk = calculateRisk(riskSignals);
  ctx.riskResult = risk as unknown as RequestContext["riskResult"];

  const routeDecision = routeSuspicion({
    riskScore: risk.score,
    isBlacklisted: p.banned,
    policy: p.companyPolicy,
  });
  ctx.routeDecision = routeDecision;

  const policyDecision = decidePolicy(
    {
      riskScore: risk.score,
      failedChallenges: failedChallengesFromRep,
      maxRequestsExceeded: p.rl.maxRequestsExceeded,
    },
    p.companyPolicy,
  );
  ctx.policyDecision = policyDecision;

  // 6) المسار بدون AI → دمج future المخزّن + توصية AI
  const gatewayPath = planGatewayPath({
    banNow: p.banned && !p.monitorOnly,
    route: routeDecision,
    policy: policyDecision,
    rl: p.rl,
    riskScore: risk.score,
    jsEnabled: p.jsEnabled,
    jsPassedStage: p.jsPassedStage,
  });
  const { merge, futureApplied } = combineWithAi({
    gatewayPath,
    ai: aiOut.result,
    future: ctx.aiState.future,
  });
  ctx.aiMerge = merge;
  if (futureApplied) {
    ctx.futureActionApplied = futureApplied;
    stats.futureApplied++;
  }
  ctx.timings.assess = Date.now() - t0;

  return {
    kind: "ok",
    risk,
    routeDecision,
    policyDecision,
    gatewayPath,
    merge,
  };
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

  // انتهاء التحدي من غير حل = إشارة سلبية؛ الـ future (لو موجود) يفضل لحد TTL

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
// Health / Status (مشترك)
// ======================================================

function gatewayStatsSnapshot() {
  return {
    ...stats,
    ai: { ...stats.ai },
    gates: [aiGate.snapshot(), repGate.snapshot(), ipGate.snapshot()],
    loadTrackedServers: loadTracker.size(),
    flags: {
      aiEnabled: AI_ENABLED,
      aiBudgetMs: AI_BUDGET_MS,
      aiFutureBlockMode: AI_FUTURE_BLOCK_MODE,
      lightLane: LIGHT_LANE_ENABLED,
      shadowMonitor: SHADOW_MONITOR_ENABLED,
      postDecisionAi: AI_POST_ENABLED,
    },
  };
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

  // —— Sweeper + Capacity lifecycle
  app.addHook("onReady", async () => {
    try {
      getCapacityManager(); // يبدأ تقارير الصحة الدورية للباك
    } catch (err) {
      app.log.warn({ err }, "capacity manager failed to start");
    }

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
    closeCapacityManager();
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

    // Intake: تصنيف متزامن بدون I/O (أولوية + lane + خفيف/ثقيل)
    const intake = classifyIntake({
      method: request.method,
      path: pathname,
      host,
      headers: request.headers,
      ja4: signals.ja4,
      ja3: signals.ja3,
      deviceFingerprint: signals.deviceFingerprint,
      hasClearanceCookie: signals.hasClearance,
    });

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
      intake,
      lane: "full",
      load: null,
      aiAllowed: false,
      aiState: emptyAiState(),
      ai: null,
      aiSkipped: null,
      aiMerge: null,
      futureActionApplied: null,
      clearanceRevoked: false,
      clearanceValid: null,
      backendRep: null,
      sessionId: null,
      timings: {},
      degraded: [],
      shadow: false,
    };
  });

  app.addHook("onResponse", async (request, reply) => {
    const ctx = request.ctx as GatewayRuntimeContext | null;
    if (!ctx?.startTime) return;
    const ms = Date.now() - ctx.startTime;

    // Phase 2 في الخلفية بعد ما الرد خرج (مفيش await)
    schedulePostDecisionAi(request, reply, ctx);

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
        lane: ctx.lane,
        priority: ctx.intake?.priority,
        load: ctx.load?.hint,
        ai: ctx.ai?.ok ? ctx.ai.anomalyScore : null,
        aiRec: ctx.ai?.ok ? ctx.ai.recommendation : null,
        aiSkipped: ctx.aiSkipped,
        finalPath: ctx.aiMerge?.finalPath,
        mergeSource: ctx.aiMerge?.source,
        degraded: ctx.degraded.length > 0 ? ctx.degraded : undefined,
        timings: ctx.timings,
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
        gateway: gatewayStatsSnapshot(),
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

      // —— Agent heartbeat (WireGuard Agent → CapacityManager)
      internal.post("/agent/heartbeat", async (request, reply) => {
        const body = parseJsonBody<Record<string, unknown>>(request.body);
        const serverId =
          typeof body?.serverId === "string" ? body.serverId.trim() : "";
        const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : "";
        if (!body || !serverId || !orgId) {
          return reply.status(400).send({
            success: false,
            message: "serverId and orgId are required",
          });
        }
        const num = (v: unknown, lo: number, hi: number): number => {
          const n = Number(v);
          return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0;
        };
        try {
          await getCapacityManager().receiveAgentMetrics(serverId, orgId, {
            cpuPercent: num(body.cpuPercent, 0, 100),
            ramPercent: num(body.ramPercent, 0, 100),
            cpuCores: num(body.cpuCores, 0, 4096),
            ramTotalMb: num(body.ramTotalMb, 0, 10_000_000),
            connections: num(body.connections, 0, 10_000_000),
            agentRps: num(body.agentRps, 0, 10_000_000),
            latencyMs: num(body.latencyMs, 0, 1_000_000),
            tunnelUp: body.tunnelUp === true,
          });
        } catch (err) {
          request.log.warn({ err, serverId }, "agent heartbeat failed");
          return reply.status(503).send({
            success: false,
            message: "Unable to store agent metrics",
          });
        }
        return reply.send({ success: true });
      });

      internal.get<{ Params: { serverId: string } }>(
        "/capacity/:serverId",
        async (request, reply) => {
          const state = await getCapacityManager().getServerState(
            request.params.serverId,
          );
          if (!state) {
            return reply
              .status(404)
              .send({ success: false, message: "Server not registered" });
          }
          return reply.send({ success: true, data: state });
        },
      );

      internal.get("/status", async () => ({
        success: true,
        data: {
          service: "zero-plus-gateway",
          uptime: process.uptime(),
          probesRunning: runningProbes.size,
          maxConcurrentProbes: MAX_CONCURRENT_PROBES,
          challengeSweeper: { ...sweeperStats },
          policyCacheSize: policyCache.size,
          gateway: gatewayStatsSnapshot(),
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
    stats.requests++;

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
    const tResolve = Date.now();
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
      ctx.aiAllowed = isAiAllowedByPolicy(resolved.policy);

      // Capacity: حمل محلي متزامن + عدّاد Redis (fire-and-forget) للتقارير
      const maxRps =
        resolved.effectiveMaxServerRps ??
        resolved.server.maxRequestsPerSecond ??
        resolved.policy.maxServerRps ??
        null;
      ctx.load = loadTracker.hit(resolved.server.id, maxRps);
      if (CAPACITY_RECORD_ENABLED) {
        try {
          getCapacityManager().recordRequest(
            resolved.server.id,
            resolved.organizationId,
          );
        } catch {
          /* fail-open */
        }
      }

      if (stale) {
        request.log.warn(
          { host },
          "backend unreachable — using stale cached policy",
        );
        ctx.degraded.push("policy_stale");
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
    ctx.timings.resolve = Date.now() - tResolve;

    const orgId = ctx.signals.orgId;
    const aiParts = aiKeyParts(ctx);

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
      // سياق AI السابق للزائر (للتسجيل) — MGET واحد
      if (ctx.aiAllowed) ctx.aiState = await loadAiState(aiParts);

      const js = await handleJsChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      );
      ctx.jsChallenge = js;

      if (js.passed) {
        await resetChallengeFailCount(orgId, ctx.signals.ip);
        // التحدي اتحل → أي future تحدي مخزّن خلاص اتنفّذ
        clearAiFuture(aiParts);
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
      if (ctx.aiAllowed) ctx.aiState = await loadAiState(aiParts);

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
        clearAiFuture(aiParts);
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

    // 4) Ban list + حالة الـ AI (future/previous) بالتوازي
    //    Light Lane (أصول ثابتة/health بـ GET/HEAD): Ban فقط، من غير حالة AI.
    const lightLane =
      LIGHT_LANE_ENABLED &&
      ctx.intake?.isLightweight === true &&
      (ctx.signals.method === "GET" || ctx.signals.method === "HEAD");
    ctx.lane = lightLane ? "light" : "full";
    if (lightLane) stats.lightLane++;

    const tBan = Date.now();
    const [ban, aiState] = await Promise.all([
      checkBan({
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
      }),
      lightLane || !ctx.aiAllowed
        ? Promise.resolve(emptyAiState())
        : loadAiState(aiParts),
    ]);
    ctx.aiState = aiState;
    ctx.timings.ban = Date.now() - tBan;

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
    //    revalidate_clearance (future من AI) → نشيل الكوكي ونعيد الفحص كزائر جديد
    if (ctx.signals.hasClearance && ctx.signals.clearanceToken) {
      if (aiState.future?.action === "revalidate_clearance") {
        revokeClearance(reply);
        ctx.clearanceRevoked = true;
        ctx.signals.hasClearance = false;
        ctx.signals.clearanceToken = null;
        stats.clearanceRevoked++;
        // الـ future اتنفّذ — الطلب ده بيمشي مسار الفحص الكامل
        ctx.futureActionApplied = "revalidate_clearance";
        stats.futureApplied++;
        clearAiFuture(aiParts);
        ctx.aiState = { ...aiState, future: null };
      } else {
        const cleared = verifyClearanceFromRequest(request, {
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          bindIp: false,
          bindDevice: true,
        });
        if (cleared.valid) {
          ctx.clearanceValid = true;
          stats.clearedFastPath++;
          emitEvent(ctx, monitorOnly ? "MONITOR" : "ALLOW", { referer });
          await forwardToOrigin(request, reply, ctx);
          return reply;
        }
        ctx.clearanceValid = false;
        revokeClearance(reply);
        ctx.signals.hasClearance = false;
      }
    }

    // 5b) تحدي منتهي من غير حل → فشل (مسار احتياطي بجانب الـ sweeper)
    //     الحجز ذري: لو الـ sweeper سبق، checkAndConsume بترجع null ومفيش معالجة مرتين
    if (!monitorOnly && jsEnabled && !lightLane) {
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
    const grantAfterJsStage = () => {
      if (!jsPassedStage) return;
      clearJsPassCookie(reply);
      setClearanceCookie(reply, {
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        policy: backendPolicy,
      });
    };

    const runSilentJs = async () => {
      if (!jsEnabled) {
        emitEvent(ctx, "ALLOW", { referer });
        await forwardToOrigin(request, reply, ctx);
        return reply;
      }

      // الـ JS اتحل قبل كده (تحدي الكل) → ده التحدي المطلوب، نمنح clearance ونكمل
      if (jsPassedStage) {
        grantAfterJsStage();
        clearAiFuture(aiParts);
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
        clearAiFuture(aiParts);
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

    // 6) rate limit خفيف قبل challengeAll (حماية من الفيضان)
    const tRl = Date.now();
    const rlEarly = await checkRateLimit({
      organizationId: orgId,
      ip: ctx.signals.ip,
      deviceFingerprint: ctx.signals.deviceFingerprint,
      policy: backendPolicy,
    });
    ctx.rateLimit = rlEarly;
    ctx.timings.rate = Date.now() - tRl;
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

    // 7) Light Lane: Ban + Rate اتعملوا → Forward فوري
    //    (مفيش تحدي JS على css/js/صور، ومفيش AI ولا IP-Rep)
    if (lightLane) {
      emitEvent(ctx, monitorOnly ? "MONITOR" : "ALLOW", { referer });
      await forwardToOrigin(request, reply, ctx);
      return reply;
    }

    // 8) MONITOR_ONLY: Forward فوري + تحليل shadow في الخلفية (Risk/AI) يتسجل في الحدث
    if (monitorOnly) {
      if (SHADOW_MONITOR_ENABLED) {
        stats.shadowMonitor++;
        ctx.shadow = true;
        ctx.finalDecision = "MONITOR";
        const plan = planRequest(ctx);
        // shadow أقل أولوية من أي طلب حي: بدون انتظار في البوابات
        const shadowPlan: RequestPlan = { ...plan, rank: 3, waitMs: 0 };
        void assessRequest({
          request,
          ctx,
          orgId,
          banned: ban.banned,
          monitorOnly: true,
          jsEnabled,
          jsPassedStage,
          companyPolicy,
          rl: rlEarly,
          plan: shadowPlan,
        })
          .then((a) => {
            emitEvent(ctx, "MONITOR", {
              referer,
              details: {
                shadow: true,
                wouldDo: a.kind === "ok" ? a.merge.finalPath : "rep_banned",
                gatewayPath: a.kind === "ok" ? a.gatewayPath : null,
              },
            });
          })
          .catch((err) => {
            request.log.debug({ err }, "shadow assess failed");
            emitEvent(ctx, "MONITOR", { referer });
          });
      } else {
        emitEvent(ctx, "MONITOR", { referer });
      }
      await forwardToOrigin(request, reply, ctx);
      return reply;
    }

    // 9) تحدي الكل: قرار سريع بدون انتظار risk/reputation/ip-api
    //    تحدي الكل: JS الأول. لو عدّى (jsPassedStage) نكمل على Risk/Router/Policy
    if (challengeAll && !jsPassedStage) {
      stats.challengeAllFast++;
      // تسخين كاش IP-Rep في الخلفية: الطلب الجاي (بعد حل التحدي) هيلاقيه جاهز
      void gated(ipGate, 3, 0, () =>
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
        }),
      );
      return runSilentJs();
    }

    // 10) Assess: IP-Rep ∥ Backend-Rep ∥ AI Phase 1 → Risk → Router → Policy → Merge
    const plan = planRequest(ctx);
    const assessment = await assessRequest({
      request,
      ctx,
      orgId,
      banned: ban.banned,
      monitorOnly: false,
      jsEnabled,
      jsPassedStage,
      companyPolicy,
      rl: rlEarly,
      plan,
    });

    if (assessment.kind === "rep_banned") {
      await applyBan({
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        permanent: assessment.permanent,
        banMinutes: assessment.minutes ?? 120,
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

    const { risk, routeDecision, policyDecision, merge } = assessment;
    const rl = rlEarly;

    request.log.info(
      {
        host,
        orgId,
        risk: risk.score,
        route: routeDecision.route,
        policy: policyDecision.action,
        gatewayPath: assessment.gatewayPath,
        finalPath: merge.finalPath,
        mergeSource: merge.source,
        mergeNote: merge.note,
        rl: rl.level,
        ipKind: ctx.ipReputation?.kind,
        jsEnabled,
        challengeAll,
        simulation: ctx.simulation != null,
        simulationRejected: ctx.simulationRejected,
        priority: ctx.intake?.priority,
        load: ctx.load?.hint,
        ai: ctx.ai?.ok ? ctx.ai.anomalyScore : null,
        aiRec: ctx.ai?.ok ? ctx.ai.recommendation : null,
        aiSkipped: ctx.aiSkipped,
        autoBanAfterFails: companyPolicy?.autoBanAfterFails,
        temporaryBanMinutes: companyPolicy?.temporaryBanMinutes,
        timings: ctx.timings,
      },
      "pipeline decision",
    );

    // 11) تنفيذ القرار

    // AI طلب سحب التصريح: نتأكد إن الكوكي اتشال والزائر يتعامل كزائر جديد
    if (
      merge.mustRevokeClearance &&
      !ctx.clearanceRevoked &&
      ctx.signals.hasClearance
    ) {
      revokeClearance(reply);
      ctx.clearanceRevoked = true;
      stats.clearanceRevoked++;
    }

    // (أ) حظر الجتواي (route/policy/blacklist) — نفس السلوك القديم
    const policyBan =
      policyDecision.action === "permanent_ban" ||
      policyDecision.action === "temporary_ban";
    if (policyBan || routeDecision.route === "ban") {
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

    // (ب) future "block" من AI بإعداد ban صريح (GATEWAY_AI_FUTURE_BLOCK=ban)
    if (merge.finalPath === "ban") {
      await applyBan({
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        banMinutes: companyPolicy?.temporaryBanMinutes ?? 120,
        reason: "ai_future_block",
        source: "gateway",
      });
      emitEvent(ctx, "BLOCK", { referer });
      return reply.status(403).send({
        success: false,
        error: "Access Denied",
        reason: "ai_future_block",
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
        clearAiFuture(aiParts);
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

    const forwardWith = async (decision: "ALLOW" | "MONITOR") => {
      // وصلنا للسماح النهائي: لو كان تحدي الكل، نمنح الـ clearance دلوقتي
      grantAfterJsStage();
      emitEvent(ctx, decision, { referer });
      await forwardToOrigin(request, reply, ctx);
      return reply;
    };

    // (ج) المسار النهائي بعد دمج AI + future — تحدي واحد فقط لكل طلب
    switch (merge.finalPath) {
      case "advanced_fingerprint_check":
        return runAdvanced();

      case "silent_js_challenge":
        if (jsEnabled) {
          if (
            routeDecision.route === "rate_limit_with_challenge" &&
            !jsPassedStage
          ) {
            reply.header("Retry-After", String(rl.windows.softSec));
          }
          return runSilentJs();
        }
        break;

      case "rate_limit": {
        const afterChallenge =
          jsPassedStage &&
          routeDecision.route === "rate_limit_with_challenge" &&
          rl.softExceeded;
        if (afterChallenge) {
          // اتعمله تحدي بالفعل: ريت ليميت بس لو فعلًا تخطى الحد الناعم
          emitEvent(ctx, "RATE_LIMIT", { referer });
          reply.header("Retry-After", String(rl.windows.softSec));
          return reply.status(429).send({
            success: false,
            error: "Too Many Requests",
            reason: "soft_rate_limit_after_challenge",
            requestId: ctx.id,
          });
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
        // توصية AI بـ rate_limit: بنقيّد فعليًا لو الزائر قريب من الحد، وإلا مراقبة فقط
        if (rl.softExceeded || rl.highRequestRate) {
          emitEvent(ctx, "RATE_LIMIT", { referer });
          reply.header("Retry-After", String(rl.windows.softSec));
          return reply.status(429).send({
            success: false,
            error: "Too Many Requests",
            reason: "ai_rate_limit",
            requestId: ctx.id,
          });
        }
        return forwardWith("MONITOR");
      }

      case "monitor":
        return forwardWith("MONITOR");

      default:
        break;
    }

    // مسار الـ policy القديم لو الـ router خلّاه يعدّي (JS متعطل مثلاً)
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

    return forwardWith("ALLOW");
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, async () => {
      try {
        // نوقف الـ sweeper والطلبات الأول، وبعدين نفرّغ طابور الأحداث
        await app.close();
        await flushEventLogger();
        closeCapacityManager();
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