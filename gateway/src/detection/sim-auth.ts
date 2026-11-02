// ==================================================================
// ZERO PLUS GATEWAY — detection/sim-auth.ts
// ------------------------------------------------------------------
// التحقق من توكن المحاكاة الصادر من الـ Backend
//
// الشكل (متوافق مع backend simulations.token.ts):
//   X-ZP-Simulation: <base64url(payloadJson)>.<base64url(hmacSha256)>
//   X-ZP-Sim-Run:    <runId>
//
// هيدرز بعد توكن صالح فقط:
//   X-ZP-Sim-JS:       pass | fail | skip
//   X-ZP-Sim-AI:       0..1
//   X-ZP-Sim-Persona:  legit_ok | ...
//   X-ZP-Sim-Country:  ISO-3166 alpha-2
//
// بدون توقيع صحيح → لا تُعامل كمحاكاة أبدًا.
// ==================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { config } from '../config'

// ==================================================================
// Types
// ==================================================================

export const SIM_TOKEN_VERSION = 1 as const

export interface SimulationTokenPayload {
  v: typeof SIM_TOKEN_VERSION
  jti: string
  runId: string
  organizationId: string
  serverId: string
  domain: string
  /** unix seconds */
  iat: number
  /** unix seconds */
  exp: number
  maxRps: number
}

export type SimJsDirective = 'pass' | 'fail' | 'skip'

export type SimulationPersonaName =
  | 'legit_ok'
  | 'legit_sensitive'
  | 'rate_soft'
  | 'rate_hard'
  | 'bot_ua'
  | 'fail_js'
  | 'pass_js'
  | 'bad_ip'
  | string

export type SimAuthFailReason =
  | 'disabled'
  | 'missing'
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'revoked'
  | 'version_mismatch'
  | 'payload_invalid'
  | 'run_mismatch'
  | 'org_mismatch'
  | 'domain_mismatch'
  | 'server_mismatch'
  | 'secret_weak'

export interface SimulationAuthResult {
  valid: SimulationAuthResult | null
  ok: boolean
  reason: 'ok' | SimAuthFailReason
  payload?: SimulationTokenPayload
  runId?: string
  organizationId?: string
  serverId?: string
  domain?: string
  maxRps?: number
  jti?: string
  js?: SimJsDirective | null
  aiScore?: number | null
  persona?: SimulationPersonaName | null
  countryHint?: string | null
}

export interface SimulationContext {
  active: true
  runId: string
  organizationId: string
  serverId: string
  domain: string
  jti: string
  maxRps: number
  js: SimJsDirective | null
  aiScore: number | null
  persona: string | null
  countryHint: string | null
}

export interface VerifySimulationInput {
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>
  expectedOrganizationId?: string | null
  expectedServerId?: string | null
  expectedDomain?: string | null
  expectedRunId?: string | null
  clockSkewSec?: number
}

// ==================================================================
// Headers
// ==================================================================

export const HEADER_SIM_TOKEN = 'x-zp-simulation'
export const HEADER_SIM_RUN = 'x-zp-sim-run'
export const HEADER_SIM_JS = 'x-zp-sim-js'
export const HEADER_SIM_AI = 'x-zp-sim-ai'
export const HEADER_SIM_PERSONA = 'x-zp-sim-persona'
export const HEADER_SIM_COUNTRY = 'x-zp-sim-country'

// ==================================================================
// Local revoke (optional)
// ==================================================================

const localRevokedJti = new Map<string, number>()

export function revokeSimJtiLocally(jti: string, ttlMs = 86_400_000): void {
  if (!jti) return
  localRevokedJti.set(jti, Date.now() + ttlMs)
}

function isLocallyRevoked(jti: string): boolean {
  const exp = localRevokedJti.get(jti)
  if (exp == null) return false
  if (exp <= Date.now()) {
    localRevokedJti.delete(jti)
    return false
  }
  return true
}

// ==================================================================
// Crypto / config
// ==================================================================

function getSecret(): string {
  const fromConfig = config.simulation?.secret
  return (
    fromConfig ||
    process.env.SIMULATION_TOKEN_SECRET ||
    process.env.GATEWAY_SECRET ||
    process.env.GATEWAY_INTERNAL_SECRET ||
    ''
  )
}

function simulationEnabled(): boolean {
  if (typeof config.simulation?.enabled === 'boolean') {
    return config.simulation.enabled
  }
  const env = process.env.SIMULATION_ENABLED
  if (env == null || env === '') return true
  return env === '1' || env.toLowerCase() === 'true'
}

function getClockSkewSec(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override)) return override
  const fromConfig = config.simulation?.clockSkewSec
  if (typeof fromConfig === 'number' && Number.isFinite(fromConfig)) {
    return fromConfig
  }
  return 30
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64')
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function signBody(bodyB64: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(bodyB64, 'utf8').digest()
  return b64urlEncode(mac)
}

function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  try {
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

function headerValue(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const lower = name.toLowerCase()
  const raw =
    (headers as Record<string, string | string[] | undefined>)[lower] ??
    (headers as Record<string, string | string[] | undefined>)[name]
  if (Array.isArray(raw)) return raw[0]?.trim() || null
  if (typeof raw === 'string') return raw.trim() || null
  return null
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().split(':')[0] || ''
}

function parseJs(v: string | null): SimJsDirective | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (s === 'pass' || s === 'fail' || s === 'skip') return s
  return null
}

function parseAi(v: string | null): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.min(1, Math.max(0, n))
}

function parseCountry(v: string | null): string | null {
  if (!v) return null
  const c = v.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return null
  return c
}

function fail(reason: SimAuthFailReason): SimulationAuthResult {
  return {
    ok: false,
    reason,
    valid: null,
  }
}

// ==================================================================
// Verify token string
// ==================================================================

export function verifySimulationTokenString(
  headerValue: string,
  options: {
    expectedRunId?: string | null
    expectedOrganizationId?: string | null
    expectedServerId?: string | null
    expectedDomain?: string | null
    clockSkewSec?: number
  } = {},
): SimulationAuthResult {
  if (!simulationEnabled()) return fail('disabled')

  const secret = getSecret()
  if (!secret || secret.length < 16) return fail('secret_weak')

  const parts = headerValue.trim().split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return fail('malformed')

  const [bodyB64, sigB64] = parts
  const expectedSig = signBody(bodyB64, secret)
  if (!safeEqualStr(expectedSig, sigB64)) return fail('bad_signature')

  let payload: SimulationTokenPayload
  try {
    const json = b64urlDecode(bodyB64).toString('utf8')
    payload = JSON.parse(json) as SimulationTokenPayload
  } catch {
    return fail('payload_invalid')
  }

  if (
    !payload ||
    typeof payload.jti !== 'string' ||
    typeof payload.runId !== 'string' ||
    typeof payload.organizationId !== 'string' ||
    typeof payload.serverId !== 'string' ||
    typeof payload.domain !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    return fail('payload_invalid')
  }

  if (payload.v !== SIM_TOKEN_VERSION) return fail('version_mismatch')

  const skew = getClockSkewSec(options.clockSkewSec)
  const nowSec = Math.floor(Date.now() / 1000)
  if (payload.exp + skew < nowSec) {
    return {
      ok: false,
      reason: 'expired',
      payload,
      valid: null,
    }
  }

  if (isLocallyRevoked(payload.jti)) {
    return {
      ok: false,
      reason: 'revoked',
      payload,
      valid: null,
    }
  }

  if (options.expectedRunId && options.expectedRunId !== payload.runId) {
    return {
      ok: false,
      reason: 'run_mismatch',
      payload,
      valid: null,
    }
  }

  if (
    options.expectedOrganizationId &&
    options.expectedOrganizationId !== payload.organizationId
  ) {
    return {
      ok: false,
      reason: 'org_mismatch',
      payload,
      valid: null,
    }
  }

  if (
    options.expectedServerId &&
    options.expectedServerId !== payload.serverId
  ) {
    return {
      ok: false,
      reason: 'server_mismatch',
      payload,
      valid: null,
    }
  }

  if (options.expectedDomain) {
    if (
      normalizeDomain(options.expectedDomain) !==
      normalizeDomain(payload.domain)
    ) {
      return {
        ok: false,
        reason: 'domain_mismatch',
        payload,
        valid: null,
      }
    }
  }

  return {
    ok: true,
    reason: 'ok',
    payload,
    runId: payload.runId,
    organizationId: payload.organizationId,
    serverId: payload.serverId,
    domain: payload.domain,
    maxRps: typeof payload.maxRps === 'number' && Number.isFinite(payload.maxRps)
        ? payload.maxRps
        : 40,
    jti: payload.jti,
    valid: null,
  }
}

// ==================================================================
// From request headers
// ==================================================================

export function authenticateSimulation(
  input: VerifySimulationInput,
): SimulationAuthResult {
  if (!simulationEnabled()) return fail('disabled')

  const token = headerValue(input.headers, HEADER_SIM_TOKEN)
  if (!token) return fail('missing')

  const runHeader = headerValue(input.headers, HEADER_SIM_RUN)

  const base = verifySimulationTokenString(token, {
    expectedRunId: input.expectedRunId ?? runHeader,
    expectedOrganizationId: input.expectedOrganizationId,
    expectedServerId: input.expectedServerId,
    expectedDomain: input.expectedDomain,
    clockSkewSec: input.clockSkewSec,
  })

  if (!base.ok) return base

  const allowJs = config.simulation?.allowSimJsDirective !== false
  const allowAi = config.simulation?.allowSimAiHeader !== false
  const allowCountry = config.simulation?.allowSimCountryHint !== false

  const js = allowJs
    ? parseJs(headerValue(input.headers, HEADER_SIM_JS))
    : null
  const aiScore = allowAi
    ? parseAi(headerValue(input.headers, HEADER_SIM_AI))
    : null
  const persona = headerValue(input.headers, HEADER_SIM_PERSONA)
  const countryHint = allowCountry
    ? parseCountry(headerValue(input.headers, HEADER_SIM_COUNTRY))
    : null

  return {
    ...base,
    js,
    aiScore,
    persona,
    countryHint,
  }
}

export function toSimulationContext(
  result: SimulationAuthResult,
): SimulationContext | null {
  if (
    !result.ok ||
    !result.runId ||
    !result.organizationId ||
    !result.serverId
  ) {
    return null
  }
  return {
    active: true,
    runId: result.runId,
    organizationId: result.organizationId,
    serverId: result.serverId,
    domain: result.domain || '',
    jti: result.jti || '',
    maxRps: result.maxRps ?? 40,
    js: result.js ?? null,
    aiScore: result.aiScore ?? null,
    persona: result.persona ?? null,
    countryHint: result.countryHint ?? null,
  }
}

export function shouldSyntheticJs(
  ctx: SimulationContext | null | undefined,
): ctx is SimulationContext & { js: SimJsDirective } {
  return (
    !!ctx?.active &&
    (ctx.js === 'pass' || ctx.js === 'fail' || ctx.js === 'skip')
  )
}

export function simulationAiAnomalyScore(
  ctx: SimulationContext | null | undefined,
): number | null {
  if (!ctx?.active) return null
  if (ctx.aiScore == null) return null
  return ctx.aiScore
}

export default {
  authenticateSimulation,
  verifySimulationTokenString,
  toSimulationContext,
  shouldSyntheticJs,
  simulationAiAnomalyScore,
  revokeSimJtiLocally,
  HEADER_SIM_TOKEN,
  HEADER_SIM_RUN,
  HEADER_SIM_JS,
  HEADER_SIM_AI,
  HEADER_SIM_PERSONA,
  HEADER_SIM_COUNTRY,
  SIM_TOKEN_VERSION,
}