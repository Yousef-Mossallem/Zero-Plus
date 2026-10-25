// ======================================================
// ZERO PLUS GATEWAY — challenge/js-challenge.ts
// ------------------------------------------------------
// تحدّي JS صامت متقدم (خلفية — الزائر البشري نادرًا ما يلاحظ)
//
// الفكرة:
//   1) السيرفر يصدر challenge-token لمرة واحدة (Redis / ذاكرة)
//   2) يرد بصفحة/سكربت خفيف يشتغل في الخلفية
//   3) المتصفح يجمع إشارات سلوكية + بيئة تشغيل
//   4) POST النتيجة + التوقيع الزمني
//   5) السيرفر يتحقق: توكن، توقيت، اتساق الإشارات
//   6) نجاح → clearance cookie | فشل → فشل تحدي
//   7) كل الحمولة تُصدَّر لـ AI (حتى بعد النجاح)
//
// مش CAPTCHA ظاهر. مش “alert”. مسار صامت قدر الإمكان.
// ======================================================

import { createHash, randomBytes, createHmac } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { getRedis } from '../services/redis.client'
import { config } from '../config'
import type { OrgPolicyFromBackend } from '../services/backend.client'

// ------------------------------------------------------
// إعدادات
// ------------------------------------------------------

const TOKEN_PREFIX = 'zp:chal:js:'
const DEFAULT_TTL_SEC = 120
const MIN_SOLVE_MS = 80          // أسرع من كده غالبًا بوت/سكربت
const MAX_SOLVE_MS = 90_000      // أبطأ = توكن منتهي عمليًا
const EXPECTED_API_PATH = '/.well-known/zeroplus/challenge/js'

export interface JsChallengePolicySlice {
  enableJsChallenge?: boolean
  challengeAllVisitors?: boolean
  passTokenTtlMinutes?: number
}

export interface JsChallengeContext {
  organizationId: string
  ip: string
  host: string
  path: string
  userAgent: string | null
  deviceFingerprint: string | null
  ja4: string | null
  ja3: string | null
  requestId: string
  policy?: Partial<JsChallengePolicySlice> | Partial<OrgPolicyFromBackend> | null
}

/** كل ما يتجمّع من المتصفح + السيرفر — يروح للـ AI */
export interface JsChallengeTelemetry {
  // --- سيرفر ---
  challengeId: string
  organizationId: string
  ip: string
  host: string
  path: string
  userAgent: string | null
  edgeJa4: string | null
  edgeJa3: string | null
  serverDeviceFp: string | null
  issuedAt: number
  solvedAt: number | null
  solveDurationMs: number | null

  // --- نتيجة التحقق ---
  passed: boolean
  failReasons: string[]
  suspicionHints: string[]
  /** 0..1 تقديري قبل الـ AI */
  localSuspicionScore: number

  // --- من المتصفح (الحمولة) ---
  browser: BrowserProbePayload | null
}

export interface BrowserProbePayload {
  v: number
  challengeId: string
  // وقت
  t0: number
  t1: number
  // navigator / شاشة
  nav: {
    ua: string
    lang: string
    languages: string[]
    platform: string
    hardwareConcurrency: number
    deviceMemory: number | null
    maxTouchPoints: number
    webdriver: boolean
    cookieEnabled: boolean
    doNotTrack: string | null
    vendor: string
    pluginsLength: number
  }
  screen: {
    w: number
    h: number
    aw: number
    ah: number
    cd: number
    pxRatio: number
  }
  // WebGL
  webgl: {
    vendor: string
    renderer: string
    ok: boolean
  }
  // Canvas hash (مختصر)
  canvasHash: string
  // Audio hash مختصر
  audioHash: string
  // أداء / توقيت
  perf: {
    now: number
    timingGap: number
    mathChaos: number
  }
  // سلوك خفيف
  behavior: {
    moveSamples: number
    scrollSamples: number
    keySamples: number
    visibilityMs: number
  }
  // اتساق
  consistency: {
    uaPlatformMatch: boolean
    touchDesktopMismatch: boolean
    webdriverOn: boolean
    noPluginsHeadless: boolean
    zeroConcurrency: boolean
  }
  // إثبات عمل JS حقيقي
  proof: {
    nonce: string
    work: string
    rounds: number
  }
}

export type JsChallengePhase =
  | 'issue'          // لازم نرجع سكربت التحدي
  | 'passed'         // نجح
  | 'failed'         // فشل
  | 'disabled'       // السياسة موقّفة JS
  | 'error'

export interface JsChallengeResult {
  phase: JsChallengePhase
  passed: boolean
  telemetry: JsChallengeTelemetry
  /** لو phase=issue — الرد اتبعت للعميل */
  responseSent?: boolean
}

// ------------------------------------------------------
// Token store (Redis)
// ------------------------------------------------------

interface StoredChallenge {
  organizationId: string
  ip: string
  nonce: string
  issuedAt: number
  host: string
  /** proof target rounds */
  rounds: number
}

async function saveChallenge(id: string, data: StoredChallenge, ttlSec: number) {
  const r = getRedis()
  await r.set(TOKEN_PREFIX + id, JSON.stringify(data), 'EX', ttlSec)
}

async function loadChallenge(id: string): Promise<StoredChallenge | null> {
  const r = getRedis()
  const raw = await r.get(TOKEN_PREFIX + id)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredChallenge
  } catch {
    return null
  }
}

async function consumeChallenge(id: string): Promise<StoredChallenge | null> {
  const r = getRedis()
  const key = TOKEN_PREFIX + id
  const raw = await r.get(key)
  if (!raw) return null
  await r.del(key) // مرة واحدة
  try {
    return JSON.parse(raw) as StoredChallenge
  } catch {
    return null
  }
}

// ------------------------------------------------------
// إصدار / صفحة التحدي
// ------------------------------------------------------

function newChallengeId(): string {
  return randomBytes(16).toString('hex')
}

function workHash(nonce: string, challengeId: string, rounds: number): string {
  let x = `${nonce}:${challengeId}`
  for (let i = 0; i < rounds; i++) {
    x = createHash('sha256').update(x + i).digest('hex')
  }
  return x
}

/**
 * سكربت العميل — مدمج، صامت، يجمع إشارات ويرسلها
 */
function buildClientScript(params: {
  challengeId: string
  nonce: string
  rounds: number
  postUrl: string
}): string {
  const { challengeId, nonce, rounds, postUrl } = params
  // سكربت واحد IIFE — بدون مكتبات
  return `(()=>{
var CID=${JSON.stringify(challengeId)};
var NONCE=${JSON.stringify(nonce)};
var ROUNDS=${rounds};
var URL=${JSON.stringify(postUrl)};
var t0=Date.now();
function h(s){var a=new TextEncoder().encode(s);return crypto.subtle?crypto.subtle.digest("SHA-256",a).then(function(b){return Array.from(new Uint8Array(b)).map(function(x){return x.toString(16).padStart(2,"0")}).join("")}) : Promise.resolve(String(s.length));}
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
      v:1,challengeId:CID,t0:t0,t1:t1,
      nav:nav,screen:screenObj,webgl:wg,canvasHash:canvasHash(),audioHash:ah,
      perf:{now:(performance&&performance.now)?performance.now():0,timingGap:t1-t0,mathChaos:mathChaos()},
      behavior:{moveSamples:moves,scrollSamples:scrolls,keySamples:keys,visibilityMs:vis},
      consistency:cons,
      proof:{nonce:NONCE,work:proofWork(),rounds:ROUNDS}
    };
    fetch(URL,{method:"POST",headers:{"content-type":"application/json","x-zp-challenge":"js"},body:JSON.stringify(payload),credentials:"same-origin",keepalive:true}).catch(function(){});
  });
},120);
})();`
}

function buildChallengeHtml(script: string): string {
  // صفحة شبه فارغة — سكربت فقط (صامت)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title></title></head><body><script>${script}</script></body></html>`
}

function emptyTelemetry(partial: Partial<JsChallengeTelemetry>): JsChallengeTelemetry {
  return {
    challengeId: '',
    organizationId: '',
    ip: '',
    host: '',
    path: '',
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
    ...partial,
  }
}

// ------------------------------------------------------
// تحقق من حمولة المتصفح
// ------------------------------------------------------

function isPayload(x: unknown): x is BrowserProbePayload {
  if (!x || typeof x !== 'object') return false
  const o = x as BrowserProbePayload
  return (
    o.v === 1 &&
    typeof o.challengeId === 'string' &&
    typeof o.t0 === 'number' &&
    typeof o.t1 === 'number' &&
    o.nav != null &&
    o.proof != null
  )
}

function scoreSuspicion(p: BrowserProbePayload, solveMs: number): {
  score: number
  hints: string[]
  fails: string[]
} {
  const hints: string[] = []
  const fails: string[] = []
  let score = 0

  if (p.nav.webdriver) {
    score += 0.45
    hints.push('webdriver_true')
    fails.push('webdriver')
  }
  if (p.consistency.zeroConcurrency) {
    score += 0.2
    hints.push('zero_hw_concurrency')
  }
  if (p.consistency.noPluginsHeadless) {
    score += 0.15
    hints.push('no_plugins_desktop')
  }
  if (!p.webgl.ok) {
    score += 0.1
    hints.push('webgl_missing')
  }
  if (solveMs < MIN_SOLVE_MS) {
    score += 0.35
    hints.push('solved_too_fast')
    fails.push('too_fast')
  }
  if (solveMs > MAX_SOLVE_MS) {
    fails.push('too_slow')
  }
  if (p.proof.work.length < 4) {
    fails.push('bad_proof')
    score += 0.5
  }
  // بوتات بسيطة: مفيش أي تفاعل ومفيش webgl + webdriver
  if (
    p.behavior.moveSamples === 0 &&
    p.behavior.scrollSamples === 0 &&
    p.nav.webdriver
  ) {
    score += 0.2
    hints.push('no_input_webdriver')
  }

  score = Math.max(0, Math.min(1, score))
  return { score, hints, fails }
}

function verifyProof(p: BrowserProbePayload, expectedNonce: string, rounds: number): boolean {
  if (p.proof.nonce !== expectedNonce) return false
  if (p.proof.rounds !== rounds) return false
  // إعادة حساب work بنفس خوارزمية العميل (32-bit string chain)
  let x = `${expectedNonce}:${p.challengeId}`
  for (let i = 0; i < rounds; i++) {
    const s = x + i
    let h = 0
    for (let j = 0; j < s.length; j++) {
      h = ((h << 5) - h + s.charCodeAt(j)) | 0
    }
    x = String(h) + s.length
  }
  return p.proof.work === x
}

// ------------------------------------------------------
// API العامة
// ------------------------------------------------------

/**
 * هل هذا طلب رد على التحدي؟
 */
export function isJsChallengeResponse(request: FastifyRequest): boolean {
  const path = (request.url.split('?')[0] || '')
  if (path === EXPECTED_API_PATH || path.endsWith('/.well-known/zeroplus/challenge/js')) {
    return request.method === 'POST'
  }
  if (request.headers['x-zp-challenge'] === 'js' && request.method === 'POST') {
    return true
  }
  return false
}

/**
 * إصدار تحدّي: يكتب HTML+سكربت صامت
 */
export async function issueJsChallenge(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: JsChallengeContext,
): Promise<JsChallengeResult> {
  const enabled =
    ctx.policy == null ||
    (ctx.policy as JsChallengePolicySlice).enableJsChallenge !== false

  if (!enabled) {
    return {
      phase: 'disabled',
      passed: true,
      telemetry: emptyTelemetry({
        organizationId: ctx.organizationId,
        ip: ctx.ip,
        host: ctx.host,
        path: ctx.path,
        passed: true,
      }),
    }
  }

  const challengeId = newChallengeId()
  const nonce = randomBytes(12).toString('hex')
  const rounds = 400 + (randomBytes(1)[0]! % 200) // 400..599
  const issuedAt = Date.now()

  await saveChallenge(
    challengeId,
    {
      organizationId: ctx.organizationId,
      ip: ctx.ip,
      nonce,
      issuedAt,
      host: ctx.host,
      rounds,
    },
    DEFAULT_TTL_SEC,
  )

  const postUrl = EXPECTED_API_PATH
  const script = buildClientScript({ challengeId, nonce, rounds, postUrl })
  const html = buildChallengeHtml(script)

  reply
    .status(401)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('x-zp-challenge', 'js')
    .header('x-zp-challenge-id', challengeId)
    .send(html)

  return {
    phase: 'issue',
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
      failReasons: [],
      suspicionHints: ['challenge_issued'],
    }),
  }
}

/**
 * التحقق من POST القادم من السكربت
 */
export async function verifyJsChallengeResponse(
  request: FastifyRequest,
  ctx: JsChallengeContext,
): Promise<JsChallengeResult> {
  let body: unknown = request.body
  if (Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString('utf8'))
    } catch {
      body = null
    }
  }

  if (!isPayload(body)) {
    return {
      phase: 'failed',
      passed: false,
      telemetry: emptyTelemetry({
        organizationId: ctx.organizationId,
        ip: ctx.ip,
        host: ctx.host,
        path: ctx.path,
        failReasons: ['malformed_payload'],
        localSuspicionScore: 1,
      }),
    }
  }

  const stored = await consumeChallenge(body.challengeId)
  if (!stored) {
    return {
      phase: 'failed',
      passed: false,
      telemetry: emptyTelemetry({
        challengeId: body.challengeId,
        organizationId: ctx.organizationId,
        ip: ctx.ip,
        failReasons: ['unknown_or_replayed_token'],
        browser: body,
        localSuspicionScore: 0.9,
      }),
    }
  }

  const solvedAt = Date.now()
  const solveDurationMs = Math.max(0, solvedAt - stored.issuedAt)
  const failReasons: string[] = []
  const suspicionHints: string[] = []

  if (stored.organizationId !== ctx.organizationId) {
    failReasons.push('org_mismatch')
  }
  // IP bind مرن: نسجّل تلميح فقط (CGNAT / موبايل)
  if (stored.ip !== ctx.ip) {
    suspicionHints.push('ip_changed_during_challenge')
  }
  if (!verifyProof(body, stored.nonce, stored.rounds)) {
    failReasons.push('proof_mismatch')
  }

  const { score, hints, fails } = scoreSuspicion(body, solveDurationMs)
  suspicionHints.push(...hints)
  failReasons.push(...fails)

  const passed = failReasons.length === 0 && score < 0.75

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
    issuedAt: stored.issuedAt,
    solvedAt,
    solveDurationMs,
    passed,
    failReasons,
    suspicionHints,
    localSuspicionScore: score,
    browser: body,
  }

  return {
    phase: passed ? 'passed' : 'failed',
    passed,
    telemetry,
  }
}

/**
 * نقطة واحدة لـ app: إما يصدر أو يتحقق
 */
export async function handleJsChallenge(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: JsChallengeContext,
): Promise<JsChallengeResult> {
  try {
    if (isJsChallengeResponse(request)) {
      return await verifyJsChallengeResponse(request, ctx)
    }
    return await issueJsChallenge(request, reply, ctx)
  } catch (err) {
    return {
      phase: 'error',
      passed: false,
      telemetry: emptyTelemetry({
        organizationId: ctx.organizationId,
        ip: ctx.ip,
        host: ctx.host,
        path: ctx.path,
        failReasons: ['internal_error'],
        suspicionHints: [(err as Error).message || 'error'],
      }),
    }
  }
}

/** تلخيص جاهز لـ AI client */
export function telemetryForAi(t: JsChallengeTelemetry): Record<string, unknown> {
  return {
    kind: 'js_challenge_telemetry',
    challengeId: t.challengeId,
    organizationId: t.organizationId,
    ip: t.ip,
    host: t.host,
    path: t.path,
    passed: t.passed,
    localSuspicionScore: t.localSuspicionScore,
    failReasons: t.failReasons,
    suspicionHints: t.suspicionHints,
    solveDurationMs: t.solveDurationMs,
    edge: { ja4: t.edgeJa4, ja3: t.edgeJa3, deviceFp: t.serverDeviceFp },
    browser: t.browser,
  }
}

// ------------------------------------------------------
// تصدير شامل
// ------------------------------------------------------

export {
  EXPECTED_API_PATH,
  DEFAULT_TTL_SEC,
  MIN_SOLVE_MS,
  MAX_SOLVE_MS,
  TOKEN_PREFIX,
  buildClientScript,
  buildChallengeHtml,
  verifyProof,
  scoreSuspicion,
  isPayload,
  workHash,
  newChallengeId,
}

export default {
  handleJsChallenge,
  issueJsChallenge,
  verifyJsChallengeResponse,
  isJsChallengeResponse,
  telemetryForAi,
  EXPECTED_API_PATH,
  DEFAULT_TTL_SEC,
  MIN_SOLVE_MS,
  MAX_SOLVE_MS,
  TOKEN_PREFIX,
  buildClientScript,
  buildChallengeHtml,
  verifyProof,
  scoreSuspicion,
  isPayload,
  workHash,
  newChallengeId,
}