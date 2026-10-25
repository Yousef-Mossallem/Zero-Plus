/**
 * core/risk.engine.ts
 * ==================================================================
 * المسؤولية الوحيدة لهذا الملف:
 *   تحويل "إشارات الفحص" إلى Risk Score من 0 إلى 100،
 *   مع توضيح مساهمة كل إشارة في النتيجة (components).
 *
 * ما لا يفعله هذا الملف عن قصد (قواعد استقلالية الملفات):
 *   - لا يقرر الحظر ولا السماح           -> هذا شغل policy.engine.ts
 *   - لا يختار مسار الفحص                -> هذا شغل suspicion-router.ts
 *   - لا يتصل بـ Redis أو AI أو Backend  -> الإشارات تُمرَّر له جاهزة
 *   - لا يستورد أي ملف TypeScript من خدمة الـ AI
 *     (الـ AI يرسل درجة الشذوذ عبر HTTP، ومن يستقبلها يمررها هنا كرقم)
 *
 * طبيعة الملف: دوال نقية (Pure Functions).
 *   نفس المدخلات تعطي نفس المخرجات دائماً، ولا توجد حالة مخزنة،
 *   وهذا يجعل الاختبار سهلاً ويجعل النتيجة قابلة للتفسير والتتبع.
 * ==================================================================
 */

/**
 * أوزان الإشارات حسب التصميم المعتمد.
 *
 * ملاحظة مهمة: مجموع الأوزان = 100 بالضبط
 *   15 + 25 + 30 + 10 + 20 = 100
 * وهذا هو الضمان البنيوي بأن الدرجة لن تتجاوز 100:
 * كل إشارة لا تستطيع أن تضيف أكثر من وزنها، ومجموع الأوزان هو السقف.
 * (يوجد اختبار يتأكد أن المجموع 100 حتى لا يكسره تعديل مستقبلي بالخطأ.)
 *
 * `as const` تجعل القيم ثابتة للقراءة فقط، وتجعل TypeScript يعرف
 * أسماء المفاتيح بدقة ليشتق منها النوع RiskSignalName أدناه.
 */
export const RISK_WEIGHTS = {
  badIp: 15, // سمعة IP سيئة
  highRequestRate: 25, // معدل طلبات مرتفع
  aiAnomaly: 30, // شذوذ صادر عن خدمة الـ AI
  suspiciousFingerprint: 10, // بصمة مشبوهة
  priorHistory: 20, // سجل سابق سيئ للزائر
} as const;

/**
 * أسماء الإشارات مشتقة من كائن الأوزان نفسه (keyof typeof).
 * الفائدة: لو أضفنا إشارة جديدة في RISK_WEIGHTS يتحدث النوع تلقائياً،
 * ولا يمكن أن يحدث تعارض بين الأسماء والأوزان.
 */
export type RiskSignalName = keyof typeof RISK_WEIGHTS;

/** الحد الأقصى المطلق للدرجة النهائية. */
export const MAX_RISK_SCORE = 100;

/**
 * إشارات الفحص المُدخلة للمحرك.
 *
 * الإشارات الأربع (IP، المعدل، البصمة، السجل) ثنائية: موجودة أو غير موجودة.
 * أما الـ AI فيعطي درجة متدرجة من 0 إلى 1، لأن الشذوذ ليس "نعم/لا" بل مستوى.
 */
export interface RiskSignals {
  /** هل الـ IP ذو سمعة سيئة (من ip-reputation). */
  badIp: boolean;
  /** هل معدل الطلبات مرتفع (من rate-limiter). */
  highRequestRate: boolean;
  /**
   * درجة الشذوذ من خدمة الـ AI، بين 0 و 1.
   * null أو undefined تعني أن الـ AI غير متاح الآن (تعطل مثلاً)،
   * وفي هذه الحالة تُحسب 0 حتى لا نعاقب الزائر بسبب عطل عندنا.
   */
  aiAnomalyScore?: number | null;
  /** هل البصمة مشبوهة (من fingerprint-authenticator). */
  suspiciousFingerprint: boolean;
  /** هل للزائر سجل سابق سيئ. */
  priorHistory: boolean;
}

/** مساهمة إشارة واحدة في النتيجة النهائية. */
export interface RiskComponent {
  /** اسم الإشارة. */
  signal: RiskSignalName;
  /** الوزن الأقصى الذي تستطيع هذه الإشارة إضافته. */
  weight: number;
  /** النقاط التي أضافتها فعلياً (عدد صحيح بين 0 و weight). */
  contribution: number;
  /** هل ساهمت الإشارة بأي نقاط (contribution > 0). */
  triggered: boolean;
}

/** نتيجة حساب المخاطر. */
export interface RiskResult {
  /** الدرجة النهائية، عدد صحيح من 0 إلى 100. */
  score: number;
  /**
   * تفاصيل الإشارات الخمس دائماً وبنفس الترتيب،
   * ومجموع contribution فيها يساوي score بالضبط.
   */
  components: RiskComponent[];
}

/**
 * تحويل أي قيمة إلى نسبة آمنة بين 0 و 1.
 *
 * - القيمة الأكبر من 1 تُقصّ إلى 1 (لا تعطي أكثر من الوزن الكامل).
 * - القيمة السالبة تُقصّ إلى 0.
 * - القيم غير الرقمية أو NaN أو Infinity أو null/undefined تُعتبر 0،
 *   لأن بيانات تالفة لا تصلح أساساً لمعاقبة زائر.
 */
function toRatio(value: number | null | undefined): number {
  // typeof يستبعد null و undefined والنصوص، وisFinite يستبعد NaN والـ Infinity.
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  // Math.max(0, ...) يمنع السالب، وMath.min(1, ...) يمنع ما فوق 1.
  return Math.min(1, Math.max(0, value));
}

/**
 * بناء مكوّن واحد من مكونات النتيجة.
 *
 * النقاط = الوزن × النسبة، مقرّبة لأقرب عدد صحيح.
 * التقريب يتم هنا (لكل مكوّن على حدة) وليس على المجموع،
 * وهذا هو ما يجعل مجموع المكونات مطابقاً للدرجة النهائية بدقة تامة:
 * نحن نجمع أعداداً صحيحة فقط فلا يوجد كسور تضيع عند الجمع.
 *
 * @param signal اسم الإشارة
 * @param ratio  نسبة التفعيل بين 0 و 1 (0 = غير مفعّلة، 1 = كاملة)
 */
function buildComponent(signal: RiskSignalName, ratio: number): RiskComponent {
  const weight = RISK_WEIGHTS[signal];
  const contribution = Math.round(weight * ratio);
  return { signal, weight, contribution, triggered: contribution > 0 };
}

/**
 * حساب درجة المخاطر.
 *
 * الخطوات:
 *   1) تحويل كل إشارة إلى نسبة (0 أو 1 للثنائية، 0..1 للـ AI).
 *   2) تحويل كل نسبة إلى مكوّن (نقاط صحيحة).
 *   3) جمع النقاط.
 *   4) تقييد الناتج بـ 100 كحماية إضافية.
 *
 * @param signals الإشارات المجمّعة من طبقات الفحص
 * @returns الدرجة النهائية + تفاصيل مساهمة كل إشارة
 */
export function calculateRisk(signals: RiskSignals): RiskResult {
  // الترتيب هنا ثابت ومقصود: السجلات والواجهات تعتمد عليه.
  const components: RiskComponent[] = [
    buildComponent('badIp', signals.badIp ? 1 : 0),
    buildComponent('highRequestRate', signals.highRequestRate ? 1 : 0),
    buildComponent('aiAnomaly', toRatio(signals.aiAnomalyScore)),
    buildComponent('suspiciousFingerprint', signals.suspiciousFingerprint ? 1 : 0),
    buildComponent('priorHistory', signals.priorHistory ? 1 : 0),
  ];

  // جمع النقاط الصحيحة لكل المكونات.
  const total = components.reduce((sum, c) => sum + c.contribution, 0);

  // لن يتفعّل هذا الحد فعلياً لأن مجموع الأوزان 100،
  // لكنه خط دفاع ثانٍ يضمن "لا تتجاوز 100 أبداً" حتى لو عُدّلت الأوزان بالخطأ مستقبلاً.
  const score = Math.min(MAX_RISK_SCORE, total);

  return { score, components };
}
