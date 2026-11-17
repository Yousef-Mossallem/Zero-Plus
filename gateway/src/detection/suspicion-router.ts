/**
 * detection/suspicion-router.ts
 * ==================================================================
 * المسؤولية الوحيدة:
 *   اختيار "اسم مسار الفحص" من Risk Score (+ قائمة سوداء).
 *
 * النطاقات (حدود شاملة من الأسفل، متوافقة مع risk.engine RISK_BANDS):
 *   0   .. 30  → silent_js_challenge
 *   31  .. 60  → rate_limit_with_challenge
 *   61  .. 80  → advanced_fingerprint_check
 *   81  .. 100 → ban  (نوع الحظر من policy.engine.resolveBan)
 *   + isBlacklisted → ban فوري بغض النظر عن الدرجة
 *
 * ما لا يفعله:
 *   - لا يحسب Risk                         → risk.engine
 *   - لا يدمج توصية AI                      → app.ts (mergeAiWithGatewayPlan)
 *   - لا ينفّذ MONITOR_ONLY                 → app.ts بعد هذا الملف
 *   - لا ينفّذ تحدي/حظر/forward             → app.ts
 *   - لا يتصل بـ Redis / AI / Backend
 *
 * Pure: نفس المدخلات → نفس المخرجات.
 * ==================================================================
 */

import { resolveBan } from '../core/policy.engine';
import type { CompanyPolicy, PolicyDecision } from '../core/policy.engine';

// ------------------------------------------------------------------
// الحدود — مصدر واحد داخل الملف (مطابقة risk.engine: 30 / 60 / 80)
// ------------------------------------------------------------------

export const ROUTE_BOUNDARIES = {
  /** آخر درجة في مسار JS الصامت */
  silentMax: 30,
  /** آخر درجة في مسار التقييد + تحدي */
  throttleMax: 60,
  /** آخر درجة في الفحص المتقدم — فوقها ban */
  advancedMax: 80,
} as const;

export type RouteBoundaryKey = keyof typeof ROUTE_BOUNDARIES;

/** المسارات الممكنة التي يفهمها app.ts */
export type InspectionRoute =
  | 'silent_js_challenge'
  | 'rate_limit_with_challenge'
  | 'advanced_fingerprint_check'
  | 'ban';

/**
 * سبب الاختيار — يُسجَّل في Security Events / AI extra
 */
export type RouteReason =
  | 'blacklisted'
  | 'low_risk'
  | 'medium_risk'
  | 'high_risk'
  | 'critical_risk'
  | 'invalid_score'
  | 'forced_route';

// ------------------------------------------------------------------
// المدخلات / المخرجات
// ------------------------------------------------------------------

export interface RouteInput {
  /** من calculateRisk().score — يُفضَّل 0..100 */
  riskScore: number;
  /** من ban.manager / سمعة: جهاز أو IP محظور فعليًا */
  isBlacklisted: boolean;
  /**
   * سياسة الشركة لـ resolveBan فقط.
   * null → الافتراضية داخل policy.engine
   */
  policy?: Partial<CompanyPolicy> | null;
  /**
   * اختياري: إجبار مسار (اختبارات / future_action من AI بعد ما app يقرر)
   * لا يتجاوز القائمة السوداء إلا إذا forceIgnoreBlacklist
   */
  forceRoute?: InspectionRoute | null;
  forceIgnoreBlacklist?: boolean;
}

export interface RouteDecision {
  route: InspectionRoute;
  reason: RouteReason;
  /** الدرجة بعد التطبيع التشخيصي (NaN → null) */
  normalizedScore: number | null;
  /** نطاق تفسيري */
  band: 'low' | 'medium' | 'high' | 'critical' | 'invalid' | 'blacklist';
  /** موجودة فقط عندما route === 'ban' */
  ban?: PolicyDecision;
  /** للشفافية في اللوجات */
  boundaries: typeof ROUTE_BOUNDARIES;
}

// ------------------------------------------------------------------
// مساعدات
// ------------------------------------------------------------------

export function clampScore(score: number): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

export function bandForRouteScore(
  score: number | null,
): RouteDecision['band'] {
  if (score === null) return 'invalid';
  if (score <= ROUTE_BOUNDARIES.silentMax) return 'low';
  if (score <= ROUTE_BOUNDARIES.throttleMax) return 'medium';
  if (score <= ROUTE_BOUNDARIES.advancedMax) return 'high';
  return 'critical';
}

/**
 * هل المسار يتضمّن تحديًا (JS أو متقدم)؟
 * مفيد لقاعدة "تحدي واحد لكل طلب" في app.ts
 */
export function routeImpliesChallenge(route: InspectionRoute): boolean {
  return (
    route === 'silent_js_challenge' ||
    route === 'rate_limit_with_challenge' ||
    route === 'advanced_fingerprint_check'
  );
}

export function routeImpliesBan(route: InspectionRoute): boolean {
  return route === 'ban';
}

export function routeImpliesRateLimit(route: InspectionRoute): boolean {
  return route === 'rate_limit_with_challenge';
}

/** تحويل مسار → قرار سياسة تقريبي للّوج (التنفيذ الفعلي في app) */
export function routeToActionHint(
  route: InspectionRoute,
): 'challenge_js' | 'rate_limit' | 'challenge_advanced' | 'block' {
  switch (route) {
    case 'silent_js_challenge':
      return 'challenge_js';
    case 'rate_limit_with_challenge':
      return 'rate_limit';
    case 'advanced_fingerprint_check':
      return 'challenge_advanced';
    case 'ban':
      return 'block';
  }
}

/** ملخص سطر واحد للـ event-logger */
export function summarizeRoute(d: RouteDecision): string {
  const banBit =
    d.ban && d.route === 'ban'
      ? ` ban=${(d.ban as { action?: string }).action ?? 'ban'}`
      : '';
  return `route=${d.route} reason=${d.reason} band=${d.band} score=${
    d.normalizedScore ?? 'NaN'
  }${banBit}`;
}

function decision(
  partial: Omit<RouteDecision, 'boundaries'> & {
    boundaries?: typeof ROUTE_BOUNDARIES;
  },
): RouteDecision {
  return {
    ...partial,
    boundaries: ROUTE_BOUNDARIES,
  };
}

// ------------------------------------------------------------------
// الاختيار الرئيسي
// ------------------------------------------------------------------

/**
 * ترتيب جوهري:
 *   1) قائمة سوداء (إلا إذا force مع ignore)
 *   2) forceRoute اختياري (اختبار / طبقة app بعد دمج AI)
 *   3) درجة غير صالحة → advanced (لا حظر بسبب خلل داخلي)
 *   4) نطاقات من الأدنى للأعلى
 *   5) critical → ban عبر resolveBan(degree)
 */
export function routeSuspicion(input: RouteInput): RouteDecision {
  const {
    riskScore,
    isBlacklisted,
    policy = null,
    forceRoute = null,
    forceIgnoreBlacklist = false,
  } = input;

  // (1) قائمة سوداء
  if (isBlacklisted && !forceIgnoreBlacklist) {
    return decision({
      route: 'ban',
      reason: 'blacklisted',
      normalizedScore: clampScore(riskScore),
      band: 'blacklist',
      ban: resolveBan(100, policy),
    });
  }

  // (2) إجبار مسار (بعد ما app يطبّق future/AI إن لزم)
  if (
    forceRoute === 'silent_js_challenge' ||
    forceRoute === 'rate_limit_with_challenge' ||
    forceRoute === 'advanced_fingerprint_check' ||
    forceRoute === 'ban'
  ) {
    const normalizedScore = clampScore(riskScore);
    if (forceRoute === 'ban') {
      return decision({
        route: 'ban',
        reason: 'forced_route',
        normalizedScore,
        band: bandForRouteScore(normalizedScore),
        ban: resolveBan(
          normalizedScore === null ? 100 : normalizedScore,
          policy,
        ),
      });
    }
    return decision({
      route: forceRoute,
      reason: 'forced_route',
      normalizedScore,
      band: bandForRouteScore(normalizedScore),
    });
  }

  // (3) درجة تالفة
  const normalizedScore = clampScore(riskScore);
  if (normalizedScore === null) {
    return decision({
      route: 'advanced_fingerprint_check',
      reason: 'invalid_score',
      normalizedScore: null,
      band: 'invalid',
    });
  }

  // (4) نطاقات — الحدود شاملة
  if (normalizedScore <= ROUTE_BOUNDARIES.silentMax) {
    return decision({
      route: 'silent_js_challenge',
      reason: 'low_risk',
      normalizedScore,
      band: 'low',
    });
  }

  if (normalizedScore <= ROUTE_BOUNDARIES.throttleMax) {
    return decision({
      route: 'rate_limit_with_challenge',
      reason: 'medium_risk',
      normalizedScore,
      band: 'medium',
    });
  }

  if (normalizedScore <= ROUTE_BOUNDARIES.advancedMax) {
    return decision({
      route: 'advanced_fingerprint_check',
      reason: 'high_risk',
      normalizedScore,
      band: 'high',
    });
  }

  // (5) 81+
  return decision({
    route: 'ban',
    reason: 'critical_risk',
    normalizedScore,
    band: 'critical',
    ban: resolveBan(normalizedScore, policy),
  });
}

/**
 * نسخة مختصرة للاستدعاء الشائع من app.ts
 */
export function routeFromRisk(
  riskScore: number,
  isBlacklisted: boolean,
  policy?: Partial<CompanyPolicy> | null,
): RouteDecision {
  return routeSuspicion({ riskScore, isBlacklisted, policy });
}

/**
 * هل حدود الملف متوافقة مع قيم risk.engine المتوقعة؟
 * (للاختبارات — silentMax=30, throttleMax=60, advancedMax=80)
 */
export function assertDefaultBoundaries(): boolean {
  return (
    ROUTE_BOUNDARIES.silentMax === 30 &&
    ROUTE_BOUNDARIES.throttleMax === 60 &&
    ROUTE_BOUNDARIES.advancedMax === 80
  );
}

// ------------------------------------------------------------------
// تصدير
// ------------------------------------------------------------------

export default {
  ROUTE_BOUNDARIES,
  routeSuspicion,
  routeFromRisk,
  clampScore,
  bandForRouteScore,
  routeImpliesChallenge,
  routeImpliesBan,
  routeImpliesRateLimit,
  routeToActionHint,
  summarizeRoute,
  assertDefaultBoundaries,
};