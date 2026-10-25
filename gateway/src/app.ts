// ======================================================
// ZERO PLUS GATEWAY — Fastify Application
// الملف المركزي اللي بيبني الـ App كله
// ======================================================
//
// المسؤوليات:
// 1. إنشاء instance من Fastify
// 2. تسجيل الـ Plugins الأساسية
// 3. تسجيل الـ Hooks (onRequest, preHandler, onResponse...)
// 4. راوتر الزوار الرئيسي (/*)
// 5. راوترات داخلية حقيقية محمية (/internal/*) للـ Backend
// 6. Error Handler مركزي + Health Checks
// 7. بصمات TLS/جهاز عبر fingerprint-authenticator
//
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
import type { RequestContext, Signals } from './types'

// ======================================================
// استيراد الملفات المستقبلية (شيل الكومنت أول ما الملف يبقى جاهز)
// ======================================================

// --- Core ---
// import { calculateRisk } from './core/risk.engine'
// import { applyPolicy } from './core/policy.engine'

// --- Detection ---
// import { routeBySuspicion } from './detection/suspicion-router'
// import { checkBan } from './detection/ban.manager'
// import { checkRateLimit } from './detection/rate-limiter'
// import { getIpReputation } from './detection/ip-reputation'
import {
  authenticateFromFastifyRequest,
  applyFingerprintsToSignals,
} from './detection/fingerprint-authenticator'

// --- Challenge ---
// import { handleJsChallenge } from './challenge/js-challenge'
// import { issueClearance, verifyClearance } from './challenge/clearance'

// --- Proxy ---
import { forwardToOrigin } from './proxy/forwardToOrigin'

// --- Logging ---
// import { logSecurityEvent } from './logging/event-logger'

// ======================================================
// Type augmentation
// ======================================================

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext
  }
}

// ======================================================
// إنشاء الـ App
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

  // ======================================================
  // 0. Content Type Parser — body خام للـ Origin
  // ======================================================

  app.removeAllContentTypeParsers()
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    (request, body, done) => {
      ;(request as unknown as { rawBody?: Buffer }).rawBody = body as Buffer
      done(null, body)
    },
  )

  // ======================================================
  // 1. Plugins
  // ======================================================

  await app.register(cookie, {
    secret: config.clearance.secret,
    hook: 'onRequest',
  })

  // ======================================================
  // 2. Decorators
  // ======================================================

  app.decorateRequest('ctx', null as unknown as RequestContext)

  // ======================================================
  // 3. Hooks
  // ======================================================

  app.addHook(
    'onRequest',
    async (request: FastifyRequest, _reply: FastifyReply) => {
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

      const startTime = Date.now()

      // إشارات أولية (IP / path / …) — البصمات تتعبى من الـ authenticator
      let signals: Signals = {
        ip: extractRealIp(request),
        ja4: null,
        ja3: null,
        deviceFingerprint: null,
        path: pathname,
        method: request.method,
        orgId: (request.headers['x-org-id'] as string) || 'default',
        userAgent: (request.headers['user-agent'] as string) || null,
        requestSize: Number(request.headers['content-length']) || 0,
        timestamp: Date.now(),
        hasClearance: false,
        clearanceToken: null,
        host: (request.headers.host ?? '').split(':')[0]!.toLowerCase(),
      }

      // ---- بصمات TLS + جهاز (آمن: يتجاهل التزوير من غير Edge) ----
      const fp = authenticateFromFastifyRequest(request, {
        // خليه false إلا لو عارف إن كل الترافيك من شبكة داخلية موثوقة
        trustEdgeHeader: false,
      })
      signals = applyFingerprintsToSignals(signals, fp)

      if (fp.notes.length > 0) {
        request.log.debug(
          { notes: fp.notes, trustedEdge: fp.tls.fromTrustedEdge },
          'fingerprint-auth',
        )
      }

      const clearanceCookie = request.cookies[config.clearance.cookieName]
      if (clearanceCookie) {
        signals.hasClearance = true
        signals.clearanceToken = clearanceCookie
      }

      const ctx: RequestContext = {
        id: request.id,
        signals,
        reputation: null,
        riskResult: null,
        decision: null,
        startTime,
      }

      request.ctx = ctx
    },
  )

  app.addHook('onResponse', async (request, reply) => {
    const ctx = request.ctx as RequestContext | null
    if (!ctx) return

    const processingTime = Date.now() - ctx.startTime

    if (config.logging.logAllRequests) {
      request.log.info({
        requestId: ctx.id,
        ip: ctx.signals.ip,
        path: ctx.signals.path,
        ja4: ctx.signals.ja4,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        statusCode: reply.statusCode,
        processingTimeMs: processingTime,
      })
    }
  })

  // ======================================================
  // 4. Error Handler
  // ======================================================

  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as Error & {
      validation?: boolean
      statusCode?: number
      message?: string
    }

    request.log.error({
      err,
      requestId: request.id,
      url: request.url,
    })

    if (err.validation) {
      return reply.status(400).send({
        success: false,
        error: 'Validation Error',
        message: err.message || 'Validation failed',
      })
    }

    const statusCode = err.statusCode || 500
    return reply.status(statusCode).send({
      success: false,
      error: statusCode >= 500 ? 'Internal Server Error' : err.message || 'Error',
      requestId: request.id,
    })
  })

  // ======================================================
  // 5. Health & Ready
  // ======================================================

  app.get('/health', async (_request, reply) => {
    try {
      const redis = getRedis()
      await redis.ping()
      return {
        status: 'ok',
        service: 'zero-plus-gateway',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        redis: 'connected',
      }
    } catch (err) {
      reply.status(503)
      return {
        status: 'degraded',
        service: 'zero-plus-gateway',
        redis: 'disconnected',
        error: (err as Error).message,
      }
    }
  })

  app.get('/ready', async (_request, reply) => {
    try {
      const redis = getRedis()
      await redis.ping()
      return { ready: true }
    } catch {
      reply.status(503)
      return { ready: false }
    }
  })

  // ======================================================
  // 5b. Debug fingerprint (تطوير فقط — احذفه أو احميه في الإنتاج)
  // ======================================================

  if (config.server.isDev) {
    app.get('/debug/fingerprint', async (request, reply) => {
      const fp = authenticateFromFastifyRequest(request, {
        trustEdgeHeader: false,
      })
      return reply.send({
        success: true,
        data: fp,
        tip: 'جرّب مع/من غير X-Edge-Server و X-JA4 — شوف notes',
      })
    })
  }

  // ======================================================
  // 6. Internal Routes
  // ======================================================

  await app.register(
    async (internal) => {
      internal.addHook('onRequest', async (request, reply) => {
        const key = request.headers['x-gateway-key'] as string | undefined

        if (!key) {
          return reply.status(401).send({
            success: false,
            message: 'Missing X-Gateway-Key header',
          })
        }

        if (key !== config.backend.internalSecret) {
          return reply.status(403).send({
            success: false,
            message: 'Invalid Gateway key',
          })
        }
      })

      internal.post<{
        Body: {
          url: string
          orgId: string
          serverId?: string
          timeoutMs?: number
        }
      }>('/probe', async (request, reply) => {
        const body = parseJsonBody<{
          url: string
          orgId: string
          serverId?: string
          timeoutMs?: number
        }>(request.body)

        const { url, orgId, serverId, timeoutMs } =
          body ?? ({} as Partial<NonNullable<typeof body>>)

        if (!url || !orgId) {
          return reply.status(400).send({
            success: false,
            code: 'VALIDATION_ERROR',
            message: 'url and orgId are required',
          })
        }

        try {
          const result = await probeOrigin({
            url,
            orgId,
            serverId,
            timeoutMs,
          })

          return {
            success: true,
            data: result,
          }
        } catch (err) {
          request.log.error(err)
          return reply.status(500).send({
            success: false,
            code: 'PROBE_FAILED',
            message: (err as Error).message,
          })
        }
      })

      internal.get('/status', async () => {
        return {
          success: true,
          data: {
            service: 'zero-plus-gateway',
            env: config.server.nodeEnv,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
          },
        }
      })
    },
    { prefix: '/internal' },
  )

  // ======================================================
  // 7. Main Visitor Route
  // ======================================================

  app.all('/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.ctx as RequestContext

    // Pipeline لاحقًا: ban → clearance → rate → risk → policy …

    const result = await forwardToOrigin(request, reply, ctx)

    request.log.debug(
      {
        requestId: ctx.id,
        ja4: ctx.signals.ja4,
        ja3: ctx.signals.ja3,
        deviceFingerprint: ctx.signals.deviceFingerprint,
        statusCode: result.statusCode,
        originHealthy: result.originHealthy,
        responseTimeMs: result.responseTimeMs,
        error: result.error,
      },
      'Forwarded to origin',
    )

    return reply
  })

  // ======================================================
  // 8. Graceful Shutdown
  // ======================================================

  const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
  shutdownSignals.forEach((signal) => {
    process.once(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`)
      try {
        await app.close()
        await closeRedis()
        app.log.info('Gateway shut down complete')
        process.exit(0)
      } catch (err) {
        app.log.error(err)
        process.exit(1)
      }
    })
  })

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