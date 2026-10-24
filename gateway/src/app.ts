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
//
// ======================================================

import { randomUUID } from 'node:crypto';
import Fastify, {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import cookie from '@fastify/cookie';
import { config } from './config';
import { getRedis, closeRedis } from './services/redis.client';
import { probeOrigin } from './services/origin.probe';
import type { RequestContext, Signals } from './types';

// ======================================================
// استيراد الملفات المستقبلية (شيل الكومنت أول ما الملف يبقى جاهز)
// ======================================================

// --- Core ---
// import { calculateRisk } from './core/risk.engine';
// import { applyPolicy } from './core/policy.engine';

// --- Detection ---
// import { routeBySuspicion } from './detection/suspicion-router';
// import { checkBan } from './detection/ban.manager';
// import { checkRateLimit } from './detection/rate-limiter';
// import { getIpReputation } from './detection/ip-reputation';
// import { authenticateFingerprint } from './detection/fingerprint-authenticator';

// --- Challenge ---
// import { handleJsChallenge } from './challenge/js-challenge';
// import { issueClearance, verifyClearance } from './challenge/clearance';

// --- Proxy ---
import { forwardToOrigin } from './proxy/forwardToOrigin';

// --- Logging ---
// import { logSecurityEvent } from './logging/event-logger';

// ======================================================
// Type augmentation: عشان نشيل كل الـ @ts-ignore
// ======================================================

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
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
    bodyLimit: 1024 * 1024 * 2, // 2MB
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  // ======================================================
  // 0. Content Type Parser
  // الـ Gateway لازم يمرر الـ body زي ما هو من غير parse،
  // عشان أي نوع (JSON, form, multipart, ...) يوصل للـ Origin سليم.
  // الـ forwardToOrigin بيقرا request.rawBody
  // ======================================================

  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    (request, body, done) => {
      (request as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
      done(null, body);
    },
  );

  // ======================================================
  // 1. Plugins
  // ======================================================

  await app.register(cookie, {
    secret: config.clearance.secret,
    hook: 'onRequest',
  });

  // ======================================================
  // 2. Decorators
  // ======================================================

  app.decorateRequest('ctx', null as unknown as RequestContext);

  // ======================================================
  // 3. Hooks
  // ======================================================

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    // نتجاهل الراوترات الداخلية من الـ pipeline العادي
    const pathname = request.url.split('?')[0];
    if (
      pathname === '/internal' ||
      pathname.startsWith('/internal/') ||
      pathname === '/health' ||
      pathname === '/ready'
    ) {
      return;
    }

    const startTime = Date.now();

    const signals: Signals = {
      ip: extractRealIp(request),
      ja4: (request.headers[config.security.ja4HeaderName] as string) || null,
      ja3: (request.headers[config.security.ja3HeaderName] as string) || null,
      deviceFingerprint: (request.headers['x-device-fingerprint'] as string) || null,
      path: pathname,
      method: request.method,
      orgId: (request.headers['x-org-id'] as string) || 'default',
      userAgent: (request.headers['user-agent'] as string) || null,
      requestSize: Number(request.headers['content-length']) || 0,
      timestamp: Date.now(),
      hasClearance: false,
      clearanceToken: null,
      // الـ Host من غير البورت (الـ proxy بيستخدمه لإيجاد السيرفر)
      host: (request.headers.host ?? '').split(':')[0].toLowerCase(),
    };

    const clearanceCookie = request.cookies[config.clearance.cookieName];
    if (clearanceCookie) {
      signals.hasClearance = true;
      signals.clearanceToken = clearanceCookie;
    }

    const ctx: RequestContext = {
      id: request.id,
      signals,
      reputation: null,
      riskResult: null,
      decision: null,
      startTime,
    };

    request.ctx = ctx;
  });

  app.addHook('onResponse', async (request, reply) => {
    const ctx = request.ctx as RequestContext | null;
    if (!ctx) return;

    const processingTime = Date.now() - ctx.startTime;

    if (config.logging.logAllRequests) {
      request.log.info({
        requestId: ctx.id,
        ip: ctx.signals.ip,
        path: ctx.signals.path,
        statusCode: reply.statusCode,
        processingTimeMs: processingTime,
      });
    }
  });

  // ======================================================
  // 4. Error Handler
  // ======================================================

  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as Error & {
      validation?: boolean;
      statusCode?: number;
      message?: string;
    };

    request.log.error({
      err,
      requestId: request.id,
      url: request.url,
    });

    if (err.validation) {
      return reply.status(400).send({
        success: false,
        error: 'Validation Error',
        message: err.message || 'Validation failed',
      });
    }

    const statusCode = err.statusCode || 500;
    return reply.status(statusCode).send({
      success: false,
      error: statusCode >= 500 ? 'Internal Server Error' : err.message || 'Error',
      requestId: request.id,
    });
  });

  // ======================================================
  // 5. Health & Ready (عامة)
  // ======================================================

  app.get('/health', async (_request, reply) => {
    try {
      const redis = getRedis();
      await redis.ping();
      return {
        status: 'ok',
        service: 'zero-plus-gateway',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        redis: 'connected',
      };
    } catch (err) {
      reply.status(503);
      return {
        status: 'degraded',
        service: 'zero-plus-gateway',
        redis: 'disconnected',
        error: (err as Error).message,
      };
    }
  });

  app.get('/ready', async (_request, reply) => {
    try {
      const redis = getRedis();
      await redis.ping();
      return { ready: true };
    } catch {
      reply.status(503);
      return { ready: false };
    }
  });

  // ======================================================
  // 6. Internal Routes (محمية — للـ Backend فقط)
  // ======================================================

  await app.register(async (internal) => {
    // ---- Middleware حماية لكل الراوترات الداخلية ----
    internal.addHook('onRequest', async (request, reply) => {
      const key = request.headers['x-gateway-key'] as string | undefined;

      if (!key) {
        return reply.status(401).send({
          success: false,
          message: 'Missing X-Gateway-Key header',
        });
      }

      if (key !== config.backend.internalSecret) {
        return reply.status(403).send({
          success: false,
          message: 'Invalid Gateway key',
        });
      }
    });

    /**
     * POST /internal/probe
     * الـ Backend ينادي الراوتر ده لما يحب يعمل Origin Probe
     *
     * Body:
     * {
     *   "url": "http://203.0.113.5:443",
     *   "orgId": "uuid",
     *   "serverId": "uuid"   // اختياري بس مهم عشان يتسجل في الـ Backend
     * }
     */
    internal.post<{
      Body: {
        url: string;
        orgId: string;
        serverId?: string;
        timeoutMs?: number;
      };
    }>('/probe', async (request, reply) => {
      // الـ body وصل كـ Buffer بسبب الـ parser العام، فنحوله لـ JSON هنا
      const body = parseJsonBody<{
        url: string;
        orgId: string;
        serverId?: string;
        timeoutMs?: number;
      }>(request.body);

      const { url, orgId, serverId, timeoutMs } = body ?? ({} as Partial<NonNullable<typeof body>>);

      if (!url || !orgId) {
        return reply.status(400).send({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'url and orgId are required',
        });
      }

      try {
        const result = await probeOrigin({
          url,
          orgId,
          serverId,
          timeoutMs,
        });

        return {
          success: true,
          data: result,
        };
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({
          success: false,
          code: 'PROBE_FAILED',
          message: (err as Error).message,
        });
      }
    });

    /**
     * GET /internal/status
     * حالة سريعة للـ Gateway من جوه
     */
    internal.get('/status', async () => {
      return {
        success: true,
        data: {
          service: 'zero-plus-gateway',
          env: config.server.nodeEnv,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        },
      };
    });

  }, { prefix: '/internal' });

  // ======================================================
  // 7. Main Visitor Route (كل ترافيك الزوار)
  // ======================================================

  app.all('/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.ctx as RequestContext;

    // =====================================================
    // Full Pipeline (هنفعّله تدريجيًا)
    // =====================================================

    // 1. فحص الحظر السريع من Redis
    // const banEntry = await checkBan(ctx.signals.ip, ctx.signals.deviceFingerprint);
    // if (banEntry) {
    //   return reply.status(403).send({ error: 'Access Denied', reason: 'banned' });
    // }

    // 2. فحص الـ Clearance Cookie
    // if (ctx.signals.hasClearance && ctx.signals.clearanceToken) {
    //   const isValid = await verifyClearance(ctx.signals.clearanceToken, ctx.signals);
    //   if (isValid) {
    //     await forwardToOrigin(request, reply, ctx);
    //     return reply;
    //   }
    // }

    // 3. جمع الإشارات + Rate Limit + Reputation
    // ...

    // 4. Risk Engine
    // ctx.riskResult = await calculateRisk(ctx);

    // 5. Suspicion Router
    // ...

    // 6. Policy
    // ctx.decision = await applyPolicy(ctx);

    // 7. تنفيذ القرار
    // switch (ctx.decision.action) { ... }

    // =====================================================
    // حالياً — تمرير مباشر للـ Origin (للاختبار)
    // لما الـ pipeline يتفعّل، الـ forward هيتنفذ بس لو القرار allow
    // =====================================================
    const result = await forwardToOrigin(request, reply, ctx);

    // logSecurityEvent(ctx, result)  // يتفعّل مع event-logger

    request.log.debug(
      {
        requestId: ctx.id,
        statusCode: result.statusCode,
        originHealthy: result.originHealthy,
        responseTimeMs: result.responseTimeMs,
        error: result.error,
      },
      'Forwarded to origin',
    );

    // forwardToOrigin بيبعت الرد بنفسه، فلازم نرجّع reply عشان Fastify ما يبعتش تاني
    return reply;
  });

  // ======================================================
  // 8. Graceful Shutdown
  // ======================================================

  const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  shutdownSignals.forEach((signal) => {
    process.once(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await app.close();
        await closeRedis();
        app.log.info('Gateway shut down complete');
        process.exit(0);
      } catch (err) {
        app.log.error(err);
        process.exit(1);
      }
    });
  });

  return app;
}

// ======================================================
// Helpers
// ======================================================

function extractRealIp(request: FastifyRequest): string {
  const realIp = request.headers[config.security.realIpHeaderName] as string;
  if (realIp) return realIp.split(',')[0].trim();

  const forwarded = request.headers[config.security.forwardedForHeaderName] as string;
  if (forwarded) return forwarded.split(',')[0].trim();

  return request.ip || '0.0.0.0';
}

/** بيحوّل الـ body (Buffer / string / object) لـ JSON object بأمان */
function parseJsonBody<T>(body: unknown): T | null {
  try {
    if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8')) as T;
    if (typeof body === 'string') return JSON.parse(body) as T;
    if (body && typeof body === 'object') return body as T;
    return null;
  } catch {
    return null;
  }
}

export default buildApp;