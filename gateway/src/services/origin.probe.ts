// ======================================================
// ZERO PLUS GATEWAY — Origin Probe (High Accuracy)
// قياس قدرة السيرفر بدقة عالية لأغراض التسعير
// ======================================================
//
// يعتمد على:
// - axios          → Health + Latency
// - autocannon     → Load Test احترافي (نفس أداة فريق Fastify)
//
// المراحل:
// 1. Health Check
// 2. Warm-up
// 3. Latency Test (عينات كثيرة + percentiles)
// 4. Load Test (مدة ثابتة + concurrency ثابت)
// 5. إرسال النتيجة للـ Backend
//
// ======================================================

import axios, { AxiosError } from 'axios';
import autocannon from 'autocannon';
import { config } from '../config';
import { sendOriginProbeResult } from './backend.client';

// ======================================================
// الأنواع
// ======================================================

export interface OriginTarget {
  url: string;
  orgId: string;
  serverId?: string;
  timeoutMs?: number;
}

export interface HealthCheckResult {
  alive: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
}

export interface LatencyTestResult {
  samples: number;
  avgResponseTimeMs: number;
  minResponseTimeMs: number;
  maxResponseTimeMs: number;
  p50ResponseTimeMs: number;
  p95ResponseTimeMs: number;
  p99ResponseTimeMs: number;
  successCount: number;
  failCount: number;
}

export interface LoadTestResult {
  /** مدة الاختبار الفعلية بالمللي ثانية */
  durationMs: number;
  /** إجمالي الطلبات اللي اتبعت */
  totalRequests: number;
  /** الطلبات الناجحة (2xx-4xx) */
  successfulRequests: number;
  /** الطلبات الفاشلة (timeout / 5xx / network) */
  failedRequests: number;
  /** نسبة الأخطاء % */
  errorRate: number;
  /** متوسط الـ RPS خلال مدة الاختبار */
  avgRps: number;
  /** أعلى RPS لوحظ في ثانية واحدة */
  maxRps: number;
  /** الـ RPS المستدام (بعد استبعاد الـ warm-up والتقلبات) */
  sustainedRps: number;
  /** Latency تحت الحمل */
  latency: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  /** throughput بالكيلوبايت/ثانية */
  throughputKbps: number;
  errors: string[];
}

export interface OriginProbeResult {
  orgId: string;
  serverId?: string;
  originUrl: string;
  probedAt: string;

  health: HealthCheckResult;
  latency: LatencyTestResult | null;
  load: LoadTestResult | null;

  summary: {
    isHealthy: boolean;
    avgLatencyMs: number | null;
    /** الرقم الأساسي اللي هيتسعّر عليه */
    estimatedMaxRps: number | null;
    /** رقم محافظ أكتر (للتسعير الآمن) */
    safeRps: number | null;
    recommendation: 'excellent' | 'good' | 'fair' | 'poor' | 'down';
    confidence: 'high' | 'medium' | 'low';
  };
}

// ======================================================
// إعدادات الدقة (تقدر تعدلها من هنا)
// ======================================================

const PROBE_CONFIG = {
  /** عدد عينات الـ Latency */
  latencySamples: 25,

  /** مدة الـ Warm-up بالثواني */
  warmupSeconds: 3,

  /** مدة الـ Load Test الأساسية بالثواني */
  loadTestSeconds: 12,

  /** عدد الاتصالات المتزامنة */
  connections: 20,

  /** عدد الـ pipelines (طلبات متتالية على نفس الاتصال) */
  pipelining: 1,

  /** timeout لكل طلب (ثانية) */
  requestTimeoutSec: 5,
};

// ======================================================
// 1. Health Check
// ======================================================

export async function healthCheck(
  targetUrl: string,
  timeoutMs: number = config.originProbe.healthTimeoutMs
): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const response = await axios.get(targetUrl, {
      timeout: timeoutMs,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'ZeroPlus-OriginProbe/2.0',
        'X-ZeroPlus-Probe': 'health',
      },
      maxRedirects: 2,
    });

    return {
      alive: response.status >= 100 && response.status < 500,
      statusCode: response.status,
      responseTimeMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    const error = err as AxiosError;
    return {
      alive: false,
      statusCode: error.response?.status ?? null,
      responseTimeMs: Date.now() - start,
      error: error.code || error.message || 'Unknown error',
    };
  }
}

// ======================================================
// 2. Latency Test (دقيق)
// ======================================================

