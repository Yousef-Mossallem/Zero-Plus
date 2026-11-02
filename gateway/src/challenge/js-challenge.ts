// ======================================================
// ZERO PLUS GATEWAY — challenge/js-challenge.ts
// ------------------------------------------------------
// تحدّي JS صامت + challenge-token (مرة واحدة / HMAC / Redis)
//
//   1) issue → توكن + تسجيل «تحدي مفتوح» في Redis + فهرس انتهاء
//   2) HTML/سكربت صامت يجمع إشارات ويرسل POST
//   3) verify → consume توكن + proof + suspicion
//   4) نجاح → مسح المفتوح + app يصدر clearance
//   5) فشل حل / انتهاء المدة من غير حل → failed/expired + app يحسب السياسة
//
// انتهاء المدة (بدون الاعتماد على طلب جديد من الزائر):
//   - markChallengeOpen عند الإصدار: يكتب السجل + يضيف المفتاح في فهرس
//     مرتب بوقت الانتهاء (ZSET: zp:chal:exp)
//   - claimExpiredOpenChallenges: يستدعيه تايمر في app.ts كل ~10 ثواني،
//     يجيب كل التحديات المنتهية ويحجزها (مرة واحدة لكل تحدي)
//   - checkAndConsumeExpiredOpenChallenge: المسار القديم على الطلبات التالية،
//     بيستخدم نفس الحجز، فمفيش تحدي يتعالج مرتين
//
// الحجز (claim) = Lua atomic: يمسح المفتاح بس لو لسه نفس السجل
//   → التايمر + الطلبات + أكتر من instance للجيتواي = معالجة واحدة بس
//
// ------------------------------------------------------
// فرع المحاكاة الموثوق (Simulation Lab):
//   - app.ts هو اللي يتحقق من توكن المحاكاة، ويمرّر القرار جاهز في
//     ctx.simulation = { trusted, js: 'pass' | 'fail' | 'skip' }
//   - الملف ده مبيقراش أي هيدر (X-ZP-Sim-JS أو غيره) بنفسه أبداً
//   - بيشتغل قبل أي إصدار HTML / توكن / Redis، فمفيش صفحة تحدي ولا pending
//
//     js = 'pass' → phase 'passed'  / passed=true  (app يصدر clearance زي النجاح الحقيقي)
//     js = 'fail' → phase 'failed'  / passed=false (فشل حقيقي: isJsChallengeHardFailure = true)
//     js = 'skip' → phase 'skipped' / passed=false (لا نجاح ولا فشل، ولا clearance)
//
//   - trusted من غير js (أو js مش معروف) → المسار العادي بالكامل
//   - مسار الزائر الحقيقي (توكن مرة واحدة، حدود الزمن، الإشارات، replay) مفيش فيه أي تغيير
//   - الملف نتيجة تحدٍ فقط: مبيتخطاش ban ولا rate limit (دول في app.ts)
// ======================================================

import { randomBytes, randomInt } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { OrgPolicyFromBackend } from "../services/backend.client";
import { getRedis } from "../services/redis.client";
import {
  issueChallengeToken,
  verifyChallengeToken,
  extractTokenFromRequest,
  telemetryFromVerify,
  type VerifyChallengeTokenResult,
} from "./challenge-token";

// ------------------------------------------------------
// إعدادات
// ------------------------------------------------------

const DEFAULT_TTL_SEC = Number(process.env.JS_CHALLENGE_TTL_SEC ?? 1);
const MIN_SOLVE_MS = 80;
const MAX_SOLVE_MS = 90_000;
/** حد أدنى بين إعادة إصدار تحدي لنفس IP (ضد السبام) */
const REISSUE_COOLDOWN_MS = Number(process.env.JS_CHALLENGE_REISSUE_MS ?? 1500);
const OPEN_KEY_PREFIX = "zp:chal:open:";
/** فهرس مرتب بوقت الانتهاء (score = expAt بالـ ms، member = مفتاح التحدي المفتوح) */
const EXP_INDEX_KEY = "zp:chal:exp";
/** هامش بعد انتهاء التحدي عشان الـ sweeper / checkExpired يلحق يقرأ المفتاح */
const OPEN_GRACE_SEC = 90;
/** أقصى عدد تحديات منتهية يتحجزوا في دورة sweeper واحدة */
const SWEEP_DEFAULT_LIMIT = 100;

/** مدة حل وهمية معقولة للمحاكاة (مش صفر ولا خيالية): بين 450ms و 2.4s */
const SIM_SOLVE_MIN_MS = 450;
const SIM_SOLVE_MAX_MS = 2_400;

/**
 * حجز ذري: يمسح المفتاح فقط لو لسه بنفس المحتوى اللي قريناه.
 * بيمنع حالتين:
 *   - اتنين (sweeper + طلب جديد) يعالجوا نفس التحدي
 *   - مسح تحدي جديد اتصدر على نفس org:ip بعد ما قريتنا القديم
 */
const CLAIM_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

export const EXPECTED_API_PATH = "/.well-known/zeroplus/challenge/js";

export interface JsChallengePolicySlice {
  enableJsChallenge?: boolean;
  challengeAllVisitors?: boolean;
  passTokenTtlMinutes?: number;
}

/** قرار المحاكاة الخاص بتحدي JS (جاي جاهز من app.ts بعد التحقق من التوكن) */
export type JsSimulationDirective = "pass" | "fail" | "skip";

