/**
 * detection/intakeClassifier.ts
 * ==================================================================
 * أول طبقة بعد Nginx — تصنيف سريع فقط (من غير قرار أمني).
 *
 * يخرج محورين مستقلين:
 *   1) أولوية العمل (Priority) — إيه يتقدّم لو في ضغط
 *   2) شريحة الإشارة (SignalClass) — مع/من غير JA / Device / Clearance…
 *
 * لا يفعل:
 *   - ALLOW / BLOCK / Challenge
 *   - نداء Redis / AI / Backend
 *   - طابور فعلي (app.ts أو طبقة لاحقة تنفّذ الأولوية)
 *
 * مبدأ السرعة: دوال متزامنة + regex/مسارات معدّة مسبقًا + صفر I/O.
 * ==================================================================
 */

import type { IncomingHttpHeaders } from 'node:http';

// ------------------------------------------------------------------
// 1) أولوية العمل — 4 مستويات
// ------------------------------------------------------------------

/**
 * P0_CRITICAL  — دفع / auth حسّاس / checkout نهائي
 * P1_HIGH      — تسجيل دخول، تعديل حساب، إنشاء طلب
 * P2_MEDIUM    — كتابة API عامة، نماذج، بحث حسّاس
 * P3_NORMAL    — تصفّح، أصول ثابتة، قراءة منتج، health
 */
export type IntakePriority = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_NORMAL';

/** رقم أصغر = أعلى أولوية (سهل للفرز في app) */
export const PRIORITY_RANK: Record<IntakePriority, number> = {
  P0_CRITICAL: 0,
  P1_HIGH: 1,
  P2_MEDIUM: 2,
  P3_NORMAL: 3,
} as const;

export type IntakePriorityReason =
  | 'path_payment'
  | 'path_checkout'
  | 'path_auth_sensitive'
  | 'path_account_write'
  | 'path_order_write'
  | 'path_admin'
  | 'path_api_write'
  | 'path_search'
  | 'path_api_read'
  | 'path_static'
  | 'path_health'
  | 'path_browse'
  | 'method_write_boost'
  | 'default';

// ------------------------------------------------------------------
// 2) شرائح الإشارة (تنظيم — مش حكم)
// ------------------------------------------------------------------

export type TlsSignalBucket =
  | 'tls_ja4_ja3'      // الاثنين من الحافة
  | 'tls_ja4_only'
  | 'tls_ja3_only'
  | 'tls_none';        // غالباً تطوير محلي أو غير عبر Nginx المجهّز

export type DeviceSignalBucket =
  | 'device_fp_present'
  | 'device_fp_absent';

export type ClearanceSignalBucket =
  | 'clearance_present'
  | 'clearance_absent';

export type ClientKindBucket =
  | 'browser_like'     // UA متصفح شائع
  | 'api_client'       // curl / bot sdk / فارغ
  | 'unknown_client';

/** مجموعة تنظيمية واحدة تتجمّع في اللوج/الطابور */
export type IntakeLane =
  | 'lane_secure_browser'    // JA + device (+ غالباً بشري)
  | 'lane_tls_only'          // JA من غير device
  | 'lane_device_only'       // device من غير JA (غريب)
  | 'lane_opaque'            // من غير TLS fp ومن غير device
  | 'lane_simulation';       // هيدر محاكاة (تنظيم فقط)

// ------------------------------------------------------------------
// مدخل / مخرج
// ------------------------------------------------------------------

export interface IntakeClassifyInput {
  method: string;
  path: string;
  host?: string | null;
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  /** إن كانت اتفكّت بدري من fingerprint-authenticator */
  ja4?: string | null;
  ja3?: string | null;
  deviceFingerprint?: string | null;
  hasClearanceCookie?: boolean;
  /** بعد sim-auth — اختياري */
  isSimulation?: boolean;
}

export interface IntakeClassifyResult {
  /** أولوية التنفيذ تحت الضغط */
  priority: IntakePriority;
  priorityRank: number;
  priorityReasons: IntakePriorityReason[];

  /** تنظيم الإشارات */
  tlsBucket: TlsSignalBucket;
  deviceBucket: DeviceSignalBucket;
  clearanceBucket: ClearanceSignalBucket;
  clientKind: ClientKindBucket;
  lane: IntakeLane;

  /** مسار بعد تطبيع */
  normalizedPath: string;
  method: string;

  /** هل يُفضَّل عدم تأخيره في طابور؟ */
  preferImmediate: boolean;
  /** هل يبدو أصل ثابت / health — يمكن تخفيفه في اللوج */
  isLightweight: boolean;

  /** مفتاح تجميع اختياري للطوابير: priority + lane */
  queueKey: string;

  timingMs: number;
}

// ------------------------------------------------------------------
// تطبيع مسار
// ------------------------------------------------------------------

export function normalizePath(raw: string): string {
  let p = (raw || '/').split('?')[0] || '/';
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep */
  }
  p = p.toLowerCase()
  if (!p.startsWith('/')) p = `/${p}`;
  // إزالة تكرار //
  p = p.replace(/\/{2,}/g, '/');
  // إزالة trailing slash إلا الجذر
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

function headerGet(
  headers: IntakeClassifyInput['headers'],
  name: string,
): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== lower) continue;
    if (Array.isArray(v)) {
      const x = v.find((i) => i && String(i).trim());
      return x ? String(x).trim() : null;
    }
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function hasNonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

// ------------------------------------------------------------------
// أنماط الأولوية (من الأدق / الأدفع → الأعم)
// ترتيب الفحص: P0 ثم P1 ثم P2 ثم P3
// ------------------------------------------------------------------

const RE_P0: { re: RegExp; reason: IntakePriorityReason }[] = [
  { re: /\/(checkout|pay|payment|payments|billing|purchase|paypal|stripe|paystack|fawry)(\/|$)/i, reason: 'path_payment' },
  { re: /\/(order|orders)\/.+\/(pay|confirm|complete)(\/|$)/i, reason: 'path_checkout' },
  { re: /\/(api\/)?v?\d*\/?(payments?|checkout|billing)(\/|$)/i, reason: 'path_payment' },
  { re: /\/(3ds|three[_-]?d|cvv|card[_-]?confirm)(\/|$)/i, reason: 'path_payment' },
];

const RE_P1: { re: RegExp; reason: IntakePriorityReason }[] = [
  { re: /\/(login|signin|sign-in|auth\/login|session)(\/|$)/i, reason: 'path_auth_sensitive' },
  { re: /\/(signup|register|sign-up|auth\/register)(\/|$)/i, reason: 'path_auth_sensitive' },
  { re: /\/(password|reset-password|forgot|mfa|2fa|otp|passkey|webauthn)(\/|$)/i, reason: 'path_auth_sensitive' },
  { re: /\/(account|profile|user)\/(delete|security|email|password)(\/|$)/i, reason: 'path_account_write' },
  { re: /\/(orders?)(\/|$)/i, reason: 'path_order_write' },
  { re: /\/(admin|dashboard\/admin|internal\/admin)(\/|$)/i, reason: 'path_admin' },
  { re: /\/(cart\/checkout|place[_-]?order)(\/|$)/i, reason: 'path_checkout' },
];

const RE_P2: { re: RegExp; reason: IntakePriorityReason }[] = [
  { re: /\/(api\/)/i, reason: 'path_api_write' },
  { re: /\/(search|graphql|query)(\/|$)/i, reason: 'path_search' },
  { re: /\/(cart|wishlist|favorite|upload|submit|form)(\/|$)/i, reason: 'path_api_write' },
  { re: /\/(settings|preferences|notifications)(\/|$)/i, reason: 'path_account_write' },
];

const RE_P3_LIGHT: { re: RegExp; reason: IntakePriorityReason }[] = [
  { re: /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm|pdf)(\?|$)/i, reason: 'path_static' },
  { re: /\/(health|ready|livez|readyz|nginx-health|favicon\.ico)(\/|$)/i, reason: 'path_health' },
  { re: /\/(static|assets|public|_next\/static|media|images)(\/|$)/i, reason: 'path_static' },
  { re: /\/(products?|catalog|shop|blog|posts?|about|contact)(\/|$)/i, reason: 'path_browse' },
  { re: /\/$/i, reason: 'path_browse' },
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function classifyPriority(
  method: string,
  path: string,
): { priority: IntakePriority; reasons: IntakePriorityReason[] } {
  const reasons: IntakePriorityReason[] = [];
  const m = method.toUpperCase();

  for (const { re, reason } of RE_P0) {
    if (re.test(path)) {
      reasons.push(reason);
      return { priority: 'P0_CRITICAL', reasons };
    }
  }

  for (const { re, reason } of RE_P1) {
    if (re.test(path)) {
      reasons.push(reason);
      // GET على /orders قد يكون قراءة — كتابة ترفع أكثر لاحقًا
      if (WRITE_METHODS.has(m) || reason !== 'path_order_write') {
        return { priority: 'P1_HIGH', reasons };
      }
      // GET /orders → نتركه يكمل؛ غالباً P2
      reasons.pop();
      break;
    }
  }

  // إعادة فحص P1 للمسارات التي كسرناها أعلاه
  for (const { re, reason } of RE_P1) {
    if (re.test(path) && reason !== 'path_order_write') {
      reasons.push(reason);
      return { priority: 'P1_HIGH', reasons };
    }
    if (re.test(path) && reason === 'path_order_write' && WRITE_METHODS.has(m)) {
      reasons.push(reason);
      return { priority: 'P1_HIGH', reasons };
    }
  }

  for (const { re, reason } of RE_P3_LIGHT) {
    if (re.test(path)) {
      reasons.push(reason);
      // static/health تبقى NORMAL حتى لو POST بالخطأ
      return { priority: 'P3_NORMAL', reasons };
    }
  }

  for (const { re, reason } of RE_P2) {
    if (re.test(path)) {
      reasons.push(reason);
      if (WRITE_METHODS.has(m) && reason === 'path_api_write') {
        reasons.push('method_write_boost');
      }
      return { priority: 'P2_MEDIUM', reasons };
    }
  }

  // كتابة عامة على مسار غير معروف → medium
  if (WRITE_METHODS.has(m)) {
    reasons.push('method_write_boost');
    return { priority: 'P2_MEDIUM', reasons };
  }

  reasons.push('default');
  return { priority: 'P3_NORMAL', reasons };
}

// ------------------------------------------------------------------
// شرائح الإشارة + Lane
// ------------------------------------------------------------------

function classifyTls(
  ja4?: string | null,
  ja3?: string | null,
  headers?: IntakeClassifyInput['headers'],
): TlsSignalBucket {
  const j4 =
    hasNonEmpty(ja4) ||
    hasNonEmpty(headerGet(headers, 'x-ja4')) ||
    hasNonEmpty(headerGet(headers, 'ssl-ja4'));
  const j3 =
    hasNonEmpty(ja3) ||
    hasNonEmpty(headerGet(headers, 'x-ja3')) ||
    hasNonEmpty(headerGet(headers, 'ssl-ja3'));

  if (j4 && j3) return 'tls_ja4_ja3';
  if (j4) return 'tls_ja4_only';
  if (j3) return 'tls_ja3_only';
  return 'tls_none';
}

function classifyDevice(
  deviceFingerprint?: string | null,
  headers?: IntakeClassifyInput['headers'],
): DeviceSignalBucket {
  if (hasNonEmpty(deviceFingerprint)) return 'device_fp_present';
  const fromHeader =
    headerGet(headers, 'x-device-fingerprint') ||
    headerGet(headers, 'x-fp') ||
    headerGet(headers, 'x-client-fp');
  return hasNonEmpty(fromHeader) ? 'device_fp_present' : 'device_fp_absent';
}

function classifyClientKind(
  headers?: IntakeClassifyInput['headers'],
): ClientKindBucket {
  const ua = (headerGet(headers, 'user-agent') || '').toLowerCase();
  if (!ua) return 'api_client';
  if (
    /mozilla|chrome|safari|firefox|edg\/|opr\/|iphone|ipad|android/i.test(ua)
  ) {
    return 'browser_like';
  }
  if (/curl|wget|python|go-http|java\/|okhttp|postman|insomnia|httpclient|scrapy|bot/i.test(ua)) {
    return 'api_client';
  }
  return 'unknown_client';
}

function resolveLane(params: {
  tls: TlsSignalBucket;
  device: DeviceSignalBucket;
  isSimulation?: boolean;
}): IntakeLane {
  if (params.isSimulation) return 'lane_simulation';

  const hasTls = params.tls !== 'tls_none';
  const hasDev = params.device === 'device_fp_present';

  if (hasTls && hasDev) return 'lane_secure_browser';
  if (hasTls && !hasDev) return 'lane_tls_only';
  if (!hasTls && hasDev) return 'lane_device_only';
  return 'lane_opaque';
}

// ------------------------------------------------------------------
// الدالة الرئيسية — متزامنة وسريعة
// ------------------------------------------------------------------

export function classifyIntake(input: IntakeClassifyInput): IntakeClassifyResult {
  const t0 =
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();

  const method = (input.method || 'GET').toUpperCase();
  const normalizedPath = normalizePath(input.path || '/');

  const { priority, reasons } = classifyPriority(method, normalizedPath);
  const priorityRank = PRIORITY_RANK[priority];

  const tlsBucket = classifyTls(input.ja4, input.ja3, input.headers);
  const deviceBucket = classifyDevice(input.deviceFingerprint, input.headers);
  const clearanceBucket: ClearanceSignalBucket = input.hasClearanceCookie
    ? 'clearance_present'
    : 'clearance_absent';
  const clientKind = classifyClientKind(input.headers);
  const lane = resolveLane({
    tls: tlsBucket,
    device: deviceBucket,
    isSimulation: input.isSimulation,
  });

  const isLightweight =
    reasons.includes('path_static') || reasons.includes('path_health');

  const preferImmediate =
    priority === 'P0_CRITICAL' || priority === 'P1_HIGH';

  const queueKey = `${priority}|${lane}`;

  const t1 =
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();

  return {
    priority,
    priorityRank,
    priorityReasons: reasons,
    tlsBucket,
    deviceBucket,
    clearanceBucket,
    clientKind,
    lane,
    normalizedPath,
    method,
    preferImmediate,
    isLightweight,
    queueKey,
    timingMs: Math.max(0, t1 - t0),
  };
}

// ------------------------------------------------------------------
// مساعدات للطابور في app.ts (من غير ما الملف يدير الطابور)
// ------------------------------------------------------------------

/** ترتيب مقارن: rank أقل أولًا، ثم P0 يسبق داخل نفس اللحظة */
export function compareIntakePriority(
  a: Pick<IntakeClassifyResult, 'priorityRank' | 'preferImmediate'>,
  b: Pick<IntakeClassifyResult, 'priorityRank' | 'preferImmediate'>,
): number {
  if (a.priorityRank !== b.priorityRank) {
    return a.priorityRank - b.priorityRank;
  }
  if (a.preferImmediate !== b.preferImmediate) {
    return a.preferImmediate ? -1 : 1;
  }
  return 0;
}

/**
 * اقتراح: كم طلب NORMAL يُمرَّر بعد دفعة عالية الأولوية
 * (سياسة بسيطة — app يقدر يغيّر الأرقام)
 *
 * مثال: بعد كل 5 من P0/P1 → مرّر 1 من P2/P3 حتى لا يتضوّر التصفح.
 */
export function suggestScheduleSlice(counts: {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}): { next: IntakePriority; reason: string } {
  if (counts.p0 > 0) {
    return { next: 'P0_CRITICAL', reason: 'drain_critical' };
  }
  if (counts.p1 > 0) {
    return { next: 'P1_HIGH', reason: 'drain_high' };
  }
  // خلط بسيط: لو في P2 كتير مع P3، فضّل P2
  if (counts.p2 > 0 && counts.p2 >= counts.p3) {
    return { next: 'P2_MEDIUM', reason: 'drain_medium' };
  }
  if (counts.p3 > 0) {
    return { next: 'P3_NORMAL', reason: 'drain_normal' };
  }
  if (counts.p2 > 0) {
    return { next: 'P2_MEDIUM', reason: 'drain_medium' };
  }
  return { next: 'P3_NORMAL', reason: 'idle' };
}

/** تصدير للـ AI / events — شكل ثابت */
export function intakeForAi(
  r: IntakeClassifyResult,
): Record<string, unknown> {
  return {
    kind: 'intake_classification',
    priority: r.priority,
    priorityRank: r.priorityRank,
    priorityReasons: r.priorityReasons,
    tlsBucket: r.tlsBucket,
    deviceBucket: r.deviceBucket,
    clearanceBucket: r.clearanceBucket,
    clientKind: r.clientKind,
    lane: r.lane,
    path: r.normalizedPath,
    method: r.method,
    preferImmediate: r.preferImmediate,
    isLightweight: r.isLightweight,
    queueKey: r.queueKey,
  };
}

export default {
  classifyIntake,
  normalizePath,
  compareIntakePriority,
  suggestScheduleSlice,
  intakeForAi,
  PRIORITY_RANK,
};