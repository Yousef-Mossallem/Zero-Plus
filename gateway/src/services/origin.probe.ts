// ======================================================
// ZERO PLUS GATEWAY — Origin Probe (Step-Test / High Accuracy)
// قياس قدرة السيرفر بدقة عالية لأغراض التسعير
// ======================================================
//
// يعتمد على:
// - axios       → Health + Latency + Redirect detection
// - autocannon  → Step Load Test احترافي
//
// المراحل:
// 1. Health Check (+ اكتشاف Redirect)
// 2. Warm-up
// 3. Latency Test (عينات كثيرة + cache busting)
// 4. Step Load Test (رفع الحمل على مراحل حتى الـ knee)
// 5. تكرار القياس (median) لحساب الثقة
// 6. إرسال النتيجة الكاملة للـ Backend
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
  /** مسارات إضافية للقياس (بخلاف الجذر) */
  paths?: string[];
}

export interface HealthCheckResult {
  alive: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
  /** لو السيرفر بيرجع 301/302 */
  redirected: boolean;
  finalUrl: string | null;
  redirectWarning: string | null;
}

export interface LatencyTestResult {
  samples: number;
  avgResponseTimeMs: number;
  minResponseTimeMs: number;
  maxResponseTimeMs: number;
  p50ResponseTimeMs: number;
  p90ResponseTimeMs: number;
  p95ResponseTimeMs: number;
  p99ResponseTimeMs: number;
  successCount: number;
  failCount: number;
}

export interface StepHistoryItem {
  connections: number;
  rps: number;
  p50: number;
  p90: number;
  p99: number;
  maxLatency: number;
  errRate: number;
  totalRequests: number;
  failedRequests: number;
  durationMs: number;
  healthy: boolean;
}

export interface LoadTestResult {
  durationMs: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  avgRps: number;
  maxRps: number;
  /** آخر مرحلة سليمة (قبل الانهيار) */
  sustainedRps: number;
  /** عدد الاتصالات عند أفضل مرحلة */
  bestConnections: number;
  latency: {
    avg: number;
    p50: number;
    p90: number;
    p99: number;
    max: number;
  };
  throughputKbps: number;
  /** سجل كل مراحل الـ Step Test */
  stepHistory: StepHistoryItem[];
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

  /** نتائج التكرارات (لو اتعمل أكتر من مرة) */
  runs?: Array<{
    sustainedRps: number;
    safeRps: number;
    p99: number;
    errorRate: number;
  }>;

  summary: {
    isHealthy: boolean;
    avgLatencyMs: number | null;
    estimatedMaxRps: number | null;
    safeRps: number | null;
    recommendation: 'excellent' | 'good' | 'fair' | 'poor' | 'down';
    confidence: 'high' | 'medium' | 'low';
    /** معامل التباين بين التكرارات (أقل = أدق) */
    variancePercent: number | null;
    notes: string[];
  };
}

// ======================================================
// إعدادات الدقة
// ======================================================

const PROBE_CONFIG = {
  latencySamples: 25,
  warmupSeconds: 3,
  /** مدة كل مرحلة في الـ Step Test (ثواني) */
  stepDurationSeconds: 8,
  /** مستويات التزامن — ترتفع لحد ما الأداء ينهار */
  steps: [5, 10, 20, 40, 80, 160, 320] as number[],
  pipelining: 1,
  requestTimeoutSec: 5,
  /** عدد تكرارات القياس الكاملة (median) */
  repeatRuns: 3,
  /** حد الخطأ المقبول % */
  maxErrorRate: 1,
  /** مضاعف p99 المسموح مقابل الأساس */
  maxP99Multiplier: 5,
  /** حد p99 مطلق (ms) */
  maxP99HardMs: 500,
  /** معامل الأمان للتسعير */
  safeFactor: 0.8,
};

// ======================================================
// 1. Health Check (+ Redirect)
// ======================================================

