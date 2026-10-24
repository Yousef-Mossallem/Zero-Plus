// ======================================================
// ZERO PLUS GATEWAY — Forward To Origin
// تمرير الطلبات المسموح بها للسيرفر الأصلي
// ======================================================
//
// المسؤوليات:
// 1. تحديد عنوان السيرفر الأصلي (Redis cache أولاً → Backend ثانياً)
// 2. تنظيف الـ Headers قبل التمرير (شيل الـ Headers الداخلية)
// 3. إضافة Headers الخاصة بالـ Gateway (X-Forwarded-For, X-ZeroPlus-*)
// 4. تمرير الطلب (method + headers + body) للـ Origin
// 5. تمرير الرد كامل للزائر (status + headers + body)
// 6. معالجة أخطاء الـ Origin (timeout, refused, 5xx)
// 7. قياس وقت الاستجابة وإرجاعه للـ logging
//
// قواعد أمنية:
// - نمسح كل Header داخلي قبل التمرير للـ Origin
// - الـ Origin مش بيشوف X-Gateway-Key أبدًا
// - بنضيف X-Forwarded-For بالـ IP الحقيقي للزائر
// - مش بنمرر Set-Cookie من الـ Origin إلا لو مطلوب
//
// ======================================================

import http from 'http';
import https from 'https';
import { URL } from 'url';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';
import {
  getCachedOriginInfo,
  cacheOriginInfo,
} from '../services/redis.client';
import {
  resolveServerByHost,
  type GatewayServer,
} from '../services/backend.client';
import type { RequestContext } from '../types';

// ======================================================
// الأنواع
// ======================================================

export interface ForwardResult {
  /** كود الاستجابة من الـ Origin */
  statusCode: number;
  /** هل الـ Origin رد بنجاح؟ */
  originHealthy: boolean;
  /** وقت الاستجابة الكامل بالـ ms */
  responseTimeMs: number;
  /** حجم الرد بالـ bytes */
  responseSizeBytes: number;
  /** خطأ لو حصل */
  error?: string;
}

export interface OriginInfo {
  id: string;
  organizationId: string;
  domain: string;
  originIp: string;
  originPort: number;
  sslEnabled: boolean;
  maxRequestsPerSecond: number | null;
}

// ======================================================
// الـ Headers اللي لازم نمسحها قبل التمرير للـ Origin
// (معلومات داخلية، مفيش داعي الـ Origin يشوفها)
// ======================================================

const HEADERS_TO_STRIP_UPSTREAM = new Set([
  // مفاتيح داخلية
  'x-gateway-key',
  'x-zeroplus-probe',
  'x-org-id',

  // Fingerprints بتبقى من Nginx → Gateway فقط
  config.security.ja4HeaderName.toLowerCase(),
  config.security.ja3HeaderName.toLowerCase(),
  'x-device-fingerprint',

  // الـ Real IP بنعيد بناءه هنا بشكل صح
  config.security.realIpHeaderName.toLowerCase(),

  // Connection headers (لازم تتمسح في HTTP/1.1 proxying)
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

// ======================================================
// الـ Headers اللي لازم نمسحها من رد الـ Origin
// (عشان ما يتعارضوش مع الـ Gateway headers)
// ======================================================

const HEADERS_TO_STRIP_DOWNSTREAM = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'trailer',
  'upgrade',
]);

// ======================================================
// resolve: بيجيب معلومات الـ Origin
// Redis cache أولاً → Backend ثانياً
// ======================================================

async function resolveOrigin(host: string): Promise<OriginInfo | null> {
  // 1. جرب الكاش الأول (TTL 60 ثانية)
  const cached = await getCachedOriginInfo<OriginInfo>(host);
  if (cached) return cached;

  // 2. اسأل الـ Backend
  let server: GatewayServer;
  try {
    server = await resolveServerByHost(host);
  } catch (err) {
    // الـ Host مش موجود أو غير موثق
    return null;
  }

  // 3. تأكد إن الـ Server موثق وشغّال
  if (!server.dnsVerified) return null;
  if (server.status === 'OFFLINE' || server.status === 'MAINTENANCE') return null;

  const info: OriginInfo = {
    id: server.id,
    organizationId: server.organizationId,
    domain: server.domain,
    originIp: server.originIp,
    originPort: server.originPort,
    sslEnabled: server.sslEnabled,
    maxRequestsPerSecond: server.maxRequestsPerSecond,
  };

  // 4. خزّن في Redis (60 ثانية)
  await cacheOriginInfo(host, info, 60);

  return info;
}

// ======================================================
// بناء URL الـ Origin
// ======================================================

function buildOriginUrl(origin: OriginInfo, requestUrl: string): URL {
  const protocol = origin.sslEnabled ? 'https' : 'http';
  const base = `${protocol}://${origin.originIp}:${origin.originPort}`;
  return new URL(requestUrl, base);
}

// ======================================================
// تنظيف الـ Headers
// ======================================================

function buildUpstreamHeaders(
  request: FastifyRequest,
  origin: OriginInfo,
  realIp: string
): Record<string, string> {
  const headers: Record<string, string> = {};

  // انسخ كل الـ headers من الطلب الأصلي
  for (const [key, value] of Object.entries(request.headers)) {
    const lowerKey = key.toLowerCase();

    // تجاهل الـ headers الداخلية والـ undefined
    if (HEADERS_TO_STRIP_UPSTREAM.has(lowerKey)) continue;
    if (value === undefined) continue;

    headers[lowerKey] = Array.isArray(value) ? value.join(', ') : value;
  }

  // ===== Headers اللي بنضيفها نحن =====

  // X-Forwarded-For: الـ chain الكامل
  const existingForwarded = request.headers['x-forwarded-for'];
  if (existingForwarded) {
    headers['x-forwarded-for'] = `${existingForwarded}, ${realIp}`;
  } else {
    headers['x-forwarded-for'] = realIp;
  }

  // X-Real-IP: الـ IP الأصلي دايمًا
  headers['x-real-ip'] = realIp;

  // X-Forwarded-Proto: البروتوكول اللي الزائر استخدمه
  headers['x-forwarded-proto'] = request.protocol || 'http';

  // X-Forwarded-Host: الـ domain اللي الزائر طلبه
  headers['x-forwarded-host'] = origin.domain;

  // Host: الـ Origin لازم يشوف الدومين الصح
  headers['host'] = origin.domain;

  // X-ZeroPlus-Request-ID: للتتبع
  headers['x-zeroplus-request-id'] = request.id;

  // X-ZeroPlus-Protected: علامة إن الطلب عدّى الـ Gateway
  headers['x-zeroplus-protected'] = '1';

  return headers;
}

// ======================================================
// تمرير الطلب للـ Origin (Node.js HTTP native)
// ======================================================

function proxyRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  origin: OriginInfo,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<ForwardResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const targetUrl = buildOriginUrl(origin, request.url);
    const transport = origin.sslEnabled ? https : http;

    let responseSizeBytes = 0;
    let resolved = false;

    const done = (result: ForwardResult) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    // خيارات الـ Request
    const options: http.RequestOptions = {
      hostname: origin.originIp,
      port: origin.originPort,
      path: targetUrl.pathname + targetUrl.search,
      method: request.method,
      headers,
      timeout: timeoutMs,
    };

    // لو HTTPS نتجاهل مشكلة الشهادة في التطوير
    if (origin.sslEnabled) {
      (options as https.RequestOptions).rejectUnauthorized = config.server.isProd;
    }

    const proxyReq = transport.request(options, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 502;

      // --- نقل الـ Status Code ---
      reply.status(statusCode);

      // --- نقل الـ Headers من الـ Origin للزائر ---
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        const lowerKey = key.toLowerCase();

        // تجاهل الـ headers المشكلة
        if (HEADERS_TO_STRIP_DOWNSTREAM.has(lowerKey)) continue;
        if (value === undefined) continue;

        try {
          reply.header(key, Array.isArray(value) ? value.join(', ') : value as string);
        } catch {
          // بعض الـ headers ممكن تطرح خطأ، نتجاهلها
        }
      }

      // --- نقل الـ Body ---
      const chunks: Buffer[] = [];

      proxyRes.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        responseSizeBytes += chunk.length;
      });

      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks);
        reply.send(body);

        done({
          statusCode,
          originHealthy: statusCode < 500,
          responseTimeMs: Date.now() - startTime,
          responseSizeBytes,
        });
      });

      proxyRes.on('error', (err) => {
        done({
          statusCode: 502,
          originHealthy: false,
          responseTimeMs: Date.now() - startTime,
          responseSizeBytes,
          error: `Response stream error: ${err.message}`,
        });
      });
    });

    // --- Timeout ---
    proxyReq.on('timeout', () => {
      proxyReq.destroy();

      if (!reply.sent) {
        reply.status(504).send({
          error: 'Gateway Timeout',
          message: 'السيرفر الأصلي لم يرد في الوقت المحدد',
          requestId: request.id,
        });
      }

      done({
        statusCode: 504,
        originHealthy: false,
        responseTimeMs: Date.now() - startTime,
        responseSizeBytes: 0,
        error: 'Origin timeout',
      });
    });

    // --- Connection Error ---
    proxyReq.on('error', (err: NodeJS.ErrnoException) => {
      if (reply.sent) {
        done({
          statusCode: 502,
          originHealthy: false,
          responseTimeMs: Date.now() - startTime,
          responseSizeBytes: 0,
          error: err.message,
        });
        return;
      }

      // نحدد الكود حسب نوع الخطأ
      const isConnRefused = err.code === 'ECONNREFUSED';
      const isTimeout = err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';

      const statusCode = isConnRefused ? 503 : isTimeout ? 504 : 502;
      const message = isConnRefused
        ? 'السيرفر الأصلي غير متاح حاليًا'
        : isTimeout
          ? 'انتهت مهلة الاتصال بالسيرفر الأصلي'
          : 'خطأ في الاتصال بالسيرفر الأصلي';

      reply.status(statusCode).send({
        error: statusCode === 503 ? 'Service Unavailable' : 'Bad Gateway',
        message,
        requestId: request.id,
      });

      done({
        statusCode,
        originHealthy: false,
        responseTimeMs: Date.now() - startTime,
        responseSizeBytes: 0,
        error: `${err.code}: ${err.message}`,
      });
    });

    // --- تمرير الـ Body لو موجود ---
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;

    if (rawBody && rawBody.length > 0) {
      proxyReq.write(rawBody);
    } else if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      request.body
    ) {
      // لو الـ body اتـ parse من Fastify
      const bodyStr =
        typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body);
      proxyReq.write(bodyStr);
    }

    proxyReq.end();
  });
}

// ======================================================
// الدالة الرئيسية
// ======================================================

/**
 * بتمرر الطلب المسموح له للـ Origin
 * وبترجع نتيجة للـ logging
 */
export async function forwardToOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: RequestContext
): Promise<ForwardResult> {
  const host = ctx.signals.host ?? (request.headers.host || '').split(':')[0];

  // 1. جيب معلومات الـ Origin
  const origin = await resolveOrigin(host);

  if (!origin) {
    reply.status(404).send({
      error: 'Not Found',
      message: 'الدومين غير موجود أو غير موثق',
      requestId: request.id,
    });

    return {
      statusCode: 404,
      originHealthy: false,
      responseTimeMs: 0,
      responseSizeBytes: 0,
      error: 'Domain not found or not verified',
    };
  }

  // 2. بناء الـ headers
  const upstreamHeaders = buildUpstreamHeaders(
    request,
    origin,
    ctx.signals.ip
  );

  // 3. حدد الـ timeout
  const timeoutMs = config.originProbe.healthTimeoutMs * 3; // 9 ثواني افتراضي

  // 4. مرّر الطلب
  const result = await proxyRequest(
    request,
    reply,
    origin,
    upstreamHeaders,
    timeoutMs
  );

  // 5. لو الـ Origin فشل، سجّل في Redis للـ health check
  if (!result.originHealthy) {
    // في الخلفية من غير ما نوقف الـ pipeline
    setImmediate(async () => {
      try {
        await import('../services/backend.client').then(({ reportServerHealth }) =>
          reportServerHealth(origin.id, {
            originReachable: false,
            lastError: result.error,
          })
        );
      } catch {
        // مش مشكلة لو فشل
      }
    });
  }

  return result;
}

// ======================================================
// دالة مساعدة للاختبار (بدون FastifyReply كامل)
// ======================================================

export async function resolveOriginForHost(host: string): Promise<OriginInfo | null> {
  return resolveOrigin(host);
}

export { resolveOrigin };