/**
 * سياق المحاكاة الموثوقة.
 * - trusted: app.ts اتأكد من توكن المحاكاة (بدون ده الفرع كله بيتجاهل)
 * - js: pass | fail | skip (قيمة X-ZP-Sim-JS بعد ما app يتحقق منها)
 * - runId: معرّف الـ Run للتتبع فقط (اختياري)
 */
export interface JsChallengeSimulationContext {
  trusted: boolean;
  js?: JsSimulationDirective | string | null;
  runId?: string | null;
}

export interface JsChallengeContext {
  organizationId: string;
  ip: string;
  host: string;
  path: string;
  userAgent: string | null;
  deviceFingerprint: string | null;
  ja4: string | null;
  ja3: string | null;
  requestId: string;
  policy?:
    | Partial<JsChallengePolicySlice>
    | Partial<OrgPolicyFromBackend>
    | null;
  /** محاكاة موثوقة (من app.ts فقط). مفيش قراءة هيدرز هنا. */
  simulation?: JsChallengeSimulationContext | null;
}

export interface JsChallengeTelemetry {
  challengeId: string;
  organizationId: string;
  ip: string;
  host: string;
  path: string;
  userAgent: string | null;
  edgeJa4: string | null;
  edgeJa3: string | null;
  serverDeviceFp: string | null;
  issuedAt: number;
  solvedAt: number | null;
  solveDurationMs: number | null;
  passed: boolean;
  failReasons: string[];
  suspicionHints: string[];
  localSuspicionScore: number;
  browser: BrowserProbePayload | null;
  /** انتهاء مدة من غير حل */
  expired?: boolean;
  /** نتيجة اصطناعية من Simulation Lab (من غير متصفح ولا HTML) */
  simulation?: boolean;
  /** قرار المحاكاة اللي طلّع النتيجة دي */
  simulationMode?: JsSimulationDirective;
  /** معرّف الـ Run للتتبع (اختياري) */
  simulationRunId?: string | null;
  token?: {
    valid: boolean;
    reason?: string;
    jti?: string | null;
    ipChanged?: boolean;
    hints?: string[];
  };
}

export interface BrowserProbePayload {
  v: number;
  challengeId: string;
  challengeToken?: string;
  t0: number;
  t1: number;
  nav: {
    ua: string;
    lang: string;
    languages: string[];
    platform: string;
    hardwareConcurrency: number;
    deviceMemory: number | null;
    maxTouchPoints: number;
    webdriver: boolean;
    cookieEnabled: boolean;
    doNotTrack: string | null;
    vendor: string;
    pluginsLength: number;
  };
  screen: {
    w: number;
    h: number;
    aw: number;
    ah: number;
    cd: number;
    pxRatio: number;
  };
  webgl: { vendor: string; renderer: string; ok: boolean };
  canvasHash: string;
  audioHash: string;
  perf: { now: number; timingGap: number; mathChaos: number };
  behavior: {
    moveSamples: number;
    scrollSamples: number;
    keySamples: number;
    visibilityMs: number;
  };
  consistency: {
    uaPlatformMatch: boolean;
    touchDesktopMismatch: boolean;
    webdriverOn: boolean;
    noPluginsHeadless: boolean;
    zeroConcurrency: boolean;
  };
  proof: { nonce: string; work: string; rounds: number };
}

export type JsChallengePhase =
  | "issue"
  | "passed"
  | "failed"
  | "expired"
  | "disabled"
  | "error"
  /** محاكاة موثوقة بقرار skip: مفيش تحدي اتنفذ (لا نجاح ولا فشل ولا clearance) */
  | "skipped";

export interface JsChallengeResult {
  phase: JsChallengePhase;
  passed: boolean;
  telemetry: JsChallengeTelemetry;
  responseSent?: boolean;
  /** النتيجة جاية من فرع المحاكاة الموثوق (مش من متصفح حقيقي) */
  simulated?: boolean;
}

export interface OpenChallengeRecord {
  challengeId: string;
  organizationId: string;
  ip: string;
  host: string;
  path: string;
  jti: string | null;
  issuedAt: number;
  /** unix ms — بعده يُعتبر انتهاء من غير حل */
  expAt: number;
  ttlSec: number;
  /** بيانات الطلب الأصلي — لازمة لبناء حدث الانتهاء من الـ sweeper */
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  ja3?: string | null;
  ja4?: string | null;
}

/** عنصر راجع من claimExpiredOpenChallenges */
export interface ExpiredChallengeItem {
  rec: OpenChallengeRecord;
  result: JsChallengeResult;
}

// ------------------------------------------------------
// Redis: تحدي مفتوح / انتهاء
// ------------------------------------------------------

function openKey(organizationId: string, ip: string): string {
  return `${OPEN_KEY_PREFIX}${organizationId}:${ip}`;
}

export function resolveChallengeTtlSec(
  policy?: JsChallengeContext["policy"],
): number {
  const fromEnv = DEFAULT_TTL_SEC;
  // لا نخلط مع passTokenTtlMinutes (ده للكليارنس) — التحدي أقصر
  void policy;
  return Math.max(30, Math.min(600, fromEnv || 120));
}

