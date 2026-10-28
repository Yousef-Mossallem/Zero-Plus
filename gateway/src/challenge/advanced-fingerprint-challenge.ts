// ======================================================
// ZERO PLUS GATEWAY — challenge/advanced-fingerprint-challenge.ts
// ------------------------------------------------------
// مسار الفحص المتقدم (Risk ~61–80) + challenge-token
//
// L0..L6 تقييم من الهيدرز/الجلسة
// L7 إثبات اختياري عند pass_with_review أو need_proof
//     → issueChallengeToken / verifyChallengeToken
// L8 تصدير كامل للـ AI (يشمل token)
// ======================================================

import { randomBytes } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { getRedis } from '../services/redis.client'
import {
  authenticateFromFastifyRequest,
  type FingerprintAuthResult,
} from '../detection/fingerprint-authenticator'
import type { OrgPolicyFromBackend } from '../services/backend.client'
import {
  issueChallengeToken,
  verifyChallengeToken,
  extractTokenFromRequest,
  telemetryFromVerify,
} from './challenge-token'

// ------------------------------------------------------
const REDIS_FP_SESSION = 'zp:advfp:sess:'
const SESSION_TTL_SEC = 3600
const TOKEN_TTL_SEC = 180
const FAIL_SCORE_THRESHOLD = 0.72
const REVIEW_SCORE_THRESHOLD = 0.42

export const ADVANCED_CHALLENGE_PATH =
  '/.well-known/zeroplus/challenge/advanced'

// ------------------------------------------------------
export interface AdvancedChallengeContext {
  organizationId: string
  ip: string
  host: string
  path: string
  method: string
  userAgent: string | null
  deviceFingerprint: string | null
  ja4: string | null
  ja3: string | null
  requestId: string
  policy?: Partial<OrgPolicyFromBackend> | null
}

export type AdvancedFailCode =
  | 'no_trusted_edge'
  | 'missing_ja4'
  | 'missing_ja3'
  | 'malformed_ja4'
  | 'malformed_ja3'
  | 'ua_tls_mismatch'
  | 'known_bad_ja_pattern'
  | 'known_script_tls'
  | 'session_ja_flip'
  | 'session_ua_flip'
  | 'empty_ua'
  | 'ua_bot_keyword'
  | 'device_ja_conflict'
  | 'token_invalid'
  | 'token_replay'
  | 'token_missing'
  | 'proof_failed'
  | 'score_above_threshold'

export type AdvancedHintCode =
  | 'partial_ja'
  | 'rare_ja4_structure'
  | 'headless_ua'
  | 'old_browser_ua'
  | 'mobile_ua_desktop_tls'
  | 'desktop_ua_mobile_hint'
  | 'missing_device_fp'
  | 'first_seen_combo'
  | 'stable_session'
  | 'edge_ok'
  | 'token_issued'
  | 'token_ok'

export interface JaPatternHit {
  id: string
  weight: number
  detail: string
}

export interface SessionSnapshot {
  ja4: string | null
  ja3: string | null
  uaFamily: string
  deviceFingerprint: string | null
  seen: number
  firstAt: number
  lastAt: number
}

export interface AdvancedLayerResult {
  layer: string
  ok: boolean
  weight: number
  scoreAdd: number
  codes: string[]
  detail?: string
}

export type UaFamily =
  | 'chrome'
  | 'firefox'
  | 'safari'
  | 'edge'
  | 'opera'
  | 'curl'
  | 'python'
  | 'java'
  | 'go'
  | 'node'
  | 'bot'
  | 'unknown'

export interface AdvancedChallengeTelemetry {
  challengeId: string
  organizationId: string
  requestId: string
  ip: string
  host: string
  path: string
  method: string
  evaluatedAt: number
  edge: {
    fromTrustedEdge: boolean
    ja4: string | null
    ja3: string | null
    tlsVersion: string | null
    tlsCipher: string | null
    notes: string[]
  }
  client: {
    userAgent: string | null
    uaFamily: UaFamily
    deviceFingerprint: string | null
  }
  session: SessionSnapshot | null
  sessionChanged: boolean
  layers: AdvancedLayerResult[]
  patternHits: JaPatternHit[]
  failCodes: AdvancedFailCode[]
  hintCodes: AdvancedHintCode[]
  localSuspicionScore: number
  passed: boolean
  verdict:
    | 'pass'
    | 'pass_with_review'
    | 'fail'
    | 'need_client_proof'
    | 'error'
  timingMs: number
  /** حالة توكن التحدي إن وُجد */
  token?: {
    issued?: boolean
    jti?: string | null
    valid?: boolean
    reason?: string
    ipChanged?: boolean
    hints?: string[]
  }
}

export interface AdvancedChallengeResult {
  phase:
    | 'evaluated'
    | 'need_proof'
    | 'proof_passed'
    | 'proof_failed'
    | 'error'
  passed: boolean
  responseSent: boolean
  telemetry: AdvancedChallengeTelemetry
  /** عند need_proof — التوكن ليُرسل للعميل */
  challengeToken?: string
}

// ------------------------------------------------------
function detectUaFamily(ua: string | null): UaFamily {
  if (!ua) return 'unknown'
  const u = ua.toLowerCase()
  if (/curl\//.test(u)) return 'curl'
  if (/python|aiohttp|scrapy|httpx|urllib/.test(u)) return 'python'
  if (/java\/|apache-httpclient|okhttp/.test(u)) return 'java'
  if (/go-http-client|golang/.test(u)) return 'go'
  if (/node-fetch|axios|undici|node\//.test(u)) return 'node'
  if (/bot|spider|crawler|slurp|facebookexternalhit/.test(u)) return 'bot'
  if (/edg\//.test(u)) return 'edge'
  if (/opr\/|opera/.test(u)) return 'opera'
  if (/firefox\//.test(u)) return 'firefox'
  if (/chrome\//.test(u) && !/edg\//.test(u)) return 'chrome'
  if (/safari\//.test(u) && !/chrome\//.test(u)) return 'safari'
  return 'unknown'
}

function looksLikeJa4(v: string | null): boolean {
  if (!v || v.length < 10 || v.length > 120) return false
  return /^[a-z0-9_._\-]+$/i.test(v)
}

function looksLikeJa3(v: string | null): boolean {
  if (!v || v.length < 16 || v.length > 64) return false
  if (/^[a-f0-9]{32}$/i.test(v)) return true
  return /^[a-z0-9_,.\-]+$/i.test(v)
}

const UA_BOT_RES: { id: string; re: RegExp; weight: number }[] = [
  { id: 'ua_curl', re: /curl\//i, weight: 0.55 },
  { id: 'ua_wget', re: /wget/i, weight: 0.55 },
  { id: 'ua_python', re: /python-requests|aiohttp|httpx|urllib/i, weight: 0.5 },
  { id: 'ua_scrapy', re: /scrapy/i, weight: 0.6 },
  { id: 'ua_java_client', re: /apache-httpclient|java\//i, weight: 0.4 },
  { id: 'ua_go', re: /go-http-client/i, weight: 0.45 },
  { id: 'ua_headless', re: /headless/i, weight: 0.5 },
  { id: 'ua_phantom', re: /phantomjs/i, weight: 0.65 },
  { id: 'ua_selenium', re: /selenium/i, weight: 0.65 },
]

const BAD_JA4_PREFIXES: {
  id: string
  prefix: string
  weight: number
  detail: string
}[] = [
  {
    id: 'ja4_generic_script',
    prefix: 't13d0000',
    weight: 0.35,
    detail: 'degenerate JA4 structure',
  },
]

const BAD_JA3_EXACT: {
  id: string
  hash: string
  weight: number
  detail: string
}[] = []

function sessionKey(orgId: string, ip: string, device: string | null): string {
  return `${REDIS_FP_SESSION}${orgId}:${ip}:${device || 'nodev'}`
}

async function loadSession(key: string): Promise<SessionSnapshot | null> {
  const raw = await getRedis().get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionSnapshot
  } catch {
    return null
  }
}

async function saveSession(key: string, snap: SessionSnapshot): Promise<void> {
  await getRedis().set(key, JSON.stringify(snap), 'EX', SESSION_TTL_SEC)
}

function baseTelemetry(
  ctx: AdvancedChallengeContext,
  challengeId: string,
): AdvancedChallengeTelemetry {
  return {
    challengeId,
    organizationId: ctx.organizationId,
    requestId: ctx.requestId,
    ip: ctx.ip,
    host: ctx.host,
    path: ctx.path,
    method: ctx.method,
    evaluatedAt: Date.now(),
    edge: {
      fromTrustedEdge: false,
      ja4: ctx.ja4,
      ja3: ctx.ja3,
      tlsVersion: null,
      tlsCipher: null,
      notes: [],
    },
    client: {
      userAgent: ctx.userAgent,
      uaFamily: detectUaFamily(ctx.userAgent),
      deviceFingerprint: ctx.deviceFingerprint,
    },
    session: null,
    sessionChanged: false,
    layers: [],
    patternHits: [],
    failCodes: [],
    hintCodes: [],
    localSuspicionScore: 0,
    passed: false,
    verdict: 'fail',
    timingMs: 0,
  }
}

function addLayer(
  t: AdvancedChallengeTelemetry,
  layer: AdvancedLayerResult,
): void {
  t.layers.push(layer)
  t.localSuspicionScore = Math.min(1, t.localSuspicionScore + layer.scoreAdd)
}

function uaTlsConsistency(
  family: UaFamily,
  ja4: string | null,
): { ok: boolean; scoreAdd: number; codes: string[]; detail: string } {
  if (!ja4) {
    return {
      ok: false,
      scoreAdd: 0.15,
      codes: ['missing_ja4'],
      detail: 'no ja4',
    }
  }
  const j = ja4.toLowerCase()
  if (['curl', 'python', 'java', 'go', 'node', 'bot'].includes(family)) {
    return {
      ok: false,
      scoreAdd: 0.4,
      codes: ['ua_tls_mismatch'],
      detail: `tool_ua_family=${family}`,
    }
  }
  if (family === 'chrome' || family === 'edge') {
    if (!(j.startsWith('t13') || j.startsWith('t12') || j.startsWith('t11'))) {
      return {
        ok: true,
        scoreAdd: 0.12,
        codes: [],
        detail: 'chrome_family_unusual_ja4_prefix',
      }
    }
  }
  if (family === 'firefox') {
    if (!(j.startsWith('t13') || j.startsWith('t12') || j.startsWith('t10'))) {
      return {
        ok: true,
        scoreAdd: 0.1,
        codes: [],
        detail: 'firefox_unusual_ja4_prefix',
      }
    }
  }
  return { ok: true, scoreAdd: 0, codes: [], detail: 'consistent_enough' }
}

// ------------------------------------------------------
// تقييم الهيدرز
// ------------------------------------------------------

export async function evaluateAdvancedFingerprint(
  request: FastifyRequest,
  ctx: AdvancedChallengeContext,
  fpAuth?: FingerprintAuthResult,
): Promise<AdvancedChallengeResult> {
  const start = Date.now()
  const challengeId = randomBytes(12).toString('hex')
  const t = baseTelemetry(ctx, challengeId)

  try {
    const auth = fpAuth ?? authenticateFromFastifyRequest(request)
    t.edge = {
      fromTrustedEdge: auth.tls.fromTrustedEdge,
      ja4: auth.forSignals.ja4 ?? ctx.ja4,
      ja3: auth.forSignals.ja3 ?? ctx.ja3,
      tlsVersion: auth.tls.tlsVersion,
      tlsCipher: auth.tls.tlsCipher,
      notes: [...auth.notes],
    }
    if (auth.device.value && !t.client.deviceFingerprint) {
      t.client.deviceFingerprint = auth.device.value
    }

    // L1
    if (!t.edge.fromTrustedEdge) {
      addLayer(t, {
        layer: 'L1_trusted_edge',
        ok: false,
        weight: 0.25,
        scoreAdd: 0.25,
        codes: ['no_trusted_edge'],
        detail: 'JA headers untrusted or direct-to-gateway',
      })
      t.failCodes.push('no_trusted_edge')
    } else {
      addLayer(t, {
        layer: 'L1_trusted_edge',
        ok: true,
        weight: 0.25,
        scoreAdd: 0,
        codes: ['edge_ok'],
      })
      t.hintCodes.push('edge_ok')
    }

    const ja4 = t.edge.ja4
    const ja3 = t.edge.ja3

    // L2
    if (!ja4) {
      addLayer(t, {
        layer: 'L2_ja_presence',
        ok: false,
        weight: 0.2,
        scoreAdd: 0.2,
        codes: ['missing_ja4'],
      })
      t.failCodes.push('missing_ja4')
    } else if (!looksLikeJa4(ja4)) {
      addLayer(t, {
        layer: 'L2_ja_presence',
        ok: false,
        weight: 0.2,
        scoreAdd: 0.22,
        codes: ['malformed_ja4'],
      })
      t.failCodes.push('malformed_ja4')
    } else if (!ja3) {
      addLayer(t, {
        layer: 'L2_ja_presence',
        ok: true,
        weight: 0.2,
        scoreAdd: 0.05,
        codes: ['missing_ja3'],
        detail: 'ja4 ok, ja3 missing',
      })
      t.hintCodes.push('partial_ja')
    } else if (!looksLikeJa3(ja3)) {
      addLayer(t, {
        layer: 'L2_ja_presence',
        ok: false,
        weight: 0.2,
        scoreAdd: 0.15,
        codes: ['malformed_ja3'],
      })
      t.failCodes.push('malformed_ja3')
    } else {
      addLayer(t, {
        layer: 'L2_ja_presence',
        ok: true,
        weight: 0.2,
        scoreAdd: 0,
        codes: [],
      })
    }

    // L3
    const family = t.client.uaFamily
    if (!ctx.userAgent || !ctx.userAgent.trim()) {
      addLayer(t, {
        layer: 'L3_ua_tls',
        ok: false,
        weight: 0.2,
        scoreAdd: 0.2,
        codes: ['empty_ua'],
      })
      t.failCodes.push('empty_ua')
    } else {
      const cons = uaTlsConsistency(family, ja4)
      addLayer(t, {
        layer: 'L3_ua_tls',
        ok: cons.ok || cons.scoreAdd < 0.2,
        weight: 0.2,
        scoreAdd: cons.scoreAdd,
        codes: cons.codes,
        detail: cons.detail,
      })
      if (cons.codes.includes('ua_tls_mismatch')) {
        t.failCodes.push('ua_tls_mismatch')
      }
    }

    // L4
    let patternScore = 0
    const hits: JaPatternHit[] = []
    const ua = ctx.userAgent || ''
    for (const rule of UA_BOT_RES) {
      if (rule.re.test(ua)) {
        hits.push({ id: rule.id, weight: rule.weight, detail: 'ua_regex' })
        patternScore += rule.weight
        if (rule.weight >= 0.5) t.failCodes.push('ua_bot_keyword')
        else t.hintCodes.push('headless_ua')
      }
    }
    if (ja4) {
      for (const p of BAD_JA4_PREFIXES) {
        if (ja4.toLowerCase().startsWith(p.prefix)) {
          hits.push({ id: p.id, weight: p.weight, detail: p.detail })
          patternScore += p.weight
          t.failCodes.push('known_bad_ja_pattern')
        }
      }
    }
    if (ja3) {
      for (const p of BAD_JA3_EXACT) {
        if (ja3.toLowerCase() === p.hash.toLowerCase()) {
          hits.push({ id: p.id, weight: p.weight, detail: p.detail })
          patternScore += p.weight
          t.failCodes.push('known_script_tls')
        }
      }
    }
    patternScore = Math.min(0.7, patternScore)
    t.patternHits = hits
    addLayer(t, {
      layer: 'L4_threat_patterns',
      ok: patternScore < 0.35,
      weight: 0.25,
      scoreAdd: patternScore,
      codes: hits.map((h) => h.id),
      detail: `hits=${hits.length}`,
    })

    // L5
    const sKey = sessionKey(
      ctx.organizationId,
      ctx.ip,
      t.client.deviceFingerprint,
    )
    const prev = await loadSession(sKey)
    const now = Date.now()
    let sessionChanged = false
    if (prev) {
      t.session = prev
      if (prev.ja4 && ja4 && prev.ja4 !== ja4) {
        sessionChanged = true
        t.failCodes.push('session_ja_flip')
        addLayer(t, {
          layer: 'L5_session_stability',
          ok: false,
          weight: 0.2,
          scoreAdd: 0.28,
          codes: ['session_ja_flip'],
          detail: 'ja4 changed within session window',
        })
      } else if (
        prev.uaFamily !== 'unknown' &&
        family !== 'unknown' &&
        prev.uaFamily !== family
      ) {
        sessionChanged = true
        t.failCodes.push('session_ua_flip')
        addLayer(t, {
          layer: 'L5_session_stability',
          ok: false,
          weight: 0.2,
          scoreAdd: 0.22,
          codes: ['session_ua_flip'],
          detail: `${prev.uaFamily} -> ${family}`,
        })
      } else {
        addLayer(t, {
          layer: 'L5_session_stability',
          ok: true,
          weight: 0.2,
          scoreAdd: 0,
          codes: ['stable_session'],
        })
        t.hintCodes.push('stable_session')
      }
    } else {
      addLayer(t, {
        layer: 'L5_session_stability',
        ok: true,
        weight: 0.2,
        scoreAdd: 0.02,
        codes: ['first_seen_combo'],
      })
      t.hintCodes.push('first_seen_combo')
    }
    t.sessionChanged = sessionChanged

    const snap: SessionSnapshot = {
      ja4,
      ja3,
      uaFamily: family,
      deviceFingerprint: t.client.deviceFingerprint,
      seen: (prev?.seen ?? 0) + 1,
      firstAt: prev?.firstAt ?? now,
      lastAt: now,
    }
    await saveSession(sKey, snap)
    t.session = snap

    // L6
    if (!t.client.deviceFingerprint) {
      addLayer(t, {
        layer: 'L6_device_fp',
        ok: true,
        weight: 0.1,
        scoreAdd: 0.06,
        codes: ['missing_device_fp'],
      })
      t.hintCodes.push('missing_device_fp')
    } else {
      addLayer(t, {
        layer: 'L6_device_fp',
        ok: true,
        weight: 0.1,
        scoreAdd: 0,
        codes: [],
      })
    }

    t.localSuspicionScore = Math.min(1, t.localSuspicionScore)
    t.timingMs = Date.now() - start

    if (t.localSuspicionScore >= FAIL_SCORE_THRESHOLD) {
      t.passed = false
      t.verdict = 'fail'
      if (!t.failCodes.includes('score_above_threshold')) {
        t.failCodes.push('score_above_threshold')
      }
    } else if (t.localSuspicionScore >= REVIEW_SCORE_THRESHOLD) {
      // منطقة رمادية → إثبات بتوكن (L7)
      t.passed = false
      t.verdict = 'need_client_proof'
    } else {
      t.passed = true
      t.verdict = 'pass'
    }

    if (!t.edge.fromTrustedEdge && !ja4) {
      t.passed = false
      t.verdict = 'fail'
    }

    // L7: إصدار توكن عند الحاجة لإثبات
    if (t.verdict === 'need_client_proof') {
      const issued = await issueChallengeToken({
        organizationId: ctx.organizationId,
        kind: 'advanced',
        ip: ctx.ip,
        deviceFingerprint: t.client.deviceFingerprint,
        host: ctx.host,
        path: ctx.path,
        ttlSec: TOKEN_TTL_SEC,
        requestId: ctx.requestId,
        bind: {
          challengeId,
          ja4: ja4 ?? '',
          ja3: ja3 ?? '',
          score: t.localSuspicionScore,
        },
      })
      t.token = {
        issued: true,
        jti: issued.payload.jti,
        valid: true,
      }
      t.hintCodes.push('token_issued')
      addLayer(t, {
        layer: 'L7_challenge_token',
        ok: true,
        weight: 0.1,
        scoreAdd: 0,
        codes: ['token_issued'],
        detail: 'awaiting client proof POST',
      })

      return {
        phase: 'need_proof',
        passed: false,
        responseSent: false,
        telemetry: t,
        challengeToken: issued.token,
      }
    }

    return {
      phase: 'evaluated',
      passed: t.passed,
      responseSent: false,
      telemetry: t,
    }
  } catch (err) {
    t.verdict = 'error'
    t.passed = false
    t.timingMs = Date.now() - start
    t.layers.push({
      layer: 'L_error',
      ok: false,
      weight: 1,
      scoreAdd: 1,
      codes: ['error'],
      detail: (err as Error).message,
    })
    return {
      phase: 'error',
      passed: false,
      responseSent: false,
      telemetry: t,
    }
  }
}

// ------------------------------------------------------
// POST إثبات + تحقق التوكن
// ------------------------------------------------------

export function isAdvancedChallengeResponse(request: FastifyRequest): boolean {
  if (request.method !== 'POST') return false
  const path = request.url.split('?')[0] || ''
  return (
    path === ADVANCED_CHALLENGE_PATH ||
    request.headers['x-zp-challenge'] === 'advanced'
  )
}

export async function verifyAdvancedProofResponse(
  request: FastifyRequest,
  ctx: AdvancedChallengeContext,
): Promise<AdvancedChallengeResult> {
  const start = Date.now()
  const challengeId = randomBytes(8).toString('hex')
  const t = baseTelemetry(ctx, challengeId)

  const tokenStr = extractTokenFromRequest(request) || ''
  if (!tokenStr) {
    t.failCodes.push('token_missing')
    t.verdict = 'fail'
    t.timingMs = Date.now() - start
    return {
      phase: 'proof_failed',
      passed: false,
      responseSent: false,
      telemetry: t,
    }
  }

  const tokenResult = await verifyChallengeToken({
    token: tokenStr,
    organizationId: ctx.organizationId,
    kind: 'advanced',
    ip: ctx.ip,
    deviceFingerprint: ctx.deviceFingerprint,
    host: ctx.host,
    bindIp: false,
    bindDevice: true,
    consume: true,
  })

  const meta = telemetryFromVerify(ctx.organizationId, 'advanced', tokenResult)
  t.token = {
    issued: false,
    jti: meta.jti,
    valid: tokenResult.valid,
    reason: tokenResult.reason,
    ipChanged: meta.ipChanged,
    hints: meta.hints,
  }

  if (!tokenResult.valid) {
    t.failCodes.push(
      tokenResult.reason === 'already_used' ? 'token_replay' : 'token_invalid',
    )
    addLayer(t, {
      layer: 'L7_challenge_token',
      ok: false,
      weight: 0.35,
      scoreAdd: 0.35,
      codes: [tokenResult.reason || 'token_invalid'],
    })
    t.passed = false
    t.verdict = 'fail'
    t.timingMs = Date.now() - start
    return {
      phase: 'proof_failed',
      passed: false,
      responseSent: false,
      telemetry: t,
    }
  }

  // بعد توكن صالح: أعد تقييم بصمات الطلب الحالي
  const reval = await evaluateAdvancedFingerprint(request, ctx)
  // لا تصدر توكن تاني من reval لو need_proof — التوكن اتحقق
  if (reval.telemetry.verdict === 'need_client_proof') {
    reval.telemetry.verdict = 'pass_with_review'
    reval.telemetry.passed = true
    reval.passed = true
  }
  reval.telemetry.token = t.token
  reval.telemetry.hintCodes.push('token_ok')
  reval.telemetry.layers.push({
    layer: 'L7_challenge_token',
    ok: true,
    weight: 0.1,
    scoreAdd: 0,
    codes: ['token_ok'],
  })
  reval.phase =
    reval.passed || reval.telemetry.verdict === 'pass_with_review'
      ? 'proof_passed'
      : 'proof_failed'
  reval.telemetry.timingMs = Date.now() - start
  return {
    ...reval,
    phase: reval.phase,
    responseSent: false,
  }
}

export async function handleAdvancedFingerprintChallenge(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: AdvancedChallengeContext,
): Promise<AdvancedChallengeResult> {
  // رد إثبات
  if (isAdvancedChallengeResponse(request)) {
    return verifyAdvancedProofResponse(request, ctx)
  }

  const result = await evaluateAdvancedFingerprint(request, ctx)

  // need_proof: أرجع JSON + توكن (app يقدر يمرّر الرد)
  if (result.phase === 'need_proof' && result.challengeToken) {
    reply
      .status(401)
      .header('cache-control', 'no-store')
      .header('x-zp-challenge', 'advanced')
      .header('x-zp-challenge-token', result.challengeToken)
      .send({
        success: false,
        error: 'Advanced fingerprint proof required',
        challenge: 'advanced',
        challengeToken: result.challengeToken,
        postTo: ADVANCED_CHALLENGE_PATH,
        requestId: ctx.requestId,
        score: result.telemetry.localSuspicionScore,
      })
    return { ...result, responseSent: true }
  }

  return result
}

export function advancedTelemetryForAi(
  t: AdvancedChallengeTelemetry,
): Record<string, unknown> {
  return {
    kind: 'advanced_fingerprint_telemetry',
    challengeId: t.challengeId,
    organizationId: t.organizationId,
    requestId: t.requestId,
    ip: t.ip,
    host: t.host,
    path: t.path,
    method: t.method,
    evaluatedAt: t.evaluatedAt,
    timingMs: t.timingMs,
    passed: t.passed,
    verdict: t.verdict,
    localSuspicionScore: t.localSuspicionScore,
    failCodes: t.failCodes,
    hintCodes: t.hintCodes,
    edge: t.edge,
    client: t.client,
    session: t.session,
    sessionChanged: t.sessionChanged,
    layers: t.layers,
    patternHits: t.patternHits,
    token: t.token ?? null,
  }
}

export function mergeForAi(parts: {
  advanced?: AdvancedChallengeTelemetry | null
  js?: Record<string, unknown> | null
  extra?: Record<string, unknown>
}): Record<string, unknown> {
  return {
    kind: 'gateway_challenge_bundle',
    advanced: parts.advanced
      ? advancedTelemetryForAi(parts.advanced)
      : null,
    js: parts.js ?? null,
    ...parts.extra,
  }
}

export {
  FAIL_SCORE_THRESHOLD,
  REVIEW_SCORE_THRESHOLD,
  SESSION_TTL_SEC,
  TOKEN_TTL_SEC,
  detectUaFamily,
  looksLikeJa4,
  looksLikeJa3,
  uaTlsConsistency,
  sessionKey,
  evaluateAdvancedFingerprint as evaluate,
}

export default {
  handleAdvancedFingerprintChallenge,
  evaluateAdvancedFingerprint,
  verifyAdvancedProofResponse,
  isAdvancedChallengeResponse,
  advancedTelemetryForAi,
  mergeForAi,
  ADVANCED_CHALLENGE_PATH,
  FAIL_SCORE_THRESHOLD,
  REVIEW_SCORE_THRESHOLD,
  detectUaFamily,
  looksLikeJa4,
  looksLikeJa3,
}