export async function healthCheck(
  targetUrl: string,
  timeoutMs: number = config.originProbe.healthTimeoutMs
): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    // أول طلب: من غير follow redirects عشان نكتشف 301/302
    const headLike = await axios.get(targetUrl, {
      timeout: timeoutMs,
      validateStatus: () => true,
      maxRedirects: 0,
      headers: {
        'User-Agent': 'ZeroPlus-OriginProbe/3.0',
        'X-ZeroPlus-Probe': 'health',
      },
    });

    const status = headLike.status;
    const redirected = status >= 300 && status < 400;
    const location = (headLike.headers['location'] as string) || null;

    if (redirected) {
      return {
        alive: true,
        statusCode: status,
        responseTimeMs: Date.now() - start,
        error: null,
        redirected: true,
        finalUrl: location,
        redirectWarning:
          `الأوريجن بيرجع ${status} إلى ${location || 'unknown'}. ` +
          `القياس قد يقيس الـ redirect مش التطبيق. يُفضّل استخدام الـ URL النهائي.`,
      };
    }

    // طلب عادي مع follow
    const response = await axios.get(targetUrl, {
      timeout: timeoutMs,
      validateStatus: () => true,
      maxRedirects: 3,
      headers: {
        'User-Agent': 'ZeroPlus-OriginProbe/3.0',
        'X-ZeroPlus-Probe': 'health',
      },
    });

    return {
      alive: response.status >= 100 && response.status < 500,
      statusCode: response.status,
      responseTimeMs: Date.now() - start,
      error: null,
      redirected: false,
      finalUrl: response.request?.res?.responseUrl || targetUrl,
      redirectWarning: null,
    };
  } catch (err) {
    const error = err as AxiosError;
    // axios بيرمي على maxRedirects: 0 لما يحصل redirect — نتعامل معه
    if (error.response && error.response.status >= 300 && error.response.status < 400) {
      return {
        alive: true,
        statusCode: error.response.status,
        responseTimeMs: Date.now() - start,
        error: null,
        redirected: true,
        finalUrl: (error.response.headers['location'] as string) || null,
        redirectWarning:
          `الأوريجن بيرجع ${error.response.status}. يُفضّل القياس على الـ URL النهائي.`,
      };
    }

    return {
      alive: false,
      statusCode: error.response?.status ?? null,
      responseTimeMs: Date.now() - start,
      error: error.code || error.message || 'Unknown error',
      redirected: false,
      finalUrl: null,
      redirectWarning: null,
    };
  }
}

// ======================================================
// Cache busting
// ======================================================