/** عند الإصدار: سجّل تحدي مفتوح + أضفه لفهرس الانتهاء */
export async function markChallengeOpen(
  rec: OpenChallengeRecord,
): Promise<void> {
  try {
    const ttl = Math.max(
      OPEN_GRACE_SEC,
      Math.ceil((rec.expAt - Date.now()) / 1000) + OPEN_GRACE_SEC,
    );
    const key = openKey(rec.organizationId, rec.ip);
    const r = getRedis();
    await r.set(key, JSON.stringify(rec), "EX", ttl);
    // لو نفس org:ip اتصدر له تحدي جديد، الـ score بيتحدث لوقت الانتهاء الجديد
    await r.zadd(EXP_INDEX_KEY, rec.expAt, key);
  } catch {
    /* ignore */
  }
}

/**
 * نجاح أو فشل حل: امسح التحدي المفتوح + الفهرس.
 * يرجع true لو كان فيه تحدي مفتوح فعلاً اتمسح (false = اتحجز قبل كده أو مش موجود)
 */
export async function clearChallengeOpen(
  organizationId: string,
  ip: string,
): Promise<boolean> {
  try {
    const key = openKey(organizationId, ip);
    const r = getRedis();
    const deleted = await r.del(key);
    await r.zrem(EXP_INDEX_KEY, key);
    return Number(deleted) > 0;
  } catch {
    return false;
  }
}

export async function getOpenChallenge(
  organizationId: string,
  ip: string,
): Promise<OpenChallengeRecord | null> {
  try {
    const raw = await getRedis().get(openKey(organizationId, ip));
    if (!raw) return null;
    return JSON.parse(raw) as OpenChallengeRecord;
  } catch {
    return null;
  }
}

/**
 * يحجز السجل المفتوح مرة واحدة (Lua atomic).
 * true = إحنا اللي حجزناه ومسؤولين عن معالجة الانتهاء.
 */
