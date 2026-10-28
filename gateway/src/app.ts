// ======================================================
// ZERO PLUS GATEWAY — Fastify Application (كامل موصول)
// Host → Backend → Ban → Clearance → IP-Rep → Rate
// → Risk → Router → Advanced / JS / Ban / Forward
// + event-logger + request logging (middleware مدمج)
// + Origin Probe غير متزامن (202 Accepted)
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
  inspectIpReputation,
  type IpReputationResult,
} from './detection/ip-reputation'
import {
  verifyClearanceFromRequest,
  setClearanceCookie,
  revokeClearance,
} from './challenge/clearance'
import {
  handleJsChallenge,
  isJsChallengeResponse,
  type JsChallengeResult,
} from './challenge/js-challenge'
import {
  handleAdvancedFingerprintChallenge,
  isAdvancedChallengeResponse,
  type AdvancedChallengeResult,
} from './challenge/advanced-fingerprint-challenge'
import {
  logSecurityEvent,
  flushEventLogger,
} from './logging/event-logger'
import { forwardToOrigin } from './proxy/forwardToOrigin'
import type { RequestContext, Signals } from './types'

// import { analyzeTraffic } from './services/ai.client'

// ======================================================
// Origin Probe — تحكم في التوازي والحماية
// ======================================================

const runningProbes = new Set<string>()
const MAX_CONCURRENT_PROBES = 2

/**
 * في الإنتاج: نمنع قياس Origins داخلية (SSRF)
 * في التطوير: مسموح localhost
 */
function isBlockedOrigin(rawUrl: string): boolean {
  if (process.env.NODE_ENV !== 'production') return false
  const { hostname } = new URL(rawUrl)
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host === '::1' ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

// ======================================================
// Runtime context
// ======================================================

export interface GatewayRuntimeContext extends RequestContext {
  resolved: PolicyResolveData | null
  server: GatewayServer | null
  companyPolicy: Partial<CompanyPolicy> | null
  policyDecision: PolicyDecision | null
  routeDecision: RouteDecision | null
  rateLimit: RateLimitResult | null
  jsChallenge: JsChallengeResult | null
  advancedChallenge: AdvancedChallengeResult | null
  ipReputation: IpReputationResult | null
  policyUsedFallback: boolean
  backendReachable: boolean
  /** قرار نهائي للّوج */
  finalDecision: string | null
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
    method: ctx.signals.method,
    userAgent: ctx.signals.userAgent,
    deviceFingerprint: ctx.signals.deviceFingerprint,
    ja4: ctx.signals.ja4,
    ja3: ctx.signals.ja3,
    requestId: ctx.id,
    policy: backendPolicy,
  }
}

function emitEvent(
  ctx: GatewayRuntimeContext,
  decision: string,
  extra?: { referer?: string | null },
): void {
  if (!ctx.server?.id || !ctx.signals.orgId) return
  ctx.finalDecision = decision
  logSecurityEvent({
    organizationId: ctx.signals.orgId,
    serverId: ctx.server.id,
    ipAddress: ctx.signals.ip,
    path: ctx.signals.path,
    method: ctx.signals.method,
    requestId: ctx.id,
    userAgent: ctx.signals.userAgent,
    referer: extra?.referer,
    riskScore: (ctx.riskResult as RiskResult | null)?.score ?? 0,
    decision,
    processingTimeMs: Date.now() - ctx.startTime,
    riskResult: ctx.riskResult as RiskResult | null,
    routeDecision: ctx.routeDecision,
    policyDecision: ctx.policyDecision,
    rateLimit: ctx.rateLimit,
    ja3: ctx.signals.ja3,
    ja4: ctx.signals.ja4,
    deviceFingerprint: ctx.signals.deviceFingerprint,
    jsChallenge: ctx.jsChallenge,
    advancedChallenge: ctx.advancedChallenge,
    ipType: ctx.ipReputation?.kind ?? null,
    anomalyScore:
      ctx.jsChallenge?.telemetry.localSuspicionScore ??
      ctx.advancedChallenge?.telemetry.localSuspicionScore ??
      ctx.ipReputation?.networkRiskScore ??
      null,
  })
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

  // ----- body خام (middleware مدمج) -----
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

  // ----- onRequest: إشارات + بصمات -----
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
      advancedChallenge: null,
      ipReputation: null,
      policyUsedFallback: true,
      backendReachable: false,
      finalDecision: null,
    }
  })

  // ----- onResponse: لوج طلب -----
  app.addHook('onResponse', async (request, reply) => {
    const ctx = request.ctx as GatewayRuntimeContext | null
    if (!ctx?.startTime) return

    const ms = Date.now() - ctx.startTime
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
        statusCode: reply.statusCode,
        ms,
      })
    }
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
        probesRunning: runningProbes.size,
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

  // ======================================================
  // Internal (Backend → Gateway)
  // ======================================================
  await app.register(
    async (internal) => {
      internal.addHook('onRequest', async (request, reply) => {
        const key = request.headers['x-gateway-key'] as string | undefined
        if (!key) {
          return reply
            .status(401)
            .send({ success: false, message: 'Missing X-Gateway-Key header' })
        }
        if (key !== config.backend.internalSecret) {
          return reply
            .status(403)
            .send({ success: false, message: 'Invalid Gateway key' })
        }
      })

      /**
       * POST /internal/probe
       * يشغّل Origin Probe في الخلفية ويرد 202 فورًا
       * (القياس بياخد دقيقة+ وما ينفعش يستنى الـ HTTP)
       */
      internal.post('/probe', async (request, reply) => {
        const body = parseJsonBody<{
          url: string
          orgId: string
          serverId?: string
          timeoutMs?: number
          mode?: 'light' | 'full'
        }>(request.body)

        if (!body?.url || !body?.orgId) {
          return reply.status(400).send({
            success: false,
            message: 'url and orgId are required',
          })
        }

        try {
          if (isBlockedOrigin(body.url)) {
            return reply.status(400).send({
              success: false,
              message: 'Origin address not allowed',
            })
          }
        } catch {
          return reply.status(400).send({
            success: false,
            message: 'Invalid url',
          })
        }

        const key = body.serverId ?? body.url

        if (runningProbes.has(key)) {
          return reply.status(409).send({
            success: false,
            message: 'Probe already running',
          })
        }

        if (runningProbes.size >= MAX_CONCURRENT_PROBES) {
          return reply.status(429).send({
            success: false,
            message: 'Too many concurrent probes',
          })
        }

        runningProbes.add(key)

        // تشغيل في الخلفية — النتيجة بتروح للـ Backend عبر sendOriginProbeResult
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
                orgId: body.orgId,
                sustainedRps: result.summary.estimatedMaxRps,
                safeRps: result.summary.safeRps,
                confidence: result.summary.confidence,
              },
              'Origin probe completed',
            )
          })
          .catch((err) => {
            request.log.error({ err, key }, 'Origin probe failed')
          })
          .finally(() => {
            runningProbes.delete(key)
          })

        return reply.status(202).send({
          success: true,
          message: 'Probe started',
          data: {
            serverId: body.serverId ?? null,
            orgId: body.orgId,
            acceptedAt: new Date().toISOString(),
          },
        })
      })

      internal.get('/status', async () => ({
        success: true,
        data: {
          service: 'zero-plus-gateway',
          uptime: process.uptime(),
          probesRunning: runningProbes.size,
          maxConcurrentProbes: MAX_CONCURRENT_PROBES,
        },
      }))
    },
    { prefix: '/internal' },
  )

  // ======================================================
  // Visitor pipeline
  // ======================================================
  app.all('/*', async (request, reply) => {
    const ctx = request.ctx as GatewayRuntimeContext
    const host = ctx.signals.host
    const referer = (request.headers.referer as string) || null

    if (!host) {
      return reply.status(400).send({
        success: false,
        error: 'Missing Host',
        requestId: ctx.id,
      })
    }

    let companyPolicy: Partial<CompanyPolicy> | null = null
    let backendPolicy: OrgPolicyFromBackend | null = null

    // 1) Backend resolve
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
        emitEvent(ctx, 'BLOCK', { referer })
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

    // 2) POST رد تحدي JS
    if (isJsChallengeResponse(request)) {
      const js = await handleJsChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      )
      ctx.jsChallenge = js
      request.log.info(
        {
          phase: js.phase,
          passed: js.passed,
          suspicion: js.telemetry.localSuspicionScore,
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
        emitEvent(ctx, 'ALLOW', { referer })
        await forwardToOrigin(request, reply, ctx)
        return reply
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
      emitEvent(ctx, 'BLOCK', { referer })
      return reply.status(403).send({
        success: false,
        error: 'Challenge failed',
        reasons: js.telemetry.failReasons,
        requestId: ctx.id,
      })
    }

    // 3) POST رد advanced
    if (isAdvancedChallengeResponse(request)) {
      const adv = await handleAdvancedFingerprintChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      )
      ctx.advancedChallenge = adv
      if (adv.responseSent) {
        emitEvent(ctx, 'CHALLENGE', { referer })
        return reply
      }
      if (adv.passed) {
        setClearanceCookie(reply, {
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          policy: backendPolicy,
        })
        emitEvent(ctx, 'ALLOW', { referer })
        await forwardToOrigin(request, reply, ctx)
        return reply
      }
      emitEvent(ctx, 'BLOCK', { referer })
      return reply.status(403).send({
        success: false,
        error: 'Advanced fingerprint check failed',
        codes: adv.telemetry.failCodes,
        requestId: ctx.id,
      })
    }

    // 4) Ban list
    const ban = await checkBan({
      organizationId: orgId,
      ip: ctx.signals.ip,
      deviceFingerprint: ctx.signals.deviceFingerprint,
    })
    if (ban.banned && !monitorOnly) {
      emitEvent(ctx, 'BLOCK', { referer })
      return reply.status(403).send({
        success: false,
        error: 'Access Denied',
        reason: 'banned',
        matchedBy: ban.matchedBy,
        requestId: ctx.id,
      })
    }

    // 5) Clearance fast path
    if (ctx.signals.hasClearance && ctx.signals.clearanceToken) {
      const cleared = verifyClearanceFromRequest(request, {
        organizationId: orgId,
        ip: ctx.signals.ip,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        bindIp: false,
        bindDevice: true,
      })
      if (cleared.valid) {
        emitEvent(ctx, 'ALLOW', { referer })
        await forwardToOrigin(request, reply, ctx)
        return reply
      }
      revokeClearance(reply)
    }

    // 6) Backend reputation
    let priorHistory = false
    let badIpFromRep = false
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
        emitEvent(ctx, 'BLOCK', { referer })
        return reply.status(403).send({
          success: false,
          error: 'Access Denied',
          reason: 'reputation_banned',
          requestId: ctx.id,
        })
      }
      priorHistory =
        rep.effective.score >= 5 || rep.effective.failedChecksCount > 0
      badIpFromRep =
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

    // 7) IP reputation
    let ipRep: IpReputationResult | null = null
    try {
      ipRep = await inspectIpReputation({
        ip: ctx.signals.ip,
        organizationId: orgId,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        ja3: ctx.signals.ja3,
        ja4: ctx.signals.ja4,
        headers: request.headers as Record<
          string,
          string | string[] | undefined
        >,
      })
      ctx.ipReputation = ipRep
    } catch (err) {
      request.log.debug({ err }, 'ip reputation skipped')
    }

    const badIp = badIpFromRep || Boolean(ipRep?.badIp)

    // 8) Rate limit
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
      emitEvent(ctx, 'BLOCK', { referer })
      return reply.status(403).send({
        success: false,
        error: 'Access Denied',
        reason: 'hard_rate_limit',
        requestId: ctx.id,
      })
    }
    if (rl.hardExceeded && !monitorOnly) {
      emitEvent(ctx, 'RATE_LIMIT', { referer })
      return reply.status(429).send({
        success: false,
        error: 'Too Many Requests',
        reason: 'hard_rate_limit',
        requestId: ctx.id,
      })
    }

    // 9) AI (لاحقًا)
    const aiAnomalyScore: number | null = null

    // 10) Risk
    const risk = calculateRisk({
      badIp,
      highRequestRate: rl.highRequestRate,
      aiAnomalyScore,
      suspiciousFingerprint: false,
      priorHistory,
    })
    ctx.riskResult = risk as unknown as RequestContext['riskResult']

    // 11) Router + Policy
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
        ipKind: ipRep?.kind,
        ja4: ctx.signals.ja4,
      },
      'pipeline decision',
    )

    if (monitorOnly) {
      emitEvent(ctx, 'MONITOR', { referer })
      await forwardToOrigin(request, reply, ctx)
      return reply
    }

    // 12) Ban من policy/router
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
      emitEvent(ctx, 'BLOCK', { referer })
      return reply.status(403).send({
        success: false,
        error: 'Access Denied',
        reason: routeDecision.reason || policyDecision.reason,
        requestId: ctx.id,
      })
    }

    // 13) مسارات التحدي
    const runSilentJs = async () => {
      const js = await handleJsChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      )
      ctx.jsChallenge = js
      if (js.responseSent) {
        emitEvent(ctx, 'CHALLENGE', { referer })
        return reply
      }
      if (js.phase === 'disabled' || js.passed) {
        setClearanceCookie(reply, {
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          policy: backendPolicy,
        })
        emitEvent(ctx, 'ALLOW', { referer })
        await forwardToOrigin(request, reply, ctx)
        return reply
      }
      emitEvent(ctx, 'BLOCK', { referer })
      return reply.status(403).send({
        success: false,
        error: 'Challenge failed',
        requestId: ctx.id,
      })
    }

    const runAdvanced = async () => {
      const adv = await handleAdvancedFingerprintChallenge(
        request,
        reply,
        challengeCtx(ctx, backendPolicy),
      )
      ctx.advancedChallenge = adv
      if (adv.responseSent) {
        emitEvent(ctx, 'CHALLENGE', { referer })
        return reply
      }
      if (adv.passed) {
        setClearanceCookie(reply, {
          organizationId: orgId,
          ip: ctx.signals.ip,
          deviceFingerprint: ctx.signals.deviceFingerprint,
          policy: backendPolicy,
        })
        emitEvent(ctx, 'ALLOW', { referer })
        await forwardToOrigin(request, reply, ctx)
        return reply
      }
      if (adv.telemetry.verdict === 'need_client_proof') {
        return runSilentJs()
      }
      emitEvent(ctx, 'BLOCK', { referer })
      return reply.status(403).send({
        success: false,
        error: 'Advanced fingerprint check failed',
        codes: adv.telemetry.failCodes,
        requestId: ctx.id,
      })
    }

    switch (routeDecision.route) {
      case 'advanced_fingerprint_check':
        return runAdvanced()

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
      emitEvent(ctx, 'RATE_LIMIT', { referer })
      reply.header('Retry-After', '30')
      return reply.status(429).send({
        success: false,
        error: 'Too Many Requests',
        reason: policyDecision.reason,
        requestId: ctx.id,
      })
    }

    emitEvent(ctx, 'ALLOW', { referer })
    await forwardToOrigin(request, reply, ctx)
    return reply
  })

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, async () => {
      try {
        await flushEventLogger()
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

// ======================================================
// Helpers
// ======================================================

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