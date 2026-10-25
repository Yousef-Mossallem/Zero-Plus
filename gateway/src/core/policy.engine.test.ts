import { describe, it, expect } from 'vitest';
import {
  decidePolicy,
  resolvePolicy,
  resolveBan,
  DEFAULT_POLICY,
  type CompanyPolicy,
} from './policy.engine';

/** سياسة متساهلة: حدود عالية، حظر دائم نادر، لا حظر عند تجاوز الطلبات. */
const lenient: CompanyPolicy = {
  autoBanAfterFails: 10,
  temporaryBanMinutes: 5,
  permanentBanScore: 99,
  banOnMaxRequests: false,
  challengeScore: 60,
  temporaryBanScore: 90,
};

/** سياسة صارمة: حدود منخفضة، حظر سريع، حظر عند تجاوز الطلبات. */
const strict: CompanyPolicy = {
  autoBanAfterFails: 2,
  temporaryBanMinutes: 120,
  permanentBanScore: 80,
  banOnMaxRequests: true,
  challengeScore: 20,
  temporaryBanScore: 50,
};

describe('policy.engine - نفس الدرجة، سياسة مختلفة، قرار مختلف', () => {
  it('الدرجة 70: متساهلة -> challenge، صارمة -> temporary_ban', () => {
    expect(decidePolicy({ riskScore: 70 }, lenient).action).toBe('challenge');
    expect(decidePolicy({ riskScore: 70 }, strict).action).toBe('temporary_ban');
  });

  it('الدرجة 85: متساهلة -> challenge، صارمة -> permanent_ban', () => {
    expect(decidePolicy({ riskScore: 85 }, lenient).action).toBe('challenge');
    expect(decidePolicy({ riskScore: 85 }, strict).action).toBe('permanent_ban');
  });

  it('الدرجة 30: متساهلة -> allow، صارمة -> challenge', () => {
    expect(decidePolicy({ riskScore: 30 }, lenient).action).toBe('allow');
    expect(decidePolicy({ riskScore: 30 }, strict).action).toBe('challenge');
  });

  it('الدرجة 10: الاتنين -> allow (درجة منخفضة تتفق عليها كل السياسات)', () => {
    expect(decidePolicy({ riskScore: 10 }, lenient).action).toBe('allow');
    expect(decidePolicy({ riskScore: 10 }, strict).action).toBe('allow');
  });
});

describe('policy.engine - حدود الدرجات (القيم الافتراضية)', () => {
  const p: CompanyPolicy = { ...DEFAULT_POLICY };

  it.each([
    [0, 'allow'],
    [30, 'allow'],
    [31, 'challenge'], // أول درجة تستوجب challenge
    [80, 'challenge'],
    [81, 'temporary_ban'], // أول درجة تستوجب حظراً مؤقتاً
    [94, 'temporary_ban'],
    [95, 'permanent_ban'], // أول درجة تستوجب حظراً دائماً
    [100, 'permanent_ban'],
  ])('الدرجة %i -> %s', (riskScore, expected) => {
    expect(decidePolicy({ riskScore }, p).action).toBe(expected);
  });
});

describe('policy.engine - الحظر المؤقت والدائم', () => {
  it('المؤقت يحمل banMinutes من السياسة', () => {
    const d = decidePolicy({ riskScore: 55 }, strict);
    expect(d).toEqual({ action: 'temporary_ban', reason: 'temporary_ban_score', banMinutes: 120 });
  });

  it('مدة الحظر تختلف باختلاف السياسة', () => {
    expect(decidePolicy({ riskScore: 95 }, lenient).banMinutes).toBe(5);
    expect(decidePolicy({ riskScore: 55 }, strict).banMinutes).toBe(120);
  });

  it('الدائم لا يحمل banMinutes', () => {
    const d = decidePolicy({ riskScore: 99 }, strict);
    expect(d.action).toBe('permanent_ban');
    expect(d.banMinutes).toBeUndefined();
  });

  it('الحظر الدائم له الأولوية على فشل الـ Challenge وتجاوز الطلبات', () => {
    const d = decidePolicy(
      { riskScore: 100, failedChallenges: 50, maxRequestsExceeded: true },
      strict,
    );
    expect(d.action).toBe('permanent_ban');
  });
});

describe('policy.engine - فشل الـ Challenge المتكرر', () => {
  it('عند الوصول لـ autoBanAfterFails بالضبط يُحظر مؤقتاً حتى لو الدرجة منخفضة', () => {
    const d = decidePolicy({ riskScore: 0, failedChallenges: 2 }, strict);
    expect(d).toEqual({ action: 'temporary_ban', reason: 'auto_ban_after_fails', banMinutes: 120 });
  });

  it('أكثر من الحد يُحظر أيضاً', () => {
    expect(decidePolicy({ riskScore: 0, failedChallenges: 9 }, strict).action).toBe('temporary_ban');
  });

  it('قبل الحد بمحاولة واحدة لا يُحظر', () => {
    expect(decidePolicy({ riskScore: 0, failedChallenges: 1 }, strict).action).toBe('allow');
  });

  it('autoBanAfterFails = 0 يعطّل الميزة', () => {
    const off = { ...strict, autoBanAfterFails: 0 };
    expect(decidePolicy({ riskScore: 0, failedChallenges: 1000 }, off).action).toBe('allow');
  });

  it('غياب failedChallenges يُعتبر 0', () => {
    expect(decidePolicy({ riskScore: 0 }, strict).action).toBe('allow');
  });
});

describe('policy.engine - تجاوز الحد الأقصى للطلبات', () => {
  it('banOnMaxRequests = true -> حظر مؤقت', () => {
    const d = decidePolicy({ riskScore: 10, maxRequestsExceeded: true }, strict);
    expect(d).toEqual({ action: 'temporary_ban', reason: 'max_requests_ban', banMinutes: 120 });
  });

  it('banOnMaxRequests = false -> تقييد معدل فقط', () => {
    const d = decidePolicy({ riskScore: 10, maxRequestsExceeded: true }, lenient);
    expect(d).toEqual({ action: 'rate_limit', reason: 'max_requests_rate_limit' });
  });

  it('عدم التجاوز لا يؤثر على القرار', () => {
    expect(decidePolicy({ riskScore: 10, maxRequestsExceeded: false }, strict).action).toBe('allow');
  });

  it('نفس السلوك بسياستين مختلفتين يعطي قرارين مختلفين', () => {
    const ctx = { riskScore: 10, maxRequestsExceeded: true };
    expect(decidePolicy(ctx, strict).action).not.toBe(decidePolicy(ctx, lenient).action);
  });
});

describe('policy.engine - تعذر جلب السياسة (Fallback)', () => {
  it.each([null, undefined])('السياسة %s تستخدم الافتراضية', (missing) => {
    const r = resolvePolicy(missing);
    expect(r.policy).toEqual(DEFAULT_POLICY);
    expect(r.usedFallback).toBe(true);
    // والقرار يعمل بشكل طبيعي بالحدود الافتراضية:
    expect(decidePolicy({ riskScore: 50 }, missing).action).toBe('challenge');
    expect(decidePolicy({ riskScore: 90 }, missing).action).toBe('temporary_ban');
    expect(decidePolicy({ riskScore: 100 }, missing).action).toBe('permanent_ban');
  });

  it('سياسة ليست كائناً (نص مثلاً) تُعامل كأنها مفقودة', () => {
    const r = resolvePolicy('oops' as unknown as Partial<CompanyPolicy>);
    expect(r.policy).toEqual(DEFAULT_POLICY);
    expect(r.usedFallback).toBe(true);
  });

  it('الافتراضية: تجاوز الطلبات يُقيَّد ولا يُحظر', () => {
    const d = decidePolicy({ riskScore: 0, maxRequestsExceeded: true }, null);
    expect(d.action).toBe('rate_limit');
  });

  it('سياسة سليمة بالكامل لا تُعتبر Fallback', () => {
    const r = resolvePolicy(strict);
    expect(r.usedFallback).toBe(false);
    expect(r.policy).toEqual(strict);
  });

  it('سياسة ناقصة: الحقول الموجودة تُحفظ والناقصة تأخذ الافتراضي', () => {
    const r = resolvePolicy({ temporaryBanMinutes: 7 });
    expect(r.policy.temporaryBanMinutes).toBe(7);
    expect(r.policy.permanentBanScore).toBe(DEFAULT_POLICY.permanentBanScore);
    expect(r.usedFallback).toBe(true);
  });

  it('قيم تالفة تُستبدل بالافتراضية', () => {
    const r = resolvePolicy({
      ...strict,
      temporaryBanMinutes: -5,
      autoBanAfterFails: 1.5,
      permanentBanScore: 500,
      banOnMaxRequests: 'yes' as unknown as boolean,
    });
    expect(r.policy.temporaryBanMinutes).toBe(DEFAULT_POLICY.temporaryBanMinutes);
    expect(r.policy.autoBanAfterFails).toBe(DEFAULT_POLICY.autoBanAfterFails);
    expect(r.policy.permanentBanScore).toBe(DEFAULT_POLICY.permanentBanScore);
    expect(r.policy.banOnMaxRequests).toBe(DEFAULT_POLICY.banOnMaxRequests);
    expect(r.usedFallback).toBe(true);
  });

  it('القيم الصالحة تبقى كما هي حتى لو كانت بجانب قيم تالفة', () => {
    const r = resolvePolicy({ ...strict, temporaryBanMinutes: -5 });
    expect(r.policy.challengeScore).toBe(strict.challengeScore);
    expect(r.policy.temporaryBanScore).toBe(strict.temporaryBanScore);
  });

  it('حدود غير متدرجة تعيد الحدود الثلاثة للافتراضية', () => {
    const r = resolvePolicy({
      ...strict,
      challengeScore: 90,
      temporaryBanScore: 40,
      permanentBanScore: 70,
    });
    expect(r.policy.challengeScore).toBe(DEFAULT_POLICY.challengeScore);
    expect(r.policy.temporaryBanScore).toBe(DEFAULT_POLICY.temporaryBanScore);
    expect(r.policy.permanentBanScore).toBe(DEFAULT_POLICY.permanentBanScore);
    expect(r.usedFallback).toBe(true);
  });

  it('لا يعدّل DEFAULT_POLICY عند تعديل النتيجة', () => {
    const r = resolvePolicy(null);
    r.policy.temporaryBanMinutes = 9999;
    expect(DEFAULT_POLICY.temporaryBanMinutes).toBe(15);
  });

  it('DEFAULT_POLICY مجمّد ولا يمكن تعديله', () => {
    expect(Object.isFrozen(DEFAULT_POLICY)).toBe(true);
  });
});

describe('policy.engine - مدخلات شاذة', () => {
  it('درجة NaN تُعامل كـ challenge وليس allow', () => {
    expect(decidePolicy({ riskScore: NaN }, strict).action).toBe('challenge');
  });

  it('درجة Infinity تُعامل كغير صالحة وليس كحظر دائم', () => {
    expect(decidePolicy({ riskScore: Infinity }, strict).action).toBe('challenge');
  });
});

describe('policy.engine - resolveBan', () => {
  it('أقل من permanentBanScore -> مؤقت بمدة السياسة', () => {
    // 70 أقل من حد الدائم في السياسة الصارمة (80) فالحظر مؤقت 120 دقيقة.
    expect(resolveBan(70, strict)).toEqual({
      action: 'temporary_ban',
      reason: 'temporary_ban_score',
      banMinutes: 120,
    });
  });

  it('فوق permanentBanScore (85 مع صارمة) -> دائم', () => {
    expect(resolveBan(85, strict).action).toBe('permanent_ban');
  });

  it('عند permanentBanScore بالضبط -> دائم', () => {
    expect(resolveBan(80, strict).action).toBe('permanent_ban');
  });

  it('أقل بنقطة واحدة من permanentBanScore -> مؤقت', () => {
    expect(resolveBan(79, strict).action).toBe('temporary_ban');
  });

  it('بدون سياسة يستخدم الافتراضية', () => {
    expect(resolveBan(90, null).banMinutes).toBe(DEFAULT_POLICY.temporaryBanMinutes);
  });
});