async function claimOpenRecord(key: string, raw: string): Promise<boolean> {
  try {
    const r = getRedis();
    const n = await r.eval(CLAIM_LUA, 1, key, raw);
    if (Number(n) === 1) {
      await r.zrem(EXP_INDEX_KEY, key);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** نتيجة 'expired' جاهزة من سجل تحدي مفتوح انتهت مدته */
function buildExpiredResult(
  rec: OpenChallengeRecord,
  now: number,
): JsChallengeResult {
  return {
    phase: "expired",
    passed: false,
    telemetry: emptyTelemetry({
      challengeId: rec.challengeId,
      organizationId: rec.organizationId,
      ip: rec.ip,
      host: rec.host,
      path: rec.path,
      userAgent: rec.userAgent ?? null,
      edgeJa4: rec.ja4 ?? null,
      edgeJa3: rec.ja3 ?? null,
      serverDeviceFp: rec.deviceFingerprint ?? null,
      issuedAt: rec.issuedAt,
      solvedAt: now,
      solveDurationMs: Math.max(0, now - rec.issuedAt),
      passed: false,
      expired: true,
      failReasons: ["challenge_timeout"],
      suspicionHints: ["no_solve_within_ttl"],
      localSuspicionScore: 0.7,
      token: { valid: false, reason: "expired", jti: rec.jti },
    }),
  };
}

/**
 * لو في تحدي مفتوح وانتهت مدته من غير حل → يحجزه ويرجع نتيجة expired
 * يُستدعى من app.ts على الطلبات العادية (مسار احتياطي بجانب الـ sweeper).
 * لو الـ sweeper حجزه قبل كده → يرجع null (مفيش معالجة مرتين).
 */
export async function checkAndConsumeExpiredOpenChallenge(
  organizationId: string,
  ip: string,
): Promise<JsChallengeResult | null> {
  try {
    const key = openKey(organizationId, ip);
    const raw = await getRedis().get(key);
    if (!raw) return null;

    const rec = JSON.parse(raw) as OpenChallengeRecord;
    const now = Date.now();
    if (now < rec.expAt) {
      // لسه ضمن المهلة — لا تفشل
      return null;
    }

    if (!(await claimOpenRecord(key, raw))) return null;
    return buildExpiredResult(rec, now);
  } catch {
    return null;
  }
}

/**
 * للـ sweeper (تايمر في app.ts): كل التحديات اللي انتهت من غير حل.
 * كل تحدي بيرجع مرة واحدة بس (محجوز)، ومفتاحه بيتمسح من Redis والفهرس.
 */
export async function claimExpiredOpenChallenges(
  limit: number = SWEEP_DEFAULT_LIMIT,
): Promise<ExpiredChallengeItem[]> {
  const out: ExpiredChallengeItem[] = [];
  try {
    const r = getRedis();
    const keys = await r.zrangebyscore(
      EXP_INDEX_KEY,
      0,
      Date.now(),
      "LIMIT",
      0,
      Math.max(1, limit),
    );

    for (const key of keys) {
      const raw = await r.get(key);
      if (!raw) {
        // التحدي اتحل/اتمسح أو المفتاح انتهى → نظّف الفهرس
        await r.zrem(EXP_INDEX_KEY, key);
        continue;
      }

      let rec: OpenChallengeRecord;
      try {
        rec = JSON.parse(raw) as OpenChallengeRecord;
      } catch {
        await r.del(key);
        await r.zrem(EXP_INDEX_KEY, key);
        continue;
      }

      const now = Date.now();
      // اتصدر تحدي جديد على نفس org:ip (الـ score اتحدث) → لسه ضمن المهلة
      if (now < rec.expAt) continue;

      if (!(await claimOpenRecord(key, raw))) continue;
      out.push({ rec, result: buildExpiredResult(rec, now) });
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** هل في تحدي لسه صالح (مش منتهي)؟ */
export async function hasActiveOpenChallenge(
  organizationId: string,
  ip: string,
): Promise<boolean> {
  const rec = await getOpenChallenge(organizationId, ip);
  if (!rec) return false;
  return Date.now() < rec.expAt;
}

// ------------------------------------------------------

function emptyTelemetry(
  partial: Partial<JsChallengeTelemetry>,
): JsChallengeTelemetry {
  return {
    challengeId: "",
    organizationId: "",
    ip: "",
    host: "",
    path: "",
    userAgent: null,
    edgeJa4: null,
    edgeJa3: null,
    serverDeviceFp: null,
    issuedAt: Date.now(),
    solvedAt: null,
    solveDurationMs: null,
    passed: false,
    failReasons: [],
    suspicionHints: [],
    localSuspicionScore: 0,
    browser: null,
    expired: false,
    ...partial,
  };
}

function newChallengeId(): string {
  return randomBytes(16).toString("hex");
}

// ------------------------------------------------------
// Simulation (موثوق فقط — القرار جاي جاهز من app.ts)
// ------------------------------------------------------

/**
 * يحوّل قيمة قرار المحاكاة (من app بعد التحقق) لـ pass | fail | skip.
 * أي قيمة تانية (أو فاضية) = null → المسار العادي.
 */
export function normalizeSimJsDirective(
  value: unknown,
): JsSimulationDirective | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "pass" || v === "fail" || v === "skip") return v;
  return null;
}

/** هل الطلب ده محاكاة موثوقة وجاي معاها قرار صريح لتحدي JS؟ */
export function isTrustedSimulationJs(
  ctx: Pick<JsChallengeContext, "simulation">,
): boolean {
  return (
    ctx.simulation?.trusted === true &&
    normalizeSimJsDirective(ctx.simulation.js) !== null
  );
}

/** هل النتيجة اتخطّت (محاكاة بقرار skip)؟ لا نجاح ولا فشل ولا clearance */
export function isJsChallengeSkipped(r: JsChallengeResult): boolean {
  return r.phase === "skipped";
}

/**
 * نتيجة تحدي اصطناعية من غير HTML ولا توكن ولا Redis.
 * - pass → نجاح (app يصدر clearance زي النجاح الحقيقي)
 * - fail → فشل حقيقي (يدخل isJsChallengeHardFailure فيتحسب سمعة/ban عند app واللوجر)
 * - skip → لا تحدي اتنفذ (مفيش clearance)
 *
 * بتنادي clearChallengeOpen في pass/fail زي الأثر الجانبي الحقيقي
 * (لو كان في تحدي مفتوح قديم على نفس org:ip).
 */
export async function resolveSimulatedJsChallenge(
  ctx: JsChallengeContext,
  directive: JsSimulationDirective,
): Promise<JsChallengeResult> {
  const now = Date.now();
  const challengeId = `sim_${randomBytes(8).toString("hex")}`;
  const runId = ctx.simulation?.runId ?? null;

  const base: Partial<JsChallengeTelemetry> = {
    challengeId,
    organizationId: ctx.organizationId,
    ip: ctx.ip,
    host: ctx.host,
    path: ctx.path,
    userAgent: ctx.userAgent,
    edgeJa4: ctx.ja4,
    edgeJa3: ctx.ja3,
    serverDeviceFp: ctx.deviceFingerprint,
    browser: null,
    expired: false,
    simulation: true,
    simulationMode: directive,
    simulationRunId: runId,
  };

  if (directive === "skip") {
    // لا نجاح ولا فشل: مفيش تحدي اتنفذ، ومفيش مسح لتحدي مفتوح، ومفيش clearance
    return {
      phase: "skipped",
      passed: false,
      simulated: true,
      telemetry: emptyTelemetry({
        ...base,
        issuedAt: now,
        solvedAt: null,
        solveDurationMs: null,
        passed: false,
        failReasons: [],
        suspicionHints: ["synthetic_simulation", "simulation_js_skipped"],
        localSuspicionScore: 0,
        token: { valid: false, reason: "simulation_skip", jti: null },
      }),
    };
  }

  // pass | fail: مدة حل وهمية معقولة (مش صفر ولا خيالية)
  const solveDurationMs = randomInt(SIM_SOLVE_MIN_MS, SIM_SOLVE_MAX_MS + 1);
  const issuedAt = now - solveDurationMs;

  // نفس أثر الحل الحقيقي: اقفل أي تحدي مفتوح قديم (best-effort)
  await clearChallengeOpen(ctx.organizationId, ctx.ip);

  if (directive === "pass") {
    return {
      phase: "passed",
      passed: true,
      simulated: true,
      telemetry: emptyTelemetry({
        ...base,
        issuedAt,
        solvedAt: now,
        solveDurationMs,
        passed: true,
        failReasons: [],
        suspicionHints: ["synthetic_simulation", "simulation_forced_pass"],
        localSuspicionScore: 0.02,
        token: {
          valid: true,
          jti: null,
          hints: ["simulation_trusted"],
        },
      }),
    };
  }

  // directive === 'fail'
  return {
    phase: "failed",
    passed: false,
    simulated: true,
    telemetry: emptyTelemetry({
      ...base,
      issuedAt,
      solvedAt: now,
      solveDurationMs,
      passed: false,
      failReasons: ["simulation_forced_fail"],
      suspicionHints: ["synthetic_simulation", "simulation_forced_fail"],
      localSuspicionScore: 0.9,
      token: {
        valid: true,
        jti: null,
        hints: ["simulation_trusted"],
      },
    }),
  };
}

function buildClientScript(params: {
  challengeId: string;
  nonce: string;
  rounds: number;
  postUrl: string;
  challengeToken: string;
}): string {
  const { challengeId, nonce, rounds, postUrl, challengeToken } = params;
  return `(()=>{
var CID=${JSON.stringify(challengeId)};
var NONCE=${JSON.stringify(nonce)};
var ROUNDS=${rounds};
var URL=${JSON.stringify(postUrl)};
var CTOK=${JSON.stringify(challengeToken)};
var t0=Date.now();
function canvasHash(){try{var c=document.createElement("canvas");c.width=240;c.height=60;var g=c.getContext("2d");if(!g)return "none";g.textBaseline="top";g.font="14px Arial";g.fillStyle="#f60";g.fillRect(0,0,240,60);g.fillStyle="#069";g.fillText("zp:"+CID.slice(0,8),4,4);g.fillStyle="rgba(0,12,255,0.4)";g.fillText(navigator.userAgent.slice(0,24),4,28);return String(c.toDataURL().length)+":"+c.toDataURL().slice(-32);}catch(e){return "err";}}
function webglInfo(){try{var c=document.createElement("canvas");var gl=c.getContext("webgl")||c.getContext("experimental-webgl");if(!gl)return{vendor:"",renderer:"",ok:false};var d=gl.getExtension("WEBGL_debug_renderer_info");return{vendor:d?String(gl.getParameter(d.UNMASKED_VENDOR_WEBGL)):"",renderer:d?String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)):"",ok:true};}catch(e){return{vendor:"",renderer:"",ok:false};}}
function audioHash(){return new Promise(function(res){try{var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return res("noac");var ctx=new AC();var o=ctx.createOscillator();var a=ctx.createAnalyser();var g=ctx.createGain();o.type="triangle";o.frequency.value=1e4;g.gain.value=0;o.connect(a);a.connect(g);g.connect(ctx.destination);o.start(0);setTimeout(function(){var arr=new Float32Array(a.frequencyBinCount);a.getFloatFrequencyData(arr);o.stop();ctx.close();var s=0;for(var i=0;i<arr.length;i+=16)s+=Math.abs(arr[i]||0);res(String(s.toFixed(3)));},40);}catch(e){res("err");}});}
function mathChaos(){var x=0;for(var i=0;i<2500;i++)x+=Math.sin(i)*Math.tan(i%9+0.1);return x;}
var moves=0,scrolls=0,keys=0,vis=0,visT=Date.now();
document.addEventListener("mousemove",function(){moves++;},{passive:true});
document.addEventListener("scroll",function(){scrolls++;},{passive:true});
document.addEventListener("keydown",function(){keys++;},{passive:true});
document.addEventListener("visibilitychange",function(){if(document.hidden)vis+=Date.now()-visT;visT=Date.now();});
function proofWork(){var x=NONCE+":"+CID;for(var i=0;i<ROUNDS;i++){var s=x+i;var h=0;for(var j=0;j<s.length;j++){h=((h<<5)-h)+s.charCodeAt(j);h|=0;}x=String(h)+s.length;}return x;}
setTimeout(function(){
  var t1=Date.now();
  var wg=webglInfo();
  var nav={
    ua:navigator.userAgent||"",
    lang:navigator.language||"",
    languages:navigator.languages?Array.from(navigator.languages):[],
    platform:navigator.platform||"",
    hardwareConcurrency:navigator.hardwareConcurrency||0,
    deviceMemory:navigator.deviceMemory||null,
    maxTouchPoints:navigator.maxTouchPoints||0,
    webdriver:!!navigator.webdriver,
    cookieEnabled:!!navigator.cookieEnabled,
    doNotTrack:navigator.doNotTrack||null,
    vendor:navigator.vendor||"",
    pluginsLength:(navigator.plugins&&navigator.plugins.length)||0
  };
  var screenObj={
    w:screen.width,h:screen.height,aw:screen.availWidth,ah:screen.availHeight,
    cd:screen.colorDepth||0,pxRatio:window.devicePixelRatio||1
  };
  var cons={
    uaPlatformMatch:!(/Win/.test(nav.ua)&&/Linux/.test(nav.platform)),
    touchDesktopMismatch:(nav.maxTouchPoints>0&&screenObj.w>=1200&&!(/Mobile|Android|iPhone/.test(nav.ua))),
    webdriverOn:nav.webdriver===true,
    noPluginsHeadless:nav.pluginsLength===0&&!/Mobile|Android|iPhone/.test(nav.ua),
    zeroConcurrency:nav.hardwareConcurrency===0
  };
  Promise.resolve(audioHash()).then(function(ah){
    var payload={
      v:1,challengeId:CID,challengeToken:CTOK,t0:t0,t1:t1,
      nav:nav,screen:screenObj,webgl:wg,canvasHash:canvasHash(),audioHash:ah,
      perf:{now:(performance&&performance.now)?performance.now():0,timingGap:t1-t0,mathChaos:mathChaos()},
      behavior:{moveSamples:moves,scrollSamples:scrolls,keySamples:keys,visibilityMs:vis},
      consistency:cons,
      proof:{nonce:NONCE,work:proofWork(),rounds:ROUNDS}
    };
    fetch(URL,{
      method:"POST",
      headers:{
        "content-type":"application/json",
        "x-zp-challenge":"js",
        "x-zp-challenge-token":CTOK
      },
      body:JSON.stringify(payload),
      credentials:"same-origin",
      keepalive:true
    }).catch(function(){});
  });
},120);
})();`;
}

function buildChallengeHtml(script: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title></title></head><body><script>${script}</script></body></html>`;
}

function isPayload(x: unknown): x is BrowserProbePayload {
  if (!x || typeof x !== "object") return false;
  const o = x as BrowserProbePayload;
  return (
    o.v === 1 &&
    typeof o.challengeId === "string" &&
    typeof o.t0 === "number" &&
    typeof o.t1 === "number" &&
    o.nav != null &&
    o.proof != null
  );
}

function scoreSuspicion(
  p: BrowserProbePayload,
  solveMs: number,
): { score: number; hints: string[]; fails: string[] } {
  const hints: string[] = [];
  const fails: string[] = [];
  let score = 0;

  if (p.nav.webdriver) {
    score += 0.45;
    hints.push("webdriver_true");
    fails.push("webdriver");
  }
  if (p.consistency.zeroConcurrency) {
    score += 0.2;
    hints.push("zero_hw_concurrency");
  }
  if (p.consistency.noPluginsHeadless) {
    score += 0.15;
    hints.push("no_plugins_desktop");
  }
  if (!p.webgl.ok) {
    score += 0.1;
    hints.push("webgl_missing");
  }
  if (/headless|phantom|electron/i.test(p.nav.ua)) {
    score += 0.25;
    hints.push("ua_automation");
  }
  if (solveMs < MIN_SOLVE_MS) {
    score += 0.35;
    hints.push("solved_too_fast");
    fails.push("too_fast");
  }
  if (solveMs > MAX_SOLVE_MS) {
    fails.push("too_slow");
  }
  if (p.proof.work.length < 4) {
    fails.push("bad_proof");
    score += 0.5;
  }
  if (
    p.behavior.moveSamples === 0 &&
    p.behavior.scrollSamples === 0 &&
    p.nav.webdriver
  ) {
    score += 0.2;
    hints.push("no_input_webdriver");
  }

  score = Math.max(0, Math.min(1, score));
  return { score, hints, fails };
}

function verifyProof(
  p: BrowserProbePayload,
  expectedNonce: string,
  rounds: number,
): boolean {
  if (p.proof.nonce !== expectedNonce) return false;
  if (p.proof.rounds !== rounds) return false;
  let x = `${expectedNonce}:${p.challengeId}`;
  for (let i = 0; i < rounds; i++) {
    const s = x + i;
    let h = 0;
    for (let j = 0; j < s.length; j++) {
      h = ((h << 5) - h + s.charCodeAt(j)) | 0;
    }
    x = String(h) + s.length;
  }
  return p.proof.work === x;
}

// ------------------------------------------------------
// API
// ------------------------------------------------------

export function isJsChallengeResponse(request: FastifyRequest): boolean {
  const path = request.url.split("?")[0] || "";
  if (
    path === EXPECTED_API_PATH ||
    path.endsWith("/.well-known/zeroplus/challenge/js")
  ) {
    return request.method === "POST";
  }
  if (request.headers["x-zp-challenge"] === "js" && request.method === "POST") {
    return true;
  }
  return false;
}

export async function issueJsChallenge(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: JsChallengeContext,
): Promise<JsChallengeResult> {
  const enabled =
    ctx.policy == null ||
    (ctx.policy as JsChallengePolicySlice).enableJsChallenge !== false;

  if (!enabled) {
    return {
      phase: "disabled",
      passed: true,
      telemetry: emptyTelemetry({
        organizationId: ctx.organizationId,
        ip: ctx.ip,
        host: ctx.host,
        path: ctx.path,
        passed: true,
      }),
    };
  }

  const ttlSec = resolveChallengeTtlSec(ctx.policy);
  const now = Date.now();

  // لو في تحدي لسه ساري — أعد نفس المهلة منطقيًا بدون سبام توكنات
  const existing = await getOpenChallenge(ctx.organizationId, ctx.ip);
  if (existing && now < existing.expAt) {
    if (now - existing.issuedAt < REISSUE_COOLDOWN_MS) {
      // إعادة إرسال صفحة بسيطة بدون توكن جديد (السكربت القديم انتهى من العميل)
      // نصدر توكن جديد فقط لو مضى cooldown — هنا نمنع الفيضان
    }
  }

  const challengeId = newChallengeId();
  const nonce = randomBytes(12).toString("hex");
  const rounds = 400 + (randomBytes(1)[0]! % 200);
  const issuedAt = now;
  const expAt = issuedAt + ttlSec * 1000;

  const issued = await issueChallengeToken({
    organizationId: ctx.organizationId,
    kind: "js",
    ip: ctx.ip,
    deviceFingerprint: ctx.deviceFingerprint,
    host: ctx.host,
    path: ctx.path,
    ttlSec,
    requestId: ctx.requestId,
    bind: {
      challengeId,
      nonce,
      rounds,
      issuedAt,
    },
  });

  await markChallengeOpen({
    challengeId,
    organizationId: ctx.organizationId,
    ip: ctx.ip,
    host: ctx.host,
    path: ctx.path,
    jti: issued.payload.jti ?? null,
    issuedAt,
    expAt,
    ttlSec,
    // بيانات الطلب الأصلي لحدث الانتهاء
    userAgent: ctx.userAgent,
    deviceFingerprint: ctx.deviceFingerprint,
    ja3: ctx.ja3,
    ja4: ctx.ja4,
  });

  const script = buildClientScript({
    challengeId,
    nonce,
    rounds,
    postUrl: EXPECTED_API_PATH,
    challengeToken: issued.token,
  });
  const html = buildChallengeHtml(script);

  reply
    .status(401)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("x-zp-challenge", "js")
    .header("x-zp-challenge-id", challengeId)
    .header("x-zp-challenge-token", issued.token)
    .header("x-zp-challenge-ttl", String(ttlSec))
    .send(html);

  return {
    phase: "issue",
    passed: false,
    responseSent: true,
    telemetry: emptyTelemetry({
      challengeId,
      organizationId: ctx.organizationId,
      ip: ctx.ip,
      host: ctx.host,
      path: ctx.path,
      userAgent: ctx.userAgent,
      edgeJa4: ctx.ja4,
      edgeJa3: ctx.ja3,
      serverDeviceFp: ctx.deviceFingerprint,
      issuedAt,
      passed: false,
      suspicionHints: ["challenge_issued"],
      token: {
        valid: true,
        jti: issued.payload.jti,
      },
    }),
  };
}

export async function verifyJsChallengeResponse(
  request: FastifyRequest,
  ctx: JsChallengeContext,
): Promise<JsChallengeResult> {
  let body: unknown = request.body;
  if (Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString("utf8"));
    } catch {
      body = null;
    }
  }

  if (!isPayload(body)) {
    return {
      phase: "failed",
      passed: false,
      telemetry: emptyTelemetry({
        organizationId: ctx.organizationId,
        ip: ctx.ip,
        host: ctx.host,
        path: ctx.path,
        failReasons: ["malformed_payload"],
        localSuspicionScore: 1,
      }),
    };
  }

  const tokenStr =
    extractTokenFromRequest(request) ||
    (typeof body.challengeToken === "string" ? body.challengeToken : "") ||
    "";

  const tokenResult: VerifyChallengeTokenResult = await verifyChallengeToken({
    token: tokenStr,
    organizationId: ctx.organizationId,
    kind: "js",
    ip: ctx.ip,
    deviceFingerprint: ctx.deviceFingerprint,
    host: ctx.host,
    bindIp: false,
    bindDevice: true,
    consume: true,
    expectedBind: {
      challengeId: body.challengeId,
      nonce: body.proof.nonce,
      rounds: body.proof.rounds,
    },
  });

  const tokenMeta = telemetryFromVerify(ctx.organizationId, "js", tokenResult);
  const failReasons: string[] = [];
  const suspicionHints: string[] = [...(tokenResult.hints || [])];

  if (!tokenResult.valid) {
    const reason = tokenResult.reason || "invalid";
    failReasons.push(`token_${reason}`);
    // توكن منتهي = فشل انتهاء إن أمكن
    const expired = reason === "expired" || reason === "not_found";

    if (expired) {
      // false = الـ sweeper (أو طلب تاني) كان حجز التحدي وسجّل انتهاءه قبل ما
      // الرد المتأخر ده يوصل → نعلّم الـ hint عشان يتعرف إن ده مش أول فشل
      const hadOpen = await clearChallengeOpen(ctx.organizationId, ctx.ip);
      if (!hadOpen) suspicionHints.push("late_after_expiry_reported");
    }

    return {
      phase: expired ? "expired" : "failed",
      passed: false,
      telemetry: emptyTelemetry({
        challengeId: body.challengeId,
        organizationId: ctx.organizationId,
        ip: ctx.ip,
        host: ctx.host,
        path: ctx.path,
        userAgent: ctx.userAgent,
        edgeJa4: ctx.ja4,
        edgeJa3: ctx.ja3,
        serverDeviceFp: ctx.deviceFingerprint,
        failReasons,
        suspicionHints,
        localSuspicionScore: 0.95,
        expired,
        browser: body,
        token: {
          valid: false,
          reason: tokenResult.reason,
          jti: tokenMeta.jti,
          ipChanged: tokenMeta.ipChanged,
          hints: tokenMeta.hints,
        },
      }),
    };
  }

  const bind = tokenResult.bind || {};
  const expectedNonce = String(bind.nonce ?? body.proof.nonce);
  const expectedRounds = Number(bind.rounds ?? body.proof.rounds);
  const issuedAt = Number(bind.issuedAt ?? Date.now());
  const challengeIdFromBind = String(bind.challengeId ?? body.challengeId);

  if (challengeIdFromBind !== body.challengeId) {
    failReasons.push("challenge_id_mismatch");
  }
  if (!verifyProof(body, expectedNonce, expectedRounds)) {
    failReasons.push("proof_mismatch");
  }
  if (tokenResult.ipChanged) {
    suspicionHints.push("ip_changed_during_challenge");
  }

  const solvedAt = Date.now();
  const solveDurationMs = Math.max(0, solvedAt - issuedAt);
  const { score, hints, fails } = scoreSuspicion(body, solveDurationMs);
  suspicionHints.push(...hints);
  failReasons.push(...fails);

  const passed = failReasons.length === 0 && score < 0.75;

  // نجاح أو فشل الحل → اقفل التحدي المفتوح (ويتشال من فهرس الانتهاء)
  await clearChallengeOpen(ctx.organizationId, ctx.ip);

  const telemetry: JsChallengeTelemetry = {
    challengeId: body.challengeId,
    organizationId: ctx.organizationId,
    ip: ctx.ip,
    host: ctx.host,
    path: ctx.path,
    userAgent: ctx.userAgent,
    edgeJa4: ctx.ja4,
    edgeJa3: ctx.ja3,
    serverDeviceFp: ctx.deviceFingerprint,
    issuedAt,
    solvedAt,
    solveDurationMs,
    passed,
    failReasons,
    suspicionHints,
    localSuspicionScore: score,
    browser: body,
    expired: false,
    token: {
      valid: true,
      jti: tokenResult.payload?.jti ?? null,
      ipChanged: tokenResult.ipChanged,
      hints: tokenResult.hints,
    },
  };

  return {
    phase: passed ? "passed" : "failed",
    passed,
    telemetry,
  };
}

export async function handleJsChallenge(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: JsChallengeContext,
): Promise<JsChallengeResult> {
  try {
    // فرع مبكر: محاكاة موثوقة (app.ts اتأكد من التوكن ومرر القرار جاهز).
    // قبل أي إصدار HTML / توكن / Redis / تحقق POST.
    // محاكاة من غير قرار js صالح → المسار العادي بالكامل (مفيش تخمين).
    if (ctx.simulation?.trusted === true) {
      const directive = normalizeSimJsDirective(ctx.simulation.js);
      if (directive) {
        return await resolveSimulatedJsChallenge(ctx, directive);
      }
    }

    if (isJsChallengeResponse(request)) {
      return await verifyJsChallengeResponse(request, ctx);
    }
    return await issueJsChallenge(request, reply, ctx);
  } catch (err) {
    return {
      phase: "error",
      passed: false,
      telemetry: emptyTelemetry({
        organizationId: ctx.organizationId,
        ip: ctx.ip,
        host: ctx.host,
        path: ctx.path,
        failReasons: ["internal_error"],
        suspicionHints: [(err as Error).message || "error"],
      }),
    };
  }
}

/**
 * هل النتيجة فشل تحدي حقيقي (حل مرفوض أو انتهاء)؟
 * للاستخدام من event-logger / app
 *
 * ملاحظة: فشل المحاكاة الاصطناعي (phase 'failed' + simulation_forced_fail)
 * بيدخل تحت failed، فبيتعامل كفشل حقيقي عند اللوجر والسمعة.
 * 'skipped' و 'issue' و 'disabled' و 'passed' مش فشل.
 */
export function isJsChallengeHardFailure(r: JsChallengeResult): boolean {
  if (r.passed) return false;
  return r.phase === "failed" || r.phase === "expired" || r.phase === "error";
}

export function telemetryForAi(
  t: JsChallengeTelemetry,
): Record<string, unknown> {
  return {
    kind: "js_challenge_telemetry",
    challengeId: t.challengeId,
    organizationId: t.organizationId,
    ip: t.ip,
    host: t.host,
    path: t.path,
    passed: t.passed,
    expired: t.expired === true,
    // true لما النتيجة اصطناعية من Simulation Lab (من غير متصفح)
    simulation: t.simulation === true,
    simulationMode: t.simulationMode ?? null,
    simulationRunId: t.simulationRunId ?? null,
    localSuspicionScore: t.localSuspicionScore,
    failReasons: t.failReasons,
    suspicionHints: t.suspicionHints,
    solveDurationMs: t.solveDurationMs,
    edge: { ja4: t.edgeJa4, ja3: t.edgeJa3, deviceFp: t.serverDeviceFp },
    token: t.token ?? null,
    browser: t.browser,
  };
}

// ------------------------------------------------------
export {
  DEFAULT_TTL_SEC,
  MIN_SOLVE_MS,
  MAX_SOLVE_MS,
  SIM_SOLVE_MIN_MS,
  SIM_SOLVE_MAX_MS,
  OPEN_KEY_PREFIX,
  EXP_INDEX_KEY,
  buildClientScript,
  buildChallengeHtml,
  verifyProof,
  scoreSuspicion,
  isPayload,
  newChallengeId,
};

export default {
  handleJsChallenge,
  issueJsChallenge,
  verifyJsChallengeResponse,
  isJsChallengeResponse,
  checkAndConsumeExpiredOpenChallenge,
  claimExpiredOpenChallenges,
  markChallengeOpen,
  clearChallengeOpen,
  getOpenChallenge,
  hasActiveOpenChallenge,
  isJsChallengeHardFailure,
  isJsChallengeSkipped,
  isTrustedSimulationJs,
  normalizeSimJsDirective,
  resolveSimulatedJsChallenge,
  telemetryForAi,
  EXPECTED_API_PATH,
  DEFAULT_TTL_SEC,
  MIN_SOLVE_MS,
  MAX_SOLVE_MS,
};