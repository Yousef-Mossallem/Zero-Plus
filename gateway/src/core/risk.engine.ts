/**
 * core/risk.engine.ts
 * ==================================================================
 * تحويل إشارات الفحص إلى Risk Score (0–100) + components قابلة للتفسير.
 *
 * لا يقرر ALLOW/BLOCK (policy) · لا يختار المسار (suspicion-router)
 * لا يتصل بـ Redis / AI / Backend — كل القيم تُمرَّر جاهزة.
 *
 * AI:
 *   - رقم 0..1 من خدمة AI الحقيقية، أو من X-ZP-Sim-AI (محاكاة موثوقة فقط)
 *   - null/undefined → مساهمة 0 (fail-open: عطل عندنا لا يعاقب الزائر)
 *
 * Pure functions: نفس المدخلات → نفس المخرجات.
 * ==================================================================
 */

// ------------------------------------------------------------------
// أوزان — المجموع = 100
// ------------------------------------------------------------------

export const RISK_WEIGHTS = {
  /** سمعة / نوع الشبكة (Tor, DC, VPN عالي الخطورة، …) */
  badIp: 15,
  /** ضغط معدل الطلبات (soft/hard من rate-limiter) */
  highRequestRate: 25,
  /** شذوذ سلوكي — AI أو بديل المحاكاة */
  aiAnomaly: 30,
  /** JA3/JA4 / device fp مشبوه أو غير متسق */
  suspiciousFingerprint: 10,
  /** سجل سمعة / حظر سابق / فشل تحديات */
  priorHistory: 20,
} as const;

export type RiskSignalName = keyof typeof RISK_WEIGHTS;

export const MAX_RISK_SCORE = 100;

/** تحقق بنيوي: لو اتعدّلت الأوزان بالغلط في المستقبل */
export function sumRiskWeights(): number {
  return (Object.values(RISK_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);
}

// ------------------------------------------------------------------
// المدخلات
// ------------------------------------------------------------------

/**
 * كل إشارة ثنائية تقدر تتبدّل بنسبة 0..1 أدق (اختياري).
 * لو الاتنين موجودين: النسبة لها الأولوية.
 * لو الاتنين فاضيين: 0.
 */
export interface RiskSignals {
  /** IP خطير (من ip-reputation: tor / datacenter عالي / blocklist…) */
  badIp?: boolean;
  /** 0..1 شدة شبكة/سمعة IP */
  badIpScore?: number | null;

  /** تجاوز soft/hard rate */
  highRequestRate?: boolean;
  /**
   * 0..1 — مثال: soft فقط ≈ 0.4–0.6 ، hard ≈ 1
   * لو null والـ boolean true → 1
   */
  highRequestRateScore?: number | null;

  /**
   * شذوذ AI 0..1
   * محاكاة: من sim context بعد توكن صالح
   * إنتاج: من ai.client
   * غير متاح: null → 0
   */
  aiAnomalyScore?: number | null;

  suspiciousFingerprint?: boolean;
  suspiciousFingerprintScore?: number | null;

  priorHistory?: boolean;
  priorHistoryScore?: number | null;
}

export interface RiskComponent {
  signal: RiskSignalName;
  weight: number;
  contribution: number;
  triggered: boolean;
  /** النسبة المستخدمة 0..1 بعد التطبيع */
  ratio: number;
}

export interface RiskResult {
  /** 0..100 صحيح */
  score: number;
  components: RiskComponent[];
  /** true لو AI لم يُحسب (null) — للشفافية في اللوجات */
  aiUnavailable: boolean;
}

// ------------------------------------------------------------------
// تطبيع
// ------------------------------------------------------------------

/**
 * يقص أي رقم إلى [0, 1]. غير رقمي / NaN / Infinity → 0
 */
export function toRatio(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * boolean و/أو score → نسبة واحدة
 */
function resolveRatio(
  flag: boolean | undefined,
  score: number | null | undefined,
): number {
  if (score !== undefined && score !== null) {
    return toRatio(score);
  }
  return flag ? 1 : 0;
}

function buildComponent(
  signal: RiskSignalName,
  ratio: number,
): RiskComponent {
  const weight = RISK_WEIGHTS[signal];
  const safe = toRatio(ratio);
  const contribution = Math.round(weight * safe);
  return {
    signal,
    weight,
    contribution,
    ratio: safe,
    triggered: contribution > 0,
  };
}

// ------------------------------------------------------------------
// الحساب الرئيسي
// ------------------------------------------------------------------

export function calculateRisk(signals: RiskSignals): RiskResult {
  const aiRaw = signals.aiAnomalyScore;
  const aiUnavailable =
    aiRaw === null ||
    aiRaw === undefined ||
    (typeof aiRaw === 'number' && !Number.isFinite(aiRaw));

  const components: RiskComponent[] = [
    buildComponent(
      'badIp',
      resolveRatio(signals.badIp, signals.badIpScore),
    ),
    buildComponent(
      'highRequestRate',
      resolveRatio(signals.highRequestRate, signals.highRequestRateScore),
    ),
    buildComponent('aiAnomaly', aiUnavailable ? 0 : toRatio(aiRaw)),
    buildComponent(
      'suspiciousFingerprint',
      resolveRatio(
        signals.suspiciousFingerprint,
        signals.suspiciousFingerprintScore,
      ),
    ),
    buildComponent(
      'priorHistory',
      resolveRatio(signals.priorHistory, signals.priorHistoryScore),
    ),
  ];

  const total = components.reduce((sum, c) => sum + c.contribution, 0);
  const score = Math.min(MAX_RISK_SCORE, Math.max(0, total));

  return { score, components, aiUnavailable };
}

// ------------------------------------------------------------------
// مساعدات لـ app.ts / المحاكاة / الإنتاج
// ------------------------------------------------------------------

/** إشارات نظيفة */
export function emptyRiskSignals(): RiskSignals {
  return {
    badIp: false,
    highRequestRate: false,
    aiAnomalyScore: null,
    suspiciousFingerprint: false,
    priorHistory: false,
  };
}

/**
 * بناء سريع من طبقات الـ Gateway
 *
 * rateLevel: 'none' | 'soft' | 'hard'
 * aiScore: من AI الحقيقي أو simulationAiAnomalyScore(ctx)
 */
export function buildRiskSignals(input: {
  badIp?: boolean;
  badIpScore?: number | null;
  rateLevel?: 'none' | 'soft' | 'hard';
  highRequestRate?: boolean;
  highRequestRateScore?: number | null;
  aiAnomalyScore?: number | null;
  suspiciousFingerprint?: boolean;
  suspiciousFingerprintScore?: number | null;
  priorHistory?: boolean;
  priorHistoryScore?: number | null;
}): RiskSignals {
  let highRequestRate = input.highRequestRate;
  let highRequestRateScore = input.highRequestRateScore;

  if (input.rateLevel === 'hard') {
    highRequestRate = true;
    highRequestRateScore = highRequestRateScore ?? 1;
  } else if (input.rateLevel === 'soft') {
    highRequestRate = true;
    highRequestRateScore = highRequestRateScore ?? 0.5;
  } else if (input.rateLevel === 'none') {
    highRequestRate = false;
    highRequestRateScore = 0;
  }

  return {
    badIp: input.badIp ?? false,
    badIpScore: input.badIpScore,
    highRequestRate: highRequestRate ?? false,
    highRequestRateScore,
    aiAnomalyScore:
      input.aiAnomalyScore === undefined ? null : input.aiAnomalyScore,
    suspiciousFingerprint: input.suspiciousFingerprint ?? false,
    suspiciousFingerprintScore: input.suspiciousFingerprintScore,
    priorHistory: input.priorHistory ?? false,
    priorHistoryScore: input.priorHistoryScore,
  };
}

/** ملخص نصي للـ event logger */
export function summarizeRisk(result: RiskResult): string {
  const hit = result.components
    .filter((c) => c.triggered)
    .map((c) => `${c.signal}:${c.contribution}`)
    .join(', ');
  const aiNote = result.aiUnavailable ? ' (ai unavailable)' : '';
  return `risk=${result.score}${aiNote}${hit ? ` [${hit}]` : ''}`;
}

/**
 * هل الدرجة في نطاق يستحق تحدّي/حظر حسب حدود افتراضية؟
 * (القرار النهائي يبقى لـ policy.engine بعتبات الشركة)
 */
export function bandForScore(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (!Number.isFinite(score) || score <= 30) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 80) return 'high';
  return 'critical';
}

// ------------------------------------------------------------------
// تصدير افتراضي
// ------------------------------------------------------------------

export default {
  RISK_WEIGHTS,
  MAX_RISK_SCORE,
  calculateRisk,
  buildRiskSignals,
  emptyRiskSignals,
  summarizeRisk,
  bandForScore,
  toRatio,
  sumRiskWeights,
};