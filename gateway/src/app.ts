// ======================================================
// ZERO PLUS GATEWAY — Fastify Application
// Host → Backend → Ban → Clearance → Rate → Risk → Router
// → JS challenge / Ban / Forward
// ======================================================

import { randomUUID } from 'node:crypto'
import Fastify, {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from 'fastify'
import cookie from '@fastify/cookie'
import { config } from './config'
import { getRedis, closeRedis } from './services/redis.client'
import { probeOrigin } from './services/origin.probe'
import {
  resolvePolicyByHost,
  lookupReputation,
  type OrgPolicyFromBackend,
  type GatewayServer,
  type PolicyResolveData,
} from './services/backend.client'
import { calculateRisk, type RiskResult } from './core/risk.engine'
import {
  decidePolicy,
  type CompanyPolicy,
  type PolicyDecision,
} from './core/policy.engine'
import {
  routeSuspicion,
  type RouteDecision,
} from './detection/suspicion-router'
import {
  authenticateFromFastifyRequest,
  applyFingerprintsToSignals,
} from './detection/fingerprint-authenticator'
import {
  checkBan,
  applyBanFromDecision,
  applyBan,
} from './detection/ban.manager'
import {
  checkRateLimit,
  applyRateLimitHeaders,
  type RateLimitResult,
} from './detection/rate-limiter'
import {
  verifyClearanceFromRequest,
  setClearanceCookie,
  revokeClearance,
} from './challenge/clearance'
import {
  handleJsChallenge,
  isJsChallengeResponse,
  telemetryForAi,
  type JsChallengeResult,
} from './challenge/js-challenge'
import { forwardToOrigin } from './proxy/forwardToOrigin'
import type { RequestContext, Signals } from './types'

// import { analyzeTraffic } from './services/ai.client'
// import { logSecurityEvent } from './logging/event-logger'

export interface GatewayRuntimeContext extends RequestContext {
  resolved: PolicyResolveData | null
  server: GatewayServer | null
  companyPolicy: Partial<CompanyPolicy> | null
  policyDecision: PolicyDecision | null
  routeDecision: RouteDecision | null
  rateLimit: RateLimitResult | null
  jsChallenge: JsChallengeResult | null
  policyUsedFallback: boolean
  backendReachable: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: GatewayRuntimeContext
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n)))
}

function mapBackendPolicyToCompany(p: OrgPolicyFromBackend): CompanyPolicy {
  const challengeScore = clampScore(p.challengeMaxScore ?? 31)
  let temporaryBanScore = clampScore(
    Math.max(challengeScore + 1, p.rateLimitMaxScore ?? 81),
  )
  if (temporaryBanScore <= challengeScore) {
    temporaryBanScore = Math.min(100, challengeScore + 20)
  }
  let permanentBanScore = clampScore(p.permanentBanScore ?? 95)
  if (permanentBanScore < temporaryBanScore) {
    permanentBanScore = Math.min(100, temporaryBanScore + 10)
  }
  return {
    autoBanAfterFails: Math.max(0, Math.floor(p.autoBanAfterFails ?? 5)),
    temporaryBanMinutes: Math.max(1, p.temporaryBanMinutes ?? 15),
    permanentBanScore,
    banOnMaxRequests: Boolean(p.banOnMaxRequests),
    challengeScore,
    temporaryBanScore,
  }
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
    userAgent: ctx.signals.userAgent,
    deviceFingerprint: ctx.signals.deviceFingerprint,
    ja4: ctx.signals.ja4,
    ja3: ctx.signals.ja3,
    requestId: ctx.id,
    policy: backendPolicy,
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logging.level,
      transport: config.server.isDev
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
    bodyLimit: 1024 * 1024 * 2,
    trustProxy: true,
    genReqId: () => randomUUID(),
  })

  app.removeAllContentTypeParsers()
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    (request, body, done) => {
      ;(request as unknown as { rawBody?: Buffer }).rawBody = body as Buffer
      done(null, body)
    },
  )

  await app.register(cookie, {
    secret: config.clearance.secret,
    hook: 'onRequest',
  })

  app.decorateRequest('ctx', null as unknown as GatewayRuntimeContext)

  app.addHook('onRequest', async (request, _reply) => {
    const pathname = request.url.split('?')[0] ?? '/'
    if (
      pathname === '/internal' ||
      pathname.startsWith('/internal/') ||
      pathname === '/health' ||
      pathname === '/ready' ||
      pathname === '/debug/fingerprint'
    ) {
      return
    }

    const host = (request.headers.host ?? '').split(':')[0]!.toLowerCase()

    let signals: Signals = {
      ip: extractRealIp(request),
      ja4: null,
      ja3: null,
      deviceFingerprint: null,
      path: pathname,
      method: request.method,
      orgId: 'unknown',
      userAgent: (request.headers['user-agent'] as string) || null,
      requestSize: Number(request.headers['content-length']) || 0,
      timestamp: Date.now(),
      hasClearance: false,
      clearanceToken: null,
      host,
    }

    const fp = authenticateFromFastifyRequest(request)
    signals = applyFingerprintsToSignals(signals, fp)

    const clearanceCookie = request.cookies[config.clearance.cookieName]
    if (clearanceCookie) {
      signals.hasClearance = true
      signals.clearanceToken = clearanceCookie
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
      policyUsedFallback: true,
      backendReachable: false,
    }
  })

  app.addHook('onResponse', async (request, reply) => {
    const ctx = request.ctx as GatewayRuntimeContext | null
    if (!ctx?.startTime || !config.logging.logAllRequests) return
    request.log.info({
      requestId: ctx.id,
      host: ctx.signals.host,
      orgId: ctx.signals.orgId,
      path: ctx.signals.path,
      risk: (ctx.riskResult as RiskResult | null)?.score,
      route: ctx.routeDecision?.route,
      action: ctx.policyDecision?.action,
      rl: ctx.rateLimit?.level,
      js: ctx.jsChallenge?.phase,
      statusCode: reply.statusCode,
      ms: Date.now() - ctx.startTime,
    })
  })

  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as Error & { validation?: boolean; statusCode?: number }
    request.log.error({ err, requestId: request.id, url: request.url })
    if (err.validation) {
      return reply.status(400).send({
        success: false,
        error: 'Validation Error',
        message: err.message,
      })
    }
    const statusCode = err.statusCode || 500
    return reply.status(statusCode).send({
      success: false,
      error: statusCode >= 500 ? 'Internal Server Error' : err.message,
      requestId: request.id,
    })
  })

  app.get('/health', async (_req, reply) => {
    try {
      await getRedis().ping()
      return {
        status: 'ok',
        service: 'zero-plus-gateway',
        redis: 'connected',
        uptime: process.uptime(),
      }
    } catch (e) {
      reply.status(503)
      return {
        status: 'degraded',
        redis: 'disconnected',
        error: (e as Error).message,
      }
    }
  })

  app.get('/ready', async (_req, reply) => {
    try {
      await getRedis().ping()
      return { ready: true }
    } catch {
      reply.status(503)
      return { ready: false }
    }
  })

  if (config.server.isDev) {
    app.get('/debug/fingerprint', async (request, reply) => {
      return reply.send({
        success: true,
        data: authenticateFromFastifyRequest(request),
      })
    })
  }

  await app.register(
    async (internal) => {
      internal.addHook('onRequest', async (request, reply) => {
        const key = request.headers['x-gateway-key'] as string | undefined
        if (!key) {
          return reply
            .status(401)
            .send({ success: false, message: 'Missing X-Gateway-Key' })
        }
        if (key !== config.backend.internalSecret) {
          return reply
            .status(403)
            .send({ success: false, message: 'Invalid Gateway key' })
        }
      })

      internal.post('/probe', async (request, reply) => {
        const body = parseJsonBody<{
          url: string
          orgId: string
          serverId?: string
          timeoutMs?: number
        }>(request.body)
        if (!body?.url || !body?.orgId) {
          return reply.status(400).send({
            success: false,
            message: 'url and orgId are required',
          })
        }
        try {
          return { success: true, data: await probeOrigin(body) }
        } catch (err) {
          return reply.status(500).send({
            success: false,
            message: (err as Error).message,
          })
        }
      })

      internal.get('/status', async () => ({
        success: true,
        data: {
          service: 'zero-plus-gateway',
          uptime: process.uptime(),
        },
      }))
    },
    { prefix: '/internal' },
  )

  // ======================================================
  app.all('/*', async (request, reply) => {
    const ctx = request.ctx as GatewayRuntimeContext
    const host = ctx.signals.host

    if (!host) {
      return reply.status(400).send({
        success: false,
        error: 'Missing Host',
        requestId: ctx.id,
      })
    }

    let companyPolicy: Partial<CompanyPolicy> | null = null
    let backendPolicy: OrgPolicyFromBackend | null = null

    try {
      const resolved = await resolvePolicyByHost(host)
      ctx.resolved = resolved
      ctx.backendReachable = true
      ctx.signals.orgId = resolved.organizationId
      backendPolicy = resolved.policy

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
      }

      companyPolicy = mapBackendPolicyToCompany(resolved.policy)
      ctx.companyPolicy = companyPolicy
      ctx.policyUsedFallback = false

      if (resolved.server.status === 'MAINTENANCE') {
        return reply.status(503).send({
          success: false,
          error: 'Origin under maintenance',
          requestId: ctx.id,
        })
      }
    } catch (err) {
      request.log.warn({ err, host }, 'resolvePolicyByHost failed')
      return reply.status(502).send({
        success: false,
        error: 'Unable to resolve protected host',
        host,
        requestId: ctx.id,
      })
    }

    const orgId = ctx.signals.orgId
    const monitorOnly = ctx.server?.mode === 'MONITOR_ONLY'

    // ----- رد POST على تحدي JS (قبل ban الثقيل أحيانًا بعد resolve) -----
    if (isJsChallengeResponse(request)) {
      const js = await handleJsChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      )
      ctx.jsChallenge = js
      // TODO: analyzeTraffic(telemetryForAi(js.telemetry)) + event-logger
      request.log.info(
        {
          phase: js.phase,
          passed: js.passed,
          suspicion: js.telemetry.localSuspicionScore,
          hints: js.telemetry.suspicionHints,
        },
        'js challenge response',
      )

      if (js.passed) {
        setClearanceCookie(reply, {
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          policy: backendPolicy,
        })
        return forwardToOrigin(request, reply, ctx).then(() => reply)
      }

      if (!monitorOnly && js.telemetry.localSuspicionScore >= 0.75) {
        await applyBan({
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          banMinutes: companyPolicy?.temporaryBanMinutes ?? 120,
          reason: 'js_challenge_failed',
          source: 'gateway',
        })
      }

      return reply.status(403).send({
        success: false,
        error: 'Challenge failed',
        reasons: js.telemetry.failReasons,
        requestId: ctx.id,
      })
    }

    // ----- Ban -----
    const ban = await checkBan({
      organizationId: orgId,
      ip: ctx.signals.ip,
      deviceFingerprint: ctx.signals.deviceFingerprint,
    })
    if (ban.banned && !monitorOnly) {
      return reply.status(403).send({
        success: false,
        error: 'Access Denied',
        reason: 'banned',
        matchedBy: ban.matchedBy,
        requestId: ctx.id,
      })
    }

    // ----- Clearance fast path -----
    if (ctx.signals.hasClearance && ctx.signals.clearanceToken) {
      const cleared = verifyClearanceFromRequest(request, {
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        bindIp: false,
        bindDevice: true,
      })
      if (cleared.valid) {
        await forwardToOrigin(request, reply, ctx)
        return reply
      }
      revokeClearance(reply)
    }

    // ----- Reputation -----
    let priorHistory = false
    let badIp = false
    try {
      const rep = await lookupReputation({
        organizationId: orgId,
        ipAddress: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint ?? undefined,
        ja3Fingerprint: ctx.signals.ja3 ?? undefined,
        ja4Fingerprint: ctx.signals.ja4 ?? undefined,
      })
      if (rep.effective.isCurrentlyBanned && !monitorOnly) {
        await applyBan({
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          permanent: rep.effective.banStatus === 'PERMANENT',
          banMinutes: rep.effective.minutesLeftOnBan ?? 120,
          reason: 'backend_reputation_ban',
          source: 'backend_sync',
        })
        return reply.status(403).send({
          success: false,
          error: 'Access Denied',
          reason: 'reputation_banned',
          requestId: ctx.id,
        })
      }
      priorHistory =
        rep.effective.score >= 5 || rep.effective.failedChecksCount > 0
      badIp =
        rep.effective.isKnownBotnet ||
        rep.effective.reputationRiskPoints >= 10
      ctx.reputation = {
        ip: ctx.signals.ip,
        score: rep.effective.score,
        bannedUntil: rep.effective.bannedUntil
          ? Date.parse(rep.effective.bannedUntil)
          : null,
        isPermanent: rep.effective.banStatus === 'PERMANENT',
        points: rep.effective.reputationRiskPoints,
      }
    } catch (err) {
      request.log.debug({ err }, 'reputation lookup skipped')
    }

    // ----- Rate limit -----
    const rl = await checkRateLimit({
      organizationId: orgId,
      ip: ctx.signals.ip,
      deviceFingerprint: ctx.signals.deviceFingerprint,
      policy: backendPolicy,
    })
    ctx.rateLimit = rl
    applyRateLimitHeaders(reply, rl)

    if (rl.shouldBanOnHard && !monitorOnly) {
      await applyBan({
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        banMinutes: companyPolicy?.temporaryBanMinutes ?? 120,
        reason: 'hard_rate_limit',
        source: 'gateway',
      })
      return reply.status(403).send({
        success: false,
        error: 'Access Denied',
        reason: 'hard_rate_limit',
        requestId: ctx.id,
      })
    }
    if (rl.hardExceeded && !monitorOnly) {
      return reply.status(429).send({
        success: false,
        error: 'Too Many Requests',
        reason: 'hard_rate_limit',
        requestId: ctx.id,
      })
    }

    // ----- AI (لاحقًا: ابعت edge + JS telemetry) -----
    let aiAnomalyScore: number | null = null

    const risk = calculateRisk({
      badIp,
      highRequestRate: rl.highRequestRate,
      aiAnomalyScore,
      suspiciousFingerprint: false,
      priorHistory,
    })
    ctx.riskResult = risk as unknown as RequestContext['riskResult']

    const routeDecision = routeSuspicion({
      riskScore: risk.score,
      isBlacklisted: ban.banned,
      policy: companyPolicy,
    })
    ctx.routeDecision = routeDecision

    const policyDecision = decidePolicy(
      {
        riskScore: risk.score,
        failedChallenges: 0,
        maxRequestsExceeded: rl.maxRequestsExceeded,
      },
      companyPolicy,
    )
    ctx.policyDecision = policyDecision

    request.log.info(
      {
        host,
        orgId,
        risk: risk.score,
        route: routeDecision.route,
        policy: policyDecision.action,
        rl: rl.level,
        ja4: ctx.signals.ja4,
      },
      'pipeline decision',
    )

    if (monitorOnly) {
      await forwardToOrigin(request, reply, ctx)
      return reply
    }

    if (
      policyDecision.action === 'permanent_ban' ||
      policyDecision.action === 'temporary_ban' ||
      routeDecision.route === 'ban'
    ) {
      const banDecision = routeDecision.ban ?? policyDecision
      await applyBanFromDecision({
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        decision: {
          action: banDecision.action,
          banMinutes: banDecision.banMinutes,
          reason: routeDecision.reason || policyDecision.reason,
        },
      })
      return reply.status(403).send({
        success: false,
        error: 'Access Denied',
        reason: routeDecision.reason || policyDecision.reason,
        requestId: ctx.id,
      })
    }

    // ----- إصدار تحدي JS -----
    const runSilentJs = async () => {
      const js = await handleJsChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      )
      ctx.jsChallenge = js
      // TODO: AI ← telemetryForAi(js.telemetry) + edge signals
      if (js.responseSent) return reply
      if (js.phase === 'disabled' || js.passed) {
        setClearanceCookie(reply, {
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          policy: backendPolicy,
        })
        await forwardToOrigin(request, reply, ctx)
        return reply
      }
      return reply.status(403).send({
        success: false,
        error: 'Challenge failed',
        requestId: ctx.id,
      })
    }

    switch (routeDecision.route) {
      case 'advanced_fingerprint_check':
        // TODO: advanced-fingerprint-challenge.ts
        // مؤقتًا: نفس JS أقوى مسارًا (لسه مش البديل النهائي)
        return runSilentJs()

      case 'rate_limit_with_challenge':
        if (rl.softExceeded || risk.score > 30) {
          reply.header('Retry-After', String(rl.windows.softSec))
          return runSilentJs()
        }
        break

      case 'silent_js_challenge':
        return runSilentJs()

      default:
        break
    }

    if (policyDecision.action === 'rate_limit') {
      reply.header('Retry-After', '30')
      return reply.status(429).send({
        success: false,
        error: 'Too Many Requests',
        reason: policyDecision.reason,
        requestId: ctx.id,
      })
    }

    await forwardToOrigin(request, reply, ctx)
    return reply
  })

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, async () => {
      try {
        await app.close()
        await closeRedis()
        process.exit(0)
      } catch {
        process.exit(1)
      }
    })
  }

  return app
}

function extractRealIp(request: FastifyRequest): string {
  const realIp = request.headers[config.security.realIpHeaderName] as string
  if (realIp) return realIp.split(',')[0]!.trim()
  const forwarded = request.headers[
    config.security.forwardedForHeaderName
  ] as string
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return request.ip || '0.0.0.0'
}

function parseJsonBody<T>(body: unknown): T | null {
  try {
    if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8')) as T
    if (typeof body === 'string') return JSON.parse(body) as T
    if (body && typeof body === 'object') return body as T
    return null
  } catch {
    return null
  }
}

export default buildApp