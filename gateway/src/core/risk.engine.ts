/**
 * core/risk.engine.ts
 * ==================================================================
 * تحويل إشارات الفحص إلى Risk Score (0–100) + components قابلة للتفسير.
 *
 * لا يقرر ALLOW/BLOCK          → policy.engine
 * لا يختار مسار التحدي         → suspicion-router
 * لا يتصل بـ Redis / AI / Backend / IP lookup
 *   كل القيم تُمرَّر جاهزة من app.ts (أو tests).
 *
 * AI:
 *   - رقم 0..1 من ai.client (إنتاج) أو من محاكاة موثوقة بعد sim-auth
 *   - null / undefined / NaN → مساهمة 0 (fail-open)
 *
 * IP:
 *   - badIp + badIpScore من inspectIpReputation (networkRiskScore)
 *
 * Pure functions: نفس المدخلات → نفس المخرجات دائمًا.
 * ==================================================================
 */

// ------------------------------------------------------------------
// أوزان — المجموع = 100 بالضبط
// ------------------------------------------------------------------

export const RISK_WEIGHTS = {
  /** سمعة / نوع الشبكة (Tor, VPN, DC عالي، blocklist…) — من ip-reputation */
  badIp: 15,
  /** ضغط المعدل — من rate-limiter (soft/hard) */
  highRequestRate: 25,
  /** شذوذ سلوكي — من AI الحقيقي أو بديل المحاكاة */
  aiAnomaly: 30,
  /** JA3/JA4 / device fp مشبوه — من fingerprint-authenticator */
  suspiciousFingerprint: 10,
  /** سجل سمعة / حظر / فشل تحديات — من ban + backend reputation */
  priorHistory: 20,
} as const;

export type RiskSignalName = keyof typeof RISK_WEIGHTS;

export const MAX_RISK_SCORE = 100;

/** تحقق بنيوي — استخدمه في اختبارات */
export function sumRiskWeights(): number {
  return (Object.values(RISK_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);
}

if (sumRiskWeights() !== MAX_RISK_SCORE) {
  // تحذير وقت التحميل فقط — لا يكسر التشغيل
  console.warn(
    `[risk.engine] RISK_WEIGHTS sum=${sumRiskWeights()} expected ${MAX_RISK_SCORE}`,
  );
}

// ------------------------------------------------------------------
// حدود تفسيرية (مش قرار نهائي — policy.engine له عتبات الشركة)
// ------------------------------------------------------------------

export const RISK_BANDS = {
  silentMax: 30,
  throttleMax: 60,
  advancedMax: 80,
} as const;

// ------------------------------------------------------------------
// المدخلات
// ------------------------------------------------------------------

/**
 * كل إشارة ثنائية يمكن استبدالها بنسبة 0..1 أدق.
 * أولوية: score إن وُجد وصالح → وإلا boolean → وإلا 0.
 */
export interface RiskSignals {
  badIp?: boolean;
  /** 0..1 شدة شبكة (مثل networkRiskScore من ip-reputation) */
  badIpScore?: number | null;

  highRequestRate?: boolean;
  /**
   * 0..1 — soft ≈ 0.45–0.6 ، hard ≈ 1
   */
  highRequestRateScore?: number | null;

  /**
   * شذوذ AI 0..1
   * null → غير متاح (مساهمة 0)
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
  /** نقاط صحيحة تُجمع في score */
  contribution: number;
  triggered: boolean;
  /** النسبة بعد التطبيع 0..1 */
  ratio: number;
}

export interface RiskResult {
  /** 0..100 عدد صحيح */
  score: number;
  components: RiskComponent[];
  /** true لو AI لم يُحسب */
  aiUnavailable: boolean;
  /** مجموع النسب المرجّحة قبل التقريب (للتشخيص) */
  rawWeightedTotal: number;
}

// ------------------------------------------------------------------
// تطبيع
// ------------------------------------------------------------------

/** يقص إلى [0,1] — غير رقمي → 0 */
export function toRatio(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * boolean و/أو score → نسبة واحدة.
 * لو score معرّف (حتى 0) نستخدمه؛ وإلا flag.
 */
export function resolveRatio(
  flag: boolean | undefined,
  score: number | null | undefined,
): number {
  if (score !== undefined && score !== null) {
    return toRatio(score);
  }
  return flag === true ? 1 : 0;
}

function buildComponent(signal: RiskSignalName, ratio: number): RiskComponent {
  const weight = RISK_WEIGHTS[signal];
  const safe = toRatio(ratio);
  // تقريب لأقرب صحيح — مجموع المكوّنات يبقى منطقي مع الأوزان الصحيحة
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
    typeof aiRaw !== 'number' ||
    !Number.isFinite(aiRaw);

  const ratios = {
    badIp: resolveRatio(signals.badIp, signals.badIpScore),
    highRequestRate: resolveRatio(
      signals.highRequestRate,
      signals.highRequestRateScore,
    ),
    aiAnomaly: aiUnavailable ? 0 : toRatio(aiRaw),
    suspiciousFingerprint: resolveRatio(
      signals.suspiciousFingerprint,
      signals.suspiciousFingerprintScore,
    ),
    priorHistory: resolveRatio(signals.priorHistory, signals.priorHistoryScore),
  };

  const components: RiskComponent[] = [
    buildComponent('badIp', ratios.badIp),
    buildComponent('highRequestRate', ratios.highRequestRate),
    buildComponent('aiAnomaly', ratios.aiAnomaly),
    buildComponent('suspiciousFingerprint', ratios.suspiciousFingerprint),
    buildComponent('priorHistory', ratios.priorHistory),
  ];

  const rawWeightedTotal =
    RISK_WEIGHTS.badIp * ratios.badIp +
    RISK_WEIGHTS.highRequestRate * ratios.highRequestRate +
    RISK_WEIGHTS.aiAnomaly * ratios.aiAnomaly +
    RISK_WEIGHTS.suspiciousFingerprint * ratios.suspiciousFingerprint +
    RISK_WEIGHTS.priorHistory * ratios.priorHistory;

  const total = components.reduce((sum, c) => sum + c.contribution, 0);
  const score = Math.min(MAX_RISK_SCORE, Math.max(0, total));

  return {
    score,
    components,
    aiUnavailable,
    rawWeightedTotal: Number(rawWeightedTotal.toFixed(4)),
  };
}

// ------------------------------------------------------------------
// مساعدات بناء الإشارات (من طبقات الجتواي)
// ------------------------------------------------------------------

export function emptyRiskSignals(): RiskSignals {
  return {
    badIp: false,
    badIpScore: null,
    highRequestRate: false,
    highRequestRateScore: null,
    aiAnomalyScore: null,
    suspiciousFingerprint: false,
    suspiciousFingerprintScore: null,
    priorHistory: false,
    priorHistoryScore: null,
  };
}

export type RateLevel = 'none' | 'soft' | 'hard';

/**
 * بناء موحّد من مخرجات:
 *   - ip-reputation (badIp, networkRiskScore)
 *   - rate-limiter (soft/hard)
 *   - ai.client (anomalyScore 0..1)
 *   - fingerprint-authenticator
 *   - ban / reputation history
 */
export function buildRiskSignals(input: {
  badIp?: boolean;
  badIpScore?: number | null;
  /** بديل مباشر من IpReputationResult.networkRiskScore */
  networkRiskScore?: number | null;
  rateLevel?: RateLevel;
  highRequestRate?: boolean;
  highRequestRateScore?: number | null;
  aiAnomalyScore?: number | null;
  suspiciousFingerprint?: boolean;
  suspiciousFingerprintScore?: number | null;
  priorHistory?: boolean;
  priorHistoryScore?: number | null;
}): RiskSignals {
  // IP: صريح score أو networkRiskScore أو boolean
  let badIp = input.badIp ?? false;
  let badIpScore =
    input.badIpScore !== undefined && input.badIpScore !== null
      ? input.badIpScore
      : input.networkRiskScore !== undefined && input.networkRiskScore !== null
        ? input.networkRiskScore
        : null;

  if (badIpScore !== null && badIpScore > 0) {
    badIp = true;
  }

  let highRequestRate = input.highRequestRate;
  let highRequestRateScore = input.highRequestRateScore;

  if (input.rateLevel === 'hard') {
    highRequestRate = true;
    highRequestRateScore =
      highRequestRateScore !== undefined && highRequestRateScore !== null
        ? highRequestRateScore
        : 1;
  } else if (input.rateLevel === 'soft') {
    highRequestRate = true;
    highRequestRateScore =
      highRequestRateScore !== undefined && highRequestRateScore !== null
        ? highRequestRateScore
        : 0.5;
  } else if (input.rateLevel === 'none') {
    highRequestRate = false;
    highRequestRateScore = 0;
  }

  return {
    badIp,
    badIpScore,
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

/**
 * اختصار من نتيجة ip-reputation.ts
 */
export function riskSignalsFromIpReputation(ip: {
  badIp?: boolean;
  networkRiskScore?: number;
  kind?: string;
  signals?: {
    backendBanned?: boolean;
    backendKnownBotnet?: boolean;
    backendAllowlisted?: boolean;
  };
}): Pick<RiskSignals, 'badIp' | 'badIpScore'> {
  if (ip.signals?.backendAllowlisted) {
    return { badIp: false, badIpScore: 0 };
  }
  const score = toRatio(ip.networkRiskScore);
  const bad =
    ip.badIp === true ||
    ip.signals?.backendBanned === true ||
    ip.signals?.backendKnownBotnet === true ||
    score >= 0.55;
  return {
    badIp: bad,
    badIpScore: score,
  };
}

/**
 * اختصار من AiAnalyzeResult
 */
export function riskSignalsFromAi(ai: {
  ok?: boolean;
  failed?: boolean;
  anomalyScore?: number;
} | null | undefined): Pick<RiskSignals, 'aiAnomalyScore'> {
  if (!ai || ai.failed || ai.ok === false) {
    return { aiAnomalyScore: null };
  }
  if (typeof ai.anomalyScore !== 'number' || !Number.isFinite(ai.anomalyScore)) {
    return { aiAnomalyScore: null };
  }
  return { aiAnomalyScore: toRatio(ai.anomalyScore) };
}

// ------------------------------------------------------------------
// ملخصات و bands
// ------------------------------------------------------------------

export function summarizeRisk(result: RiskResult): string {
  const hit = result.components
    .filter((c) => c.triggered)
    .map((c) => `${c.signal}:${c.contribution}`)
    .join(', ');
  const aiNote = result.aiUnavailable ? ' ai=unavailable' : '';
  return `risk=${result.score}${aiNote}${hit ? ` [${hit}]` : ''}`;
}

export function bandForScore(
  score: number,
): 'low' | 'medium' | 'high' | 'critical' {
  if (!Number.isFinite(score) || score <= RISK_BANDS.silentMax) return 'low';
  if (score <= RISK_BANDS.throttleMax) return 'medium';
  if (score <= RISK_BANDS.advancedMax) return 'high';
  return 'critical';
}

/** تفكيك للمكونات كـ Record (للـ events / AI extra) */
export function componentsToMap(
  result: RiskResult,
): Record<RiskSignalName, number> {
  const out = {} as Record<RiskSignalName, number>;
  for (const c of result.components) {
    out[c.signal] = c.contribution;
  }
  return out;
}

// ------------------------------------------------------------------
// أمثلة قيم متوقعة (مرجع — مش تُنفَّذ تلقائيًا)
// ------------------------------------------------------------------
/**
 * زائر سكني نظيف، AI=0.1، من غير rate:
 *   badIp≈0.07*15≈1 ، ai≈3 ، total ≈ 4 → low
 *
 * Tor + AI=0.8 + hard rate:
 *   badIp 15 + rate 25 + ai 24 = 64 → high (+ history إن وُجد)
 *
 * DC badIp + soft rate + AI null:
 *   ~10 + 13 + 0 ≈ 23 → low/medium حدّي
 */

// ------------------------------------------------------------------
// تصدير
// ------------------------------------------------------------------

export default {
  RISK_WEIGHTS,
  MAX_RISK_SCORE,
  RISK_BANDS,
  calculateRisk,
  buildRiskSignals,
  emptyRiskSignals,
  riskSignalsFromIpReputation,
  riskSignalsFromAi,
  summarizeRisk,
  bandForScore,
  componentsToMap,
  toRatio,
  resolveRatio,
  sumRiskWeights,
};