function withCacheBust(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_zp=${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ======================================================
// 2. Latency Test
// ======================================================

export async function latencyTest(
  targetUrl: string,
  samples: number = PROBE_CONFIG.latencySamples,
  timeoutMs: number = config.originProbe.healthTimeoutMs
): Promise<LatencyTestResult> {
  const times: number[] = [];
  let successCount = 0;
  let failCount = 0;

  // Warm-up
  for (let i = 0; i < 3; i++) {
    try {
      await axios.get(withCacheBust(targetUrl), {
        timeout: timeoutMs,
        validateStatus: () => true,
        headers: { 'X-ZeroPlus-Probe': 'warmup' },
        maxRedirects: 2,
      });
    } catch {
      // ignore
    }
    await sleep(40);
  }

  for (let i = 0; i < samples; i++) {
    const start = process.hrtime.bigint();
    try {
      await axios.get(withCacheBust(targetUrl), {
        timeout: timeoutMs,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'ZeroPlus-OriginProbe/3.0',
          'X-ZeroPlus-Probe': 'latency',
        },
        maxRedirects: 2,
      });
      const end = process.hrtime.bigint();
      times.push(Number(end - start) / 1_000_000);
      successCount++;
    } catch {
      failCount++;
    }
    if (i < samples - 1) await sleep(35);
  }

  if (times.length === 0) {
    return {
      samples,
      avgResponseTimeMs: 0,
      minResponseTimeMs: 0,
      maxResponseTimeMs: 0,
      p50ResponseTimeMs: 0,
      p90ResponseTimeMs: 0,
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
    p90ResponseTimeMs: Math.round(percentile(times, 90)),
    p95ResponseTimeMs: Math.round(percentile(times, 95)),
    p99ResponseTimeMs: Math.round(percentile(times, 99)),
    successCount,
    failCount,
  };
}

// ======================================================
// فشل الطلبات (errors + timeouts + 5xx + 429)
// ======================================================

function failedCount(result: any): number {
  const errors = result.errors || 0;
  const timeouts = result.timeouts || 0;

  let badStatus = 0;
  const codes = result.statusCodeStats ?? result.statusCodes ?? {};

  if (codes && typeof codes === 'object') {
    for (const [code, v] of Object.entries(codes)) {
      const c = Number(code);
      const count =
        typeof v === 'number' ? v : (v as any)?.count ?? 0;
      if (c >= 500 || c === 429) badStatus += count;
    }
  } else if (typeof result.non2xx === 'number') {
    // fallback أضعف — non2xx بيشمل 3xx/4xx كمان
    badStatus = result.non2xx;
  }

  return errors + timeouts + badStatus;
}

function extractLatency(result: any) {
  const lat = result.latency || {};
  // autocannon: p50, p90, p97_5, p99 — مفيش p95 مضمون
  const p90 = Math.round(lat.p90 ?? lat.p95 ?? 0);
  const p99 = Math.round(lat.p99 ?? 0);
  // تقدير p95 من p90/p99 لو مش موجود
  const p95 =
    lat.p95 != null
      ? Math.round(lat.p95)
      : p90 && p99
        ? Math.round(p90 + (p99 - p90) * 0.5)
        : p90;

  return {
    avg: Math.round(lat.mean ?? lat.average ?? 0),
    p50: Math.round(lat.p50 ?? 0),
    p90,
    p95,
    p99,
    max: Math.round(lat.max ?? 0),
  };
}

// ======================================================
// 3. Step Load Test
// ======================================================

export async function stepLoadTest(targetUrl: string): Promise<LoadTestResult> {
  const errors: string[] = [];
  const history: StepHistoryItem[] = [];

  // Warm-up
  await runAutocannon(withCacheBust(targetUrl), {
    duration: PROBE_CONFIG.warmupSeconds,
    connections: 5,
    title: 'warmup',
  });

  let baseP99: number | null = null;
  let best: { connections: number; rps: number; latency: ReturnType<typeof extractLatency> } | null =
    null;

  let totalRequests = 0;
  let totalFailed = 0;
  let maxRpsSeen = 0;
  let sumThroughput = 0;
  let stepsRun = 0;

  for (const connections of PROBE_CONFIG.steps) {
    const url = withCacheBust(targetUrl);
    const r = await runAutocannon(url, {
      duration: PROBE_CONFIG.stepDurationSeconds,
      connections,
      pipelining: PROBE_CONFIG.pipelining,
      title: `step-${connections}`,
    });

    const reqTotal = r.requests?.total ?? 0;
    const bad = failedCount(r);
    const errRate = reqTotal > 0 ? (bad / reqTotal) * 100 : 100;
    const rps = Math.round(r.requests?.average ?? 0);
    const lat = extractLatency(r);

    if (baseP99 === null) baseP99 = lat.p99 || lat.p90 || 50;

    const healthy =
      errRate < PROBE_CONFIG.maxErrorRate &&
      lat.p99 < Math.max(PROBE_CONFIG.maxP99HardMs, (baseP99 || 50) * PROBE_CONFIG.maxP99Multiplier);

    history.push({
      connections,
      rps,
      p50: lat.p50,
      p90: lat.p90,
      p99: lat.p99,
      maxLatency: lat.max,
      errRate: Math.round(errRate * 100) / 100,
      totalRequests: reqTotal,
      failedRequests: bad,
      durationMs: Math.round((r.duration || PROBE_CONFIG.stepDurationSeconds) * 1000),
      healthy,
    });

    totalRequests += reqTotal;
    totalFailed += bad;
    maxRpsSeen = Math.max(maxRpsSeen, Math.round(r.requests?.max ?? rps));
    sumThroughput += r.throughput?.average ?? 0;
    stepsRun++;

    if (r.errors) errors.push(`step-${connections} errors: ${r.errors}`);
    if (r.timeouts) errors.push(`step-${connections} timeouts: ${r.timeouts}`);

    if (healthy) {
      best = { connections, rps, latency: lat };
    } else {
      // وصلنا للـ knee — نوقف
      break;
    }
  }

  const sustainedRps = best?.rps ?? 0;
  const overallErrRate =
    totalRequests > 0
      ? Math.round((totalFailed / totalRequests) * 10000) / 100
      : 100;

  return {
    durationMs: stepsRun * PROBE_CONFIG.stepDurationSeconds * 1000,
    totalRequests,
    successfulRequests: Math.max(0, totalRequests - totalFailed),
    failedRequests: totalFailed,
    errorRate: overallErrRate,
    avgRps: sustainedRps,
    maxRps: maxRpsSeen,
    sustainedRps,
    bestConnections: best?.connections ?? 0,
    latency: best?.latency ?? { avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 },
    throughputKbps: stepsRun > 0 ? Math.round(sumThroughput / stepsRun / 1024) : 0,
    stepHistory: history,
    errors,
  };
}

// ======================================================
// 4. الـ Probe الكامل (مع تكرار + median)
// ======================================================

export async function probeOrigin(target: OriginTarget): Promise<OriginProbeResult> {
  const timeoutMs = target.timeoutMs ?? config.originProbe.healthTimeoutMs;
  let url = target.url.replace(/\/$/, '');

  console.log(`[OriginProbe] بدء فحص Step-Test: ${url} (org: ${target.orgId})`);

  // 1. Health
  const health = await healthCheck(url, timeoutMs);

  // لو فيه redirect و finalUrl واضح — نحول القياس عليه
  if (health.redirected && health.finalUrl) {
    try {
      const final = new URL(health.finalUrl, url).toString().replace(/\/$/, '');
      console.warn(`[OriginProbe] Redirect detected → القياس على: ${final}`);
      url = final;
    } catch {
      // نكمل على الأصلي
    }
  }

  let latency: LatencyTestResult | null = null;
  let load: LoadTestResult | null = null;
  const runs: NonNullable<OriginProbeResult['runs']> = [];
  const notes: string[] = [];

  if (health.redirectWarning) notes.push(health.redirectWarning);
  notes.push(
    'تأكد أن IP الـ Gateway في whitelist عند أي WAF/Firewall على الأوريجن حتى لا يقيس الـ probe الحماية بدل السيرفر.'
  );

  if (health.alive) {
    console.log('[OriginProbe] جاري قياس الـ Latency...');
    latency = await latencyTest(url, PROBE_CONFIG.latencySamples, timeoutMs);

    const runCount = Math.max(1, PROBE_CONFIG.repeatRuns);
    const loadResults: LoadTestResult[] = [];

    for (let i = 0; i < runCount; i++) {
      console.log(`[OriginProbe] Step Load Test — الجولة ${i + 1}/${runCount}...`);
      const one = await stepLoadTest(url);
      loadResults.push(one);
      runs.push({
        sustainedRps: one.sustainedRps,
        safeRps: Math.floor(one.sustainedRps * PROBE_CONFIG.safeFactor),
        p99: one.latency.p99,
        errorRate: one.errorRate,
      });
    }

    // median حسب sustainedRps
    loadResults.sort((a, b) => a.sustainedRps - b.sustainedRps);
    load = loadResults[Math.floor(loadResults.length / 2)];
  }

  const summary = buildSummary(health, latency, load, runs, notes);

  const result: OriginProbeResult = {
    orgId: target.orgId,
    serverId: target.serverId,
    originUrl: url,
    probedAt: new Date().toISOString(),
    health,
    latency,
    load,
    runs: runs.length > 0 ? runs : undefined,
    summary,
  };

  // إرسال النتيجة الكاملة للـ Backend (من غير اختصار)
  try {
    await sendOriginProbeResult(result as any);
  } catch (err) {
    console.error('[OriginProbe] فشل إرسال النتيجة للـ Backend:', (err as Error).message);
  }

  console.log(
    `[OriginProbe] انتهى → healthy=${summary.isHealthy} | ` +
      `sustainedRps=${summary.estimatedMaxRps} | safeRps=${summary.safeRps} | ` +
      `confidence=${summary.confidence} | variance=${summary.variancePercent}%`
  );

  return result;
}

// ======================================================
// Helpers
// ======================================================

function buildSummary(
  health: HealthCheckResult,
  latency: LatencyTestResult | null,
  load: LoadTestResult | null,
  runs: NonNullable<OriginProbeResult['runs']>,
  notes: string[]
): OriginProbeResult['summary'] {
  if (!health.alive) {
    return {
      isHealthy: false,
      avgLatencyMs: null,
      estimatedMaxRps: null,
      safeRps: null,
      recommendation: 'down',
      confidence: 'high',
      variancePercent: null,
      notes,
    };
  }

  const avgLatencyMs =
    latency?.p95ResponseTimeMs ?? latency?.p90ResponseTimeMs ?? latency?.avgResponseTimeMs ?? null;

  const estimatedMaxRps = load?.sustainedRps ?? null;
  const safeRps =
    estimatedMaxRps !== null
      ? Math.floor(estimatedMaxRps * PROBE_CONFIG.safeFactor)
      : null;

  // تباين التكرارات
  let variancePercent: number | null = null;
  let confidence: OriginProbeResult['summary']['confidence'] = 'low';

  if (runs.length >= 2) {
    const values = runs.map((r) => r.sustainedRps);
    const avg = average(values);
    if (avg > 0) {
      const variance =
        values.reduce((s, v) => s + Math.abs(v - avg), 0) / values.length;
      variancePercent = Math.round((variance / avg) * 10000) / 100;
    }
  }

  if (
    load &&
    load.errorRate < 1 &&
    load.totalRequests > 200 &&
    (variancePercent === null || variancePercent < 15)
  ) {
    confidence = 'high';
  } else if (load && load.totalRequests > 80) {
    confidence = 'medium';
  }

  let recommendation: OriginProbeResult['summary']['recommendation'] = 'fair';

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

  if (load?.stepHistory?.length) {
    notes.push(
      `Step history: ${load.stepHistory
        .map((s) => `${s.connections}c→${s.rps}rps(p99=${s.p99}ms,err=${s.errRate}%)`)
        .join(' | ')}`
    );
  }

  return {
    isHealthy: true,
    avgLatencyMs,
    estimatedMaxRps,
    safeRps,
    recommendation,
    confidence,
    variancePercent,
    notes,
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
    autocannon(
      {
        url,
        duration: opts.duration,
        connections: opts.connections,
        pipelining: opts.pipelining ?? 1,
        timeout: PROBE_CONFIG.requestTimeoutSec,
        headers: {
          'User-Agent': 'ZeroPlus-OriginProbe/3.0',
          'X-ZeroPlus-Probe': opts.title,
        },
        excludeErrorStats: false,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
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