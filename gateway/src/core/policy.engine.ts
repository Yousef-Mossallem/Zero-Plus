/**
 * core/policy.engine.ts
 * ==================================================================
 * المسؤولية الوحيدة لهذا الملف:
 *   تحويل (درجة المخاطر + سياسة الشركة) إلى "إجراء" مناسب.
 *
 * الإجراءات الممكنة:
 *   allow / challenge / rate_limit / temporary_ban / permanent_ban
 *
 * ما لا يفعله هذا الملف عن قصد:
 *   - لا يحسب المخاطر                     -> risk.engine.ts
 *   - لا يختار مسار الفحص                 -> suspicion-router.ts
 *   - لا ينفّذ الحظر فعلياً               -> ban.manager.ts
 *   - لا يتصل بالـ AI أو Redis أو Backend
 *
 * هو فقط يجيب عن السؤال: "ماذا يجب أن يحدث؟"
 * ومن ينفّذ القرار هو من يقرر "كيف يحدث".
 *
 * ملاحظة عن جلب السياسة: جلبها من الـ Backend (backend.client)
 * يتم خارج هذا الملف، وهنا نستقبل النتيجة فقط (قد تكون null لو فشل الجلب).
 * ==================================================================
 */

/** سياسة الشركة كما يرجعها الـ Backend. */
export interface CompanyPolicy {
  /**
   * عدد مرات فشل الـ Challenge قبل الحظر التلقائي المؤقت.
   * القيمة 0 تعني أن الميزة معطّلة.
   */
  autoBanAfterFails: number;
  /** مدة الحظر المؤقت بالدقائق. */
  temporaryBanMinutes: number;
  /** من هذه الدرجة فما فوق: حظر دائم. */
  permanentBanScore: number;
  /**
   * true  : تجاوز الحد الأقصى للطلبات يؤدي إلى حظر مؤقت.
   * false : تجاوز الحد الأقصى يؤدي إلى تقييد المعدل فقط (rate_limit).
   */
  banOnMaxRequests: boolean;
  /** من هذه الدرجة فما فوق: يُطلب Challenge. (حد خاص بكل شركة) */
  challengeScore: number;
  /** من هذه الدرجة فما فوق: حظر مؤقت. (حد خاص بكل شركة) */
  temporaryBanScore: number;
}

/**
 * السياسة الافتراضية عند تعذر جلب سياسة الشركة.
 *
 * معنى "آمنة" هنا: لا تفتح الباب على مصراعيه، ولا تحظر بقسوة بسبب عطل عندنا.
 *   - challengeScore = 31      : نفس بداية النطاق الثاني في التصميم.
 *   - temporaryBanScore = 81   : نفس بداية نطاق الحظر في التصميم.
 *   - permanentBanScore = 95   : الدائم لا يُطبق إلا على الحالات الواضحة جداً.
 *   - banOnMaxRequests = false : تجاوز الطلبات يُقيَّد فقط ولا يُحظر،
 *                                لتجنب حظر مستخدمين سليمين لمجرد أن السياسة لم تُجلب.
 *
 * Object.freeze يمنع أي كود آخر من تعديل الافتراضيات بالخطأ.
 */
export const DEFAULT_POLICY: Readonly<CompanyPolicy> = Object.freeze({
  autoBanAfterFails: 5,
  temporaryBanMinutes: 15,
  permanentBanScore: 95,
  banOnMaxRequests: false,
  challengeScore: 31,
  temporaryBanScore: 81,
});

/** أنواع الإجراءات الممكنة. */
export type PolicyAction =
  | 'allow'
  | 'challenge'
  | 'rate_limit'
  | 'temporary_ban'
  | 'permanent_ban';

/**
 * سبب القرار.
 * يُسجَّل في سجل الأحداث الأمنية لنعرف "لماذا" اتُّخذ الإجراء لاحقاً،
 * ولا نكتفي بمعرفة "ماذا" اتُّخذ.
 */
export type PolicyReason =
  | 'permanent_ban_score'
  | 'auto_ban_after_fails'
  | 'max_requests_ban'
  | 'max_requests_rate_limit'
  | 'temporary_ban_score'
  | 'challenge_score'
  | 'below_threshold';

/** المعطيات اللازمة لاتخاذ القرار. */
export interface PolicyContext {
  /** درجة المخاطر القادمة من risk.engine (0..100). */
  riskScore: number;
  /** عدد مرات فشل الـ Challenge لهذا الزائر (افتراضياً 0). */
  failedChallenges?: number;
  /** هل تجاوز الزائر الحد الأقصى للطلبات (افتراضياً false). */
  maxRequestsExceeded?: boolean;
}

/** القرار النهائي. */
export interface PolicyDecision {
  action: PolicyAction;
  reason: PolicyReason;
  /** مدة الحظر بالدقائق؛ موجودة فقط مع temporary_ban. */
  banMinutes?: number;
}

/** نتيجة تنظيف السياسة. */
export interface ResolvedPolicy {
  /** سياسة صالحة 100%. */
  policy: CompanyPolicy;
  /**
   * true لو استُخدمت قيمة افتراضية لحقل واحد على الأقل
   * (السياسة null أو ناقصة أو بقيم تالفة). مفيدة لتنبيه الفريق في السجلات.
   */
  usedFallback: boolean;
}

/** درجة صالحة = رقم محدود بين 0 و 100. */
const isScore = (v: unknown): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

/**
 * فاحص صلاحية لكل حقل في السياسة.
 * أي قيمة لا تنجح في الفحص تُستبدل بالقيمة الافتراضية لذلك الحقل فقط.
 * (Record<keyof CompanyPolicy, ...> يجبرنا على كتابة فاحص لكل حقل جديد.)
 */
const VALIDATORS: Record<keyof CompanyPolicy, (v: unknown) => boolean> = {
  // عدد صحيح >= 0 (الصفر يعطّل الحظر التلقائي).
  autoBanAfterFails: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
  // مدة موجبة (حظر مدته صفر أو سالبة بلا معنى).
  temporaryBanMinutes: (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
  permanentBanScore: isScore,
  banOnMaxRequests: (v) => typeof v === 'boolean',
  challengeScore: isScore,
  temporaryBanScore: isScore,
};

/**
 * تحويل السياسة الخام إلى سياسة صالحة دائماً.
 *
 * الخام قد تكون: null (فشل الجلب) / ناقصة / فيها قيم تالفة.
 * هذه هي نقطة الأمان الوحيدة في الملف، وكل الدوال الأخرى تفترض أن السياسة سليمة بعدها.
 *
 * @param raw السياسة كما وصلت من الـ Backend
 */
export function resolvePolicy(raw?: Partial<CompanyPolicy> | null): ResolvedPolicy {
  // الحالة الأولى: لا توجد سياسة أصلاً (فشل الجلب) -> الافتراضية كاملة.
  // نُرجع نسخة {...DEFAULT_POLICY} حتى لا يعدّل أحد الكائن المجمّد الأصلي.
  if (!raw || typeof raw !== 'object') {
    return { policy: { ...DEFAULT_POLICY }, usedFallback: true };
  }

  // نبدأ بالافتراضية ثم نستبدل بها الحقول الصالحة القادمة من الشركة.
  const merged: CompanyPolicy = { ...DEFAULT_POLICY };
  const target = merged as unknown as Record<string, unknown>;
  let usedFallback = false;

  for (const key of Object.keys(VALIDATORS) as (keyof CompanyPolicy)[]) {
    const value = raw[key];
    if (VALIDATORS[key](value)) {
      target[key] = value; // قيمة الشركة صالحة -> نستخدمها
    } else {
      usedFallback = true; // ناقصة أو تالفة -> بقيت الافتراضية
    }
  }

  // الحدود الثلاثة يجب أن تكون متدرجة: challenge <= temporaryBan <= permanentBan.
  // لو كُسر الترتيب ستتناقض القرارات (مثلاً حظر دائم قبل المؤقت)،
  // لذلك نعيد الحدود الثلاثة معاً للافتراضية بدلاً من إصلاح واحد منها بتخمين.
  const ordered =
    merged.challengeScore <= merged.temporaryBanScore &&
    merged.temporaryBanScore <= merged.permanentBanScore;
  if (!ordered) {
    merged.challengeScore = DEFAULT_POLICY.challengeScore;
    merged.temporaryBanScore = DEFAULT_POLICY.temporaryBanScore;
    merged.permanentBanScore = DEFAULT_POLICY.permanentBanScore;
    usedFallback = true;
  }

  return { policy: merged, usedFallback };
}

/**
 * قرار الحظر وفق السياسة: دائم أو مؤقت.
 *
 * القاعدة: لو الدرجة وصلت permanentBanScore فالحظر دائم، وإلا فهو مؤقت بمدة السياسة.
 * يستخدمه suspicion-router لنطاق 81..100 وللقائمة السوداء،
 * ويحافظ على منطق "ما نوع الحظر" في مكان واحد (policy.engine) دون تكراره في الـ router.
 *
 * @param riskScore الدرجة التي يُقرر على أساسها نوع الحظر
 * @param rawPolicy سياسة الشركة (قد تكون null)
 */
export function resolveBan(
  riskScore: number,
  rawPolicy?: Partial<CompanyPolicy> | null,
): PolicyDecision {
  const { policy } = resolvePolicy(rawPolicy);

  if (riskScore >= policy.permanentBanScore) {
    return { action: 'permanent_ban', reason: 'permanent_ban_score' };
  }

  return {
    action: 'temporary_ban',
    reason: 'temporary_ban_score',
    banMinutes: policy.temporaryBanMinutes,
  };
}

/**
 * القرار الرئيسي.
 *
 * الأولوية من الأشد إلى الأخف (أول شرط يتحقق يحسم القرار):
 *   1) درجة تصل للحظر الدائم
 *   2) فشل Challenge متكرر (حظر تلقائي)
 *   3) تجاوز الحد الأقصى للطلبات (حظر أو تقييد حسب banOnMaxRequests)
 *   4) درجة تصل للحظر المؤقت
 *   5) درجة تصل للـ Challenge
 *   6) سماح
 *
 * سبب ترتيب (2) و(3) قبل (4): سلوك الزائر الفعلي (فشل أو تجاوز) دليل
 * أقوى من الدرجة وحدها، فيُحظر حتى لو كانت درجته منخفضة.
 *
 * @param ctx      الدرجة وعدد المحاولات الفاشلة وهل تجاوز الطلبات
 * @param rawPolicy سياسة الشركة (قد تكون null أو ناقصة)
 */
export function decidePolicy(
  ctx: PolicyContext,
  rawPolicy?: Partial<CompanyPolicy> | null,
): PolicyDecision {
  // نضمن سياسة صالحة قبل أي مقارنة.
  const { policy } = resolvePolicy(rawPolicy);

  // درجة غير صالحة (NaN مثلاً) لا نعتبرها آمنة (فلا نسمح)،
  // ولا نحظر بسببها (فلا نظلم)؛ نعاملها كأقل درجة تستوجب Challenge.
  const score = Number.isFinite(ctx.riskScore) ? ctx.riskScore : policy.challengeScore;

  // (1) الحظر الدائم.
  if (score >= policy.permanentBanScore) {
    return { action: 'permanent_ban', reason: 'permanent_ban_score' };
  }

  // (2) الحظر التلقائي بعد فشل الـ Challenge. autoBanAfterFails = 0 يعطّله.
  const fails = ctx.failedChallenges ?? 0;
  if (policy.autoBanAfterFails > 0 && fails >= policy.autoBanAfterFails) {
    return {
      action: 'temporary_ban',
      reason: 'auto_ban_after_fails',
      banMinutes: policy.temporaryBanMinutes,
    };
  }

  // (3) تجاوز الحد الأقصى للطلبات: الشركة هي التي تحدد حظر أم تقييد.
  if (ctx.maxRequestsExceeded) {
    return policy.banOnMaxRequests
      ? {
          action: 'temporary_ban',
          reason: 'max_requests_ban',
          banMinutes: policy.temporaryBanMinutes,
        }
      : { action: 'rate_limit', reason: 'max_requests_rate_limit' };
  }

  // (4) الحظر المؤقت حسب الدرجة.
  if (score >= policy.temporaryBanScore) {
    return {
      action: 'temporary_ban',
      reason: 'temporary_ban_score',
      banMinutes: policy.temporaryBanMinutes,
    };
  }

  // (5) طلب Challenge حسب الدرجة.
  if (score >= policy.challengeScore) {
    return { action: 'challenge', reason: 'challenge_score' };
  }

  // (6) لا شيء يستدعي تدخلاً.
  return { action: 'allow', reason: 'below_threshold' };
}