export async function latencyTest(
  targetUrl: string,
  samples: number = PROBE_CONFIG.latencySamples,
  timeoutMs: number = config.originProbe.healthTimeoutMs
): Promise<LatencyTestResult> {
  const times: number[] = [];
  let successCount = 0;
  let failCount = 0;

  // Warm-up خفيف قبل القياس
  for (let i = 0; i < 3; i++) {
    try {
      await axios.get(targetUrl, {
        timeout: timeoutMs,
        validateStatus: () => true,
        headers: { 'X-ZeroPlus-Probe': 'warmup' },
        maxRedirects: 1,
      });
    } catch {
      // نتجاهل
    }
    await sleep(50);
  }

  for (let i = 0; i < samples; i++) {
    const start = process.hrtime.bigint();
    try {
      await axios.get(targetUrl, {
        timeout: timeoutMs,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'ZeroPlus-OriginProbe/2.0',
          'X-ZeroPlus-Probe': 'latency',
        },
        maxRedirects: 1,
      });
      const end = process.hrtime.bigint();
      const ms = Number(end - start) / 1_000_000;
      times.push(ms);
      successCount++;
    } catch {
      failCount++;
    }

    // تباعد بسيط عشان ما نبقاش بنقيس cache فقط
    if (i < samples - 1) await sleep(40);
  }

  if (times.length === 0) {
    return {
      samples,
      avgResponseTimeMs: 0,
      minResponseTimeMs: 0,
      maxResponseTimeMs: 0,
      p50ResponseTimeMs: 0,
      p95ResponseTimeMs: 0,
      p99ResponseTimeMs: 0,
      successCount: 0,
      failCount,
    };
  }

  times.sort((a, b) => a - b);

  return {
    samples,
    avgResponseTimeMs: Math.round(average(times)),
    minResponseTimeMs: Math.round(times[0]),
    maxResponseTimeMs: Math.round(times[times.length - 1]),
    p50ResponseTimeMs: Math.round(percentile(times, 50)),
    p95ResponseTimeMs: Math.round(percentile(times, 95)),
    p99ResponseTimeMs: Math.round(percentile(times, 99)),
    successCount,
    failCount,
  };
}

// ======================================================
// 3. Load Test احترافي (autocannon)
// ======================================================

export async function loadTest(targetUrl: string): Promise<LoadTestResult> {
  const errors: string[] = [];

  // ----- Warm-up -----
  await runAutocannon(targetUrl, {
    duration: PROBE_CONFIG.warmupSeconds,
    connections: Math.min(10, PROBE_CONFIG.connections),
    title: 'warmup',
  });

  // ----- القياس الحقيقي -----
  const result = await runAutocannon(targetUrl, {
    duration: PROBE_CONFIG.loadTestSeconds,
    connections: PROBE_CONFIG.connections,
    pipelining: PROBE_CONFIG.pipelining,
    title: 'load',
  });

  const totalRequests = result.requests.total;
  const successfulRequests = totalRequests - (result.errors || 0) - (result.timeouts || 0);
  const failedRequests = (result.errors || 0) + (result.timeouts || 0);
  const errorRate =
    totalRequests > 0 ? Math.round((failedRequests / totalRequests) * 10000) / 100 : 0;

  const avgRps = Math.round(result.requests.average || 0);
  const maxRps = Math.round(result.requests.max || 0);

  // الـ sustained RPS = متوسط مع خصم بسيط لو فيه أخطاء
  let sustainedRps = avgRps;
  if (errorRate > 1) {
    sustainedRps = Math.round(avgRps * (1 - errorRate / 100));
  }

  if (result.errors) errors.push(`errors: ${result.errors}`);
  if (result.timeouts) errors.push(`timeouts: ${result.timeouts}`);

  return {
    durationMs: (result.duration || PROBE_CONFIG.loadTestSeconds) * 1000,
    totalRequests,
    successfulRequests,
    failedRequests,
    errorRate,
    avgRps,
    maxRps,
    sustainedRps,
    latency: {
      avg: Math.round(result.latency?.mean || 0),
      p50: Math.round(result.latency?.p50 || 0),
      p95: Math.round(result.latency?.p95 || 0),
      p99: Math.round(result.latency?.p99 || 0),
      max: Math.round(result.latency?.max || 0),
    },
    throughputKbps: Math.round((result.throughput?.average || 0) / 1024),
    errors,
  };
}

// ======================================================
// 4. الـ Probe الكامل
// ======================================================

export async function probeOrigin(target: OriginTarget): Promise<OriginProbeResult> {
  const timeoutMs = target.timeoutMs ?? config.originProbe.healthTimeoutMs;
  const url = target.url.replace(/\/$/, '');

  console.log(`[OriginProbe] بدء فحص عالي الدقة: ${url} (org: ${target.orgId})`);

  // 1. Health
  const health = await healthCheck(url, timeoutMs);

  let latency: LatencyTestResult | null = null;
  let load: LoadTestResult | null = null;

  if (health.alive) {
    // 2. Latency
    console.log('[OriginProbe] جاري قياس الـ Latency...');
    latency = await latencyTest(url, PROBE_CONFIG.latencySamples, timeoutMs);

    // 3. Load Test
    console.log('[OriginProbe] جاري الـ Load Test (قد يستغرق ~15 ثانية)...');
    load = await loadTest(url);
  }

  const summary = buildSummary(health, latency, load);

  const result: OriginProbeResult = {
    orgId: target.orgId,
    serverId: target.serverId,
    originUrl: url,
    probedAt: new Date().toISOString(),
    health,
    latency,
    load,
    summary,
  };

  // إرسال للـ Backend
  try {
    await sendOriginProbeResult({
      ...result,
      load: load
        ? {
            estimatedRps: load.sustainedRps,
            avgResponseTimeMs: load.latency.avg,
            successfulRequests: load.successfulRequests,
            failedRequests: load.failedRequests,
          }
        : null,
    });
  } catch (err) {
    console.error('[OriginProbe] فشل إرسال النتيجة للـ Backend:', (err as Error).message);
  }

  console.log(
    `[OriginProbe] انتهى → healthy=${summary.isHealthy} | ` +
      `latency=${summary.avgLatencyMs}ms | ` +
      `sustainedRps=${summary.estimatedMaxRps} | ` +
      `safeRps=${summary.safeRps} | ` +
      `recommendation=${summary.recommendation} | ` +
      `confidence=${summary.confidence}`
  );

  return result;
}

// ======================================================
// Helpers
// ======================================================

function buildSummary(
  health: HealthCheckResult,
  latency: LatencyTestResult | null,
  load: LoadTestResult | null
): OriginProbeResult['summary'] {
  if (!health.alive) {
    return {
      isHealthy: false,
      avgLatencyMs: null,
      estimatedMaxRps: null,
      safeRps: null,
      recommendation: 'down',
      confidence: 'high',
    };
  }

  const avgLatencyMs = latency?.p95ResponseTimeMs ?? latency?.avgResponseTimeMs ?? null;
  const estimatedMaxRps = load?.sustainedRps ?? null;

  // رقم محافظ للتسعير (85% من الـ sustained)
  const safeRps =
    estimatedMaxRps !== null ? Math.floor(estimatedMaxRps * 0.85) : null;

  let recommendation: OriginProbeResult['summary']['recommendation'] = 'fair';
  let confidence: OriginProbeResult['summary']['confidence'] = 'medium';

  if (load && load.errorRate < 1 && load.totalRequests > 100) {
    confidence = 'high';
  } else if (load && load.totalRequests > 50) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  if (avgLatencyMs !== null && estimatedMaxRps !== null) {
    if (avgLatencyMs < 100 && estimatedMaxRps >= 150 && (load?.errorRate ?? 0) < 1) {
      recommendation = 'excellent';
    } else if (avgLatencyMs < 200 && estimatedMaxRps >= 60) {
      recommendation = 'good';
    } else if (avgLatencyMs < 400 && estimatedMaxRps >= 20) {
      recommendation = 'fair';
    } else {
      recommendation = 'poor';
    }
  }

  return {
    isHealthy: true,
    avgLatencyMs,
    estimatedMaxRps,
    safeRps,
    recommendation,
    confidence,
  };
}

function runAutocannon(
  url: string,
  opts: {
    duration: number;
    connections: number;
    pipelining?: number;
    title: string;
  }
): Promise<any> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        duration: opts.duration,
        connections: opts.connections,
        pipelining: opts.pipelining ?? 1,
        timeout: PROBE_CONFIG.requestTimeoutSec,
        headers: {
          'User-Agent': 'ZeroPlus-OriginProbe/2.0',
          'X-ZeroPlus-Probe': opts.title,
        },
        excludeErrorStats: false,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );

    // لو حابب تشوف progress في الـ console
    // autocannon.track(instance, { outputStream: process.stdout });
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ======================================================
// تصدير
// ======================================================

export async function probeOriginByUrl(
  url: string,
  orgId: string,
  serverId?: string
): Promise<OriginProbeResult> {
  return probeOrigin({ url, orgId, serverId });
}