// ======================================================
// ZERO PLUS GATEWAY — challenge/js-challenge.ts
// ------------------------------------------------------
// تحدّي JS صامت متقدم + مربوط بـ challenge-token (مرة واحدة / HMAC / Redis)
//
//   1) issueChallengeToken + bind(rounds, nonce, challengeId)
//   2) HTML/سكربت صامت يجمع إشارات
//   3) POST + challengeToken
//   4) verifyChallengeToken (consume) ثم proof + suspicion
//   5) نجاح → app يصدر clearance | فشل → أسباب + AI telemetry
// ======================================================

import { randomBytes } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { OrgPolicyFromBackend } from '../services/backend.client'
import {
  issueChallengeToken,
  verifyChallengeToken,
  extractTokenFromRequest,
  telemetryFromVerify,
  type VerifyChallengeTokenResult,
} from './challenge-token'

// ------------------------------------------------------
// إعدادات
// ------------------------------------------------------

const DEFAULT_TTL_SEC = 120
const MIN_SOLVE_MS = 80
const MAX_SOLVE_MS = 90_000
export const EXPECTED_API_PATH = '/.well-known/zeroplus/challenge/js'

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

export interface JsChallengeTelemetry {
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
  passed: boolean
  failReasons: string[]
  suspicionHints: string[]
  localSuspicionScore: number
  browser: BrowserProbePayload | null
  /** نتيجة توكن التحدي */
  token?: {
    valid: boolean
    reason?: string
    jti?: string | null
    ipChanged?: boolean
    hints?: string[]
  }
}

export interface BrowserProbePayload {
  v: number
  challengeId: string
  /** التوكن الموقّع من السيرفر */
  challengeToken?: string
  t0: number
  t1: number
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
  webgl: { vendor: string; renderer: string; ok: boolean }
  canvasHash: string
  audioHash: string
  perf: { now: number; timingGap: number; mathChaos: number }
  behavior: {
    moveSamples: number
    scrollSamples: number
    keySamples: number
    visibilityMs: number
  }
  consistency: {
    uaPlatformMatch: boolean
    touchDesktopMismatch: boolean
    webdriverOn: boolean
    noPluginsHeadless: boolean
    zeroConcurrency: boolean
  }
  proof: { nonce: string; work: string; rounds: number }
}

export type JsChallengePhase =
  | 'issue'
  | 'passed'
  | 'failed'
  | 'disabled'
  | 'error'

export interface JsChallengeResult {
  phase: JsChallengePhase
  passed: boolean
  telemetry: JsChallengeTelemetry
  responseSent?: boolean
}

// ------------------------------------------------------

function emptyTelemetry(
  partial: Partial<JsChallengeTelemetry>,
): JsChallengeTelemetry {
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

function newChallengeId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * سكربت العميل — صامت + يرسل challengeToken مع الحمولة
 */
function buildClientScript(params: {
  challengeId: string
  nonce: string
  rounds: number
  postUrl: string
  challengeToken: string
}): string {
  const { challengeId, nonce, rounds, postUrl, challengeToken } = params
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
})();`
}

function buildChallengeHtml(script: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title></title></head><body><script>${script}</script></body></html>`
}

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

