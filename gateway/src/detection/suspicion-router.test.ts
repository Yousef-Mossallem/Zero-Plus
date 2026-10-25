import { describe, it, expect } from 'vitest';
import { routeSuspicion, ROUTE_BOUNDARIES } from './suspicion-router';
import { calculateRisk } from '../core/risk.engine';
import { decidePolicy, DEFAULT_POLICY, type CompanyPolicy } from '../core/policy.engine';

/** سياسة اختبار: حظر مؤقت 30 دقيقة، ودائم من 95. */
const policy: CompanyPolicy = {
  autoBanAfterFails: 3,
  temporaryBanMinutes: 30,
  permanentBanScore: 95,
  banOnMaxRequests: true,
  challengeScore: 31,
  temporaryBanScore: 81,
};

describe('suspicion-router - حدود النطاقات', () => {
  it.each([
    [0, 'silent_js_challenge'],
    [30, 'silent_js_challenge'], // آخر قيمة في النطاق الأول
    [31, 'rate_limit_with_challenge'], // أول قيمة في الثاني
    [60, 'rate_limit_with_challenge'], // آخر قيمة في الثاني
    [61, 'advanced_fingerprint_check'], // أول قيمة في الثالث
    [80, 'advanced_fingerprint_check'], // آخر قيمة في الثالث
    [81, 'ban'], // أول قيمة في الرابع
    [100, 'ban'],
  ])('الدرجة %i -> %s', (riskScore, route) => {
    expect(routeSuspicion({ riskScore, isBlacklisted: false, policy }).route).toBe(route);
  });

  it('الحدود المعرّفة مطابقة للتصميم', () => {
    expect(ROUTE_BOUNDARIES).toEqual({ silentMax: 30, throttleMax: 60, advancedMax: 80 });
  });

  it('كل الدرجات الصحيحة من 0 إلى 100 تعطي مساراً واحداً صحيحاً', () => {
    for (let s = 0; s <= 100; s++) {
      const { route } = routeSuspicion({ riskScore: s, isBlacklisted: false, policy });
      const expected =
        s <= 30
          ? 'silent_js_challenge'
          : s <= 60
            ? 'rate_limit_with_challenge'
            : s <= 80
              ? 'advanced_fingerprint_check'
              : 'ban';
      expect(route).toBe(expected);
    }
  });

  it('الكسور تتبع النطاق الأعلى (30.5 -> الثاني)', () => {
    expect(routeSuspicion({ riskScore: 30.5, isBlacklisted: false, policy }).route).toBe(
      'rate_limit_with_challenge',
    );
  });

  it('الدرجة 80.5 تذهب للحظر لأنها أكبر من 80', () => {
    expect(routeSuspicion({ riskScore: 80.5, isBlacklisted: false, policy }).route).toBe('ban');
  });

  it('المسار لا يتغير بتغير سياسة الشركة في النطاقات غير الحظرية', () => {
    const other = { ...policy, challengeScore: 5, temporaryBanScore: 10 };
    for (const riskScore of [0, 30, 31, 60, 61, 80]) {
      expect(routeSuspicion({ riskScore, isBlacklisted: false, policy: other }).route).toBe(
        routeSuspicion({ riskScore, isBlacklisted: false, policy }).route,
      );
    }
  });
});

describe('suspicion-router - أسباب القرار', () => {
  it.each([
    [10, 'low_risk'],
    [45, 'medium_risk'],
    [70, 'high_risk'],
    [90, 'critical_risk'],
  ])('الدرجة %i -> السبب %s', (riskScore, reason) => {
    expect(routeSuspicion({ riskScore, isBlacklisted: false, policy }).reason).toBe(reason);
  });

  it('المسارات غير الحظر لا تحمل ban', () => {
    for (const riskScore of [0, 30, 31, 60, 61, 80]) {
      expect(routeSuspicion({ riskScore, isBlacklisted: false, policy }).ban).toBeUndefined();
    }
  });
});

describe('suspicion-router - الحظر وفق السياسة', () => {
  it('81 -> حظر مؤقت بمدة السياسة', () => {
    const r = routeSuspicion({ riskScore: 81, isBlacklisted: false, policy });
    expect(r.ban).toEqual({ action: 'temporary_ban', reason: 'temporary_ban_score', banMinutes: 30 });
  });

  it('94 -> مؤقت، و95 -> دائم (حد permanentBanScore)', () => {
    expect(routeSuspicion({ riskScore: 94, isBlacklisted: false, policy }).ban?.action).toBe(
      'temporary_ban',
    );
    expect(routeSuspicion({ riskScore: 95, isBlacklisted: false, policy }).ban?.action).toBe(
      'permanent_ban',
    );
  });

  it('سياسة أكثر تساهلاً (permanentBanScore = 100) تعطي مؤقتاً عند 95', () => {
    const soft = { ...policy, permanentBanScore: 100 };
    expect(routeSuspicion({ riskScore: 95, isBlacklisted: false, policy: soft }).ban?.action).toBe(
      'temporary_ban',
    );
  });

  it('مدة الحظر المؤقت تتبع السياسة', () => {
    const long = { ...policy, temporaryBanMinutes: 600 };
    expect(routeSuspicion({ riskScore: 85, isBlacklisted: false, policy: long }).ban?.banMinutes).toBe(
      600,
    );
  });

  it('سياسة null تستخدم الافتراضية', () => {
    const r = routeSuspicion({ riskScore: 85, isBlacklisted: false, policy: null });
    expect(r.ban?.banMinutes).toBe(DEFAULT_POLICY.temporaryBanMinutes);
  });

  it('سياسة غير مُمرَّرة (undefined) تستخدم الافتراضية', () => {
    const r = routeSuspicion({ riskScore: 85, isBlacklisted: false });
    expect(r.route).toBe('ban');
    expect(r.ban?.banMinutes).toBe(DEFAULT_POLICY.temporaryBanMinutes);
  });
});

describe('suspicion-router - القائمة السوداء', () => {
  it.each([0, 30, 31, 60, 61, 80, 81, 100])(
    'الجهاز المحظور بدرجة %i يُحظر فوراً',
    (riskScore) => {
      const r = routeSuspicion({ riskScore, isBlacklisted: true, policy });
      expect(r.route).toBe('ban');
      expect(r.reason).toBe('blacklisted');
      expect(r.ban).toBeDefined();
    },
  );

  it('الدرجة المنخفضة لا تنقذ الجهاز المحظور ولا تُسقط الحظر إلى allow', () => {
    const r = routeSuspicion({ riskScore: 0, isBlacklisted: true, policy });
    expect(r.ban?.action).not.toBe('allow');
    expect(['temporary_ban', 'permanent_ban']).toContain(r.ban?.action);
  });

  it('نوع حظر المحظور يتبع السياسة (دائم عندما permanentBanScore = 100)', () => {
    const permanentOnAny = { ...policy, permanentBanScore: 100 };
    expect(
      routeSuspicion({ riskScore: 0, isBlacklisted: true, policy: permanentOnAny }).ban?.action,
    ).toBe('permanent_ban');
  });

  it('يعمل أيضاً بدون سياسة', () => {
    const r = routeSuspicion({ riskScore: 5, isBlacklisted: true, policy: undefined });
    expect(r.route).toBe('ban');
  });

  it('غير المحظور بنفس الدرجة المنخفضة لا يُحظر (المقارنة العكسية)', () => {
    const r = routeSuspicion({ riskScore: 5, isBlacklisted: false, policy });
    expect(r.route).toBe('silent_js_challenge');
  });
});

describe('suspicion-router - درجة غير صالحة', () => {
  it.each([NaN, Infinity, -Infinity])(
    'الدرجة %s -> فحص متقدم وليس حظراً ولا سماحاً',
    (riskScore) => {
      const r = routeSuspicion({ riskScore, isBlacklisted: false, policy });
      expect(r.route).toBe('advanced_fingerprint_check');
      expect(r.reason).toBe('invalid_score');
    },
  );

  it('القائمة السوداء تتفوق على الدرجة التالفة', () => {
    expect(routeSuspicion({ riskScore: NaN, isBlacklisted: true, policy }).route).toBe('ban');
  });
});

/**
 * تكامل الملفات الثلاثة معاً: risk.engine -> suspicion-router + policy.engine
 * (هذا ما سيفعله app.ts لاحقاً، لكنه هنا بدون أي خدمة خارجية).
 */
describe('تكامل: risk.engine -> suspicion-router + policy.engine', () => {
  const base = {
    badIp: false,
    highRequestRate: false,
    aiAnomalyScore: 0,
    suspiciousFingerprint: false,
    priorHistory: false,
  };

  it('زائر نظيف: درجة 0 -> JS Challenge صامت، والسياسة تسمح', () => {
    const { score } = calculateRisk(base);
    expect(score).toBe(0);
    expect(routeSuspicion({ riskScore: score, isBlacklisted: false }).route).toBe(
      'silent_js_challenge',
    );
    expect(decidePolicy({ riskScore: score }).action).toBe('allow');
  });

  it('IP سيئ + معدل مرتفع (40): تقييد المعدل مع Challenge، والسياسة تطلب challenge', () => {
    const { score } = calculateRisk({ ...base, badIp: true, highRequestRate: true });
    expect(score).toBe(40);
    expect(routeSuspicion({ riskScore: score, isBlacklisted: false }).route).toBe(
      'rate_limit_with_challenge',
    );
    expect(decidePolicy({ riskScore: score }).action).toBe('challenge');
  });

  it('IP سيئ + معدل + شذوذ AI (70): فحص بصمة متقدم', () => {
    const { score } = calculateRisk({
      ...base,
      badIp: true,
      highRequestRate: true,
      aiAnomalyScore: 1,
    });
    expect(score).toBe(70);
    expect(routeSuspicion({ riskScore: score, isBlacklisted: false }).route).toBe(
      'advanced_fingerprint_check',
    );
  });

  it('مع السجل السابق (90): حظر مؤقت من الـ router ومن السياسة بنفس المدة', () => {
    const { score } = calculateRisk({
      ...base,
      badIp: true,
      highRequestRate: true,
      aiAnomalyScore: 1,
      priorHistory: true,
    });
    expect(score).toBe(90);
    const route = routeSuspicion({ riskScore: score, isBlacklisted: false });
    const decision = decidePolicy({ riskScore: score });
    expect(route.route).toBe('ban');
    expect(route.ban?.action).toBe('temporary_ban');
    expect(decision.action).toBe('temporary_ban');
    expect(route.ban?.banMinutes).toBe(decision.banMinutes);
  });

  it('كل الإشارات (100): حظر دائم عند الاثنين', () => {
    const { score } = calculateRisk({
      badIp: true,
      highRequestRate: true,
      aiAnomalyScore: 1,
      suspiciousFingerprint: true,
      priorHistory: true,
    });
    expect(score).toBe(100);
    expect(routeSuspicion({ riskScore: score, isBlacklisted: false }).ban?.action).toBe(
      'permanent_ban',
    );
    expect(decidePolicy({ riskScore: score }).action).toBe('permanent_ban');
  });

  it('زائر نظيف لكنه في القائمة السوداء: يُحظر رغم الدرجة 0', () => {
    const { score } = calculateRisk(base);
    expect(routeSuspicion({ riskScore: score, isBlacklisted: true }).route).toBe('ban');
  });
});
