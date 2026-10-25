/**
 * detection/suspicion-router.ts
 * ==================================================================
 * المسؤولية الوحيدة لهذا الملف:
 *   اختيار "مسار الفحص" المناسب بناءً على درجة المخاطر.
 *
 * النطاقات المعتمدة في التصميم:
 *   0   .. 30  -> JavaScript Challenge صامت
 *   31  .. 60  -> تقييد المعدل مع Challenge
 *   61  .. 80  -> فحص متقدم للبصمة
 *   81  .. 100 -> الحظر وفق السياسة
 *   + الجهاز في القائمة السوداء -> حظر فوري بغض النظر عن الدرجة
 *
 * ما لا يفعله هذا الملف عن قصد:
 *   - لا يحسب الدرجة                         -> risk.engine.ts
 *   - لا يحدد نوع الحظر بنفسه                -> يسأل policy.engine (resolveBan)
 *   - لا ينفّذ أي مسار                       -> app.ts هو من ينفّذ
 *   - لا يتصل بـ Redis أو AI أو Backend
 *
 * أي أنه يعيد "اسم المسار" فقط، ومن يستدعيه يقرر كيف ينفذه.
 * ==================================================================
 */

import { resolveBan } from '../core/policy.engine';
import type { CompanyPolicy, PolicyDecision } from '../core/policy.engine';

/**
 * آخر قيمة (شاملة) في كل نطاق.
 * تغيير حدود النطاقات يتم من هذا الكائن فقط، فلا توجد أرقام سحرية متفرقة.
 * النطاق الأخير (الحظر) لا يحتاج حداً لأنه "كل ما فوق advancedMax".
 */
export const ROUTE_BOUNDARIES = {
  silentMax: 30,
  throttleMax: 60,
  advancedMax: 80,
} as const;

/** المسارات الممكنة. */
export type InspectionRoute =
  | 'silent_js_challenge'
  | 'rate_limit_with_challenge'
  | 'advanced_fingerprint_check'
  | 'ban';

/**
 * سبب اختيار المسار (يُسجَّل في الأحداث الأمنية).
 * يفرّق بين "حُظر لأنه في القائمة السوداء" و"حُظر لأن درجته عالية".
 */
export type RouteReason =
  | 'blacklisted'
  | 'low_risk'
  | 'medium_risk'
  | 'high_risk'
  | 'critical_risk'
  | 'invalid_score';

/** مدخلات الـ router. */
export interface RouteInput {
  /** الدرجة القادمة من risk.engine (0..100). */
  riskScore: number;
  /** هل الجهاز/البصمة موجود في القائمة السوداء (من ban.manager أو ما يماثله). */
  isBlacklisted: boolean;
  /**
   * سياسة الشركة. لو null أو لم تُمرَّر تُستخدم الافتراضية داخل policy.engine،
   * فلا حاجة لأي معالجة إضافية هنا.
   */
  policy?: Partial<CompanyPolicy> | null;
}

/** قرار الـ router. */
export interface RouteDecision {
  route: InspectionRoute;
  reason: RouteReason;
  /** تفاصيل الحظر (مؤقت/دائم ومدته)؛ موجودة فقط عندما route = 'ban'. */
  ban?: PolicyDecision;
}

/**
 * اختيار المسار.
 *
 * الترتيب هنا جوهري، وكل خطوة لها سبب:
 *   1) القائمة السوداء أولاً، حتى لا تنقذ الدرجةُ المنخفضة جهازاً محظوراً.
 *   2) الدرجة التالفة (NaN وما شابه) ثانياً، قبل أي مقارنة رقمية.
 *   3) ثم النطاقات من الأدنى إلى الأعلى.
 *
 * @param input الدرجة وحالة القائمة السوداء وسياسة الشركة
 */
export function routeSuspicion(input: RouteInput): RouteDecision {
  const { riskScore, isBlacklisted, policy } = input;

  // (1) القائمة السوداء: حظر فوري مهما كانت الدرجة.
  // نمرّر 100 إلى resolveBan لأن الجهاز المحظور معروف مسبقاً أنه خطر؛
  // فتبقى السياسة هي التي تقرر نوع الحظر (دائم إذا كان permanentBanScore يسمح،
  // وإلا مؤقت بمدة الشركة) دون أن يقرر الـ router ذلك بنفسه.
  if (isBlacklisted) {
    return { route: 'ban', reason: 'blacklisted', ban: resolveBan(100, policy) };
  }

  // (2) درجة غير صالحة: في JavaScript كل مقارنة مع NaN تعطي false،
  // فلو تركناها لسقطت الدرجة التالفة إلى آخر فرع (الحظر) بالخطأ.
  // لذلك نتعامل معها صراحةً: لا نحظر بسبب خلل داخلي، ولا نتساهل: فحص متقدم.
  if (!Number.isFinite(riskScore)) {
    return { route: 'advanced_fingerprint_check', reason: 'invalid_score' };
  }

  // (3) النطاقات. الحدود شاملة (<=) فتنتمي 30 للنطاق الأول،
  // و60 للثاني، و80 للثالث، وأول قيمة في كل نطاق تالٍ هي 31 و61 و81.
  // القيم الكسرية (مثل 30.5) تذهب للنطاق الأعلى لأنها أكبر من 30.
  if (riskScore <= ROUTE_BOUNDARIES.silentMax) {
    return { route: 'silent_js_challenge', reason: 'low_risk' };
  }
  if (riskScore <= ROUTE_BOUNDARIES.throttleMax) {
    return { route: 'rate_limit_with_challenge', reason: 'medium_risk' };
  }
  if (riskScore <= ROUTE_BOUNDARIES.advancedMax) {
    return { route: 'advanced_fingerprint_check', reason: 'high_risk' };
  }

  // (4) 81 فما فوق: الحظر. نوعه (مؤقت أو دائم) تحدده السياسة عبر resolveBan،
  // مع تمرير الدرجة الفعلية (وليس 100) لأن permanentBanScore قد يكون 95 مثلاً.
  return { route: 'ban', reason: 'critical_risk', ban: resolveBan(riskScore, policy) };
}