function scoreSuspicion(
  p: BrowserProbePayload,
  solveMs: number,
): { score: number; hints: string[]; fails: string[] } {
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

function verifyProof(
  p: BrowserProbePayload,
  expectedNonce: string,
  rounds: number,
): boolean {
  if (p.proof.nonce !== expectedNonce) return false
  if (p.proof.rounds !== rounds) return false
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
// API
// ------------------------------------------------------

export function isJsChallengeResponse(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0] || ''
  if (
    path === EXPECTED_API_PATH ||
    path.endsWith('/.well-known/zeroplus/challenge/js')
  ) {
    return request.method === 'POST'
  }
  if (request.headers['x-zp-challenge'] === 'js' && request.method === 'POST') {
    return true
  }
  return false
}

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
  const rounds = 400 + (randomBytes(1)[0]! % 200)
  const issuedAt = Date.now()

  // توكن رسمي لمرة واحدة (HMAC + Redis)
  const issued = await issueChallengeToken({
    organizationId: ctx.organizationId,
    kind: 'js',
    ip: ctx.ip,
    deviceFingerprint: ctx.deviceFingerprint,
    host: ctx.host,
    path: ctx.path,
    ttlSec: DEFAULT_TTL_SEC,
    requestId: ctx.requestId,
    bind: {
      challengeId,
      nonce,
      rounds,
      issuedAt,
    },
  })

  const script = buildClientScript({
    challengeId,
    nonce,
    rounds,
    postUrl: EXPECTED_API_PATH,
    challengeToken: issued.token,
  })
  const html = buildChallengeHtml(script)

  reply
    .status(401)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('x-zp-challenge', 'js')
    .header('x-zp-challenge-id', challengeId)
    .header('x-zp-challenge-token', issued.token)
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
      suspicionHints: ['challenge_issued'],
      token: {
        valid: true,
        jti: issued.payload.jti,
      },
    }),
  }
}

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

  const tokenStr =
    extractTokenFromRequest(request) ||
    (typeof body.challengeToken === 'string' ? body.challengeToken : '') ||
    ''

  const tokenResult: VerifyChallengeTokenResult = await verifyChallengeToken({
    token: tokenStr,
    organizationId: ctx.organizationId,
    kind: 'js',
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
  })

  const tokenMeta = telemetryFromVerify(ctx.organizationId, 'js', tokenResult)
  const failReasons: string[] = []
  const suspicionHints: string[] = [...(tokenResult.hints || [])]

  if (!tokenResult.valid) {
    failReasons.push(`token_${tokenResult.reason || 'invalid'}`)
    return {
      phase: 'failed',
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
        browser: body,
        token: {
          valid: false,
          reason: tokenResult.reason,
          jti: tokenMeta.jti,
          ipChanged: tokenMeta.ipChanged,
          hints: tokenMeta.hints,
        },
      }),
    }
  }

  const bind = tokenResult.bind || {}
  const expectedNonce = String(bind.nonce ?? body.proof.nonce)
  const expectedRounds = Number(bind.rounds ?? body.proof.rounds)
  const issuedAt = Number(bind.issuedAt ?? Date.now())
  const challengeIdFromBind = String(bind.challengeId ?? body.challengeId)

  if (challengeIdFromBind !== body.challengeId) {
    failReasons.push('challenge_id_mismatch')
  }
  if (!verifyProof(body, expectedNonce, expectedRounds)) {
    failReasons.push('proof_mismatch')
  }
  if (tokenResult.ipChanged) {
    suspicionHints.push('ip_changed_during_challenge')
  }

  const solvedAt = Date.now()
  const solveDurationMs = Math.max(0, solvedAt - issuedAt)
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
    issuedAt,
    solvedAt,
    solveDurationMs,
    passed,
    failReasons,
    suspicionHints,
    localSuspicionScore: score,
    browser: body,
    token: {
      valid: true,
      jti: tokenResult.payload?.jti ?? null,
      ipChanged: tokenResult.ipChanged,
      hints: tokenResult.hints,
    },
  }

  return {
    phase: passed ? 'passed' : 'failed',
    passed,
    telemetry,
  }
}

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

export function telemetryForAi(
  t: JsChallengeTelemetry,
): Record<string, unknown> {
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
    token: t.token ?? null,
    browser: t.browser,
  }
}

// ------------------------------------------------------
export {
  DEFAULT_TTL_SEC,
  MIN_SOLVE_MS,
  MAX_SOLVE_MS,
  buildClientScript,
  buildChallengeHtml,
  verifyProof,
  scoreSuspicion,
  isPayload,
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
  buildClientScript,
  buildChallengeHtml,
  verifyProof,
  scoreSuspicion,
  isPayload,
  newChallengeId,
}