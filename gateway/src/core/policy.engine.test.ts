/**
 * core/policy.engine.test.ts
 * اختبارات شاملة — سياسات شركات مختلفة + fallback + حدود + سلوك حقيقي
 */

import { describe, it, expect } from 'vitest'
import {
  decidePolicy,
  resolvePolicy,
  resolveBan,
  DEFAULT_POLICY,
  type CompanyPolicy,
  type PolicyDecision,
} from './policy.engine'

// ------------------------------------------------------------------
// سياسات شركات وهمية (كأنهم من الباك بعد التحويل)
// ------------------------------------------------------------------

/** شركة تجارة — متساهلة */
const shopAcme: CompanyPolicy = {
  autoBanAfterFails: 10,
  temporaryBanMinutes: 5,
  permanentBanScore: 99,
  banOnMaxRequests: false,
  challengeScore: 60,
  temporaryBanScore: 90,
}

/** بنك / مالية — صارمة */
const bankSecure: CompanyPolicy = {
  autoBanAfterFails: 2,
  temporaryBanMinutes: 120,
  permanentBanScore: 80,
  banOnMaxRequests: true,
  challengeScore: 20,
  temporaryBanScore: 50,
}

/** SaaS متوسط — قريب من DEFAULT */
const saasMid: CompanyPolicy = {
  autoBanAfterFails: 5,
  temporaryBanMinutes: 30,
  permanentBanScore: 92,
  banOnMaxRequests: false,
  challengeScore: 35,
  temporaryBanScore: 75,
}

/** وكأن Backend رجّع سياسة منظمة A */
const orgAFromBackend: CompanyPolicy = {
  autoBanAfterFails: 3,
  temporaryBanMinutes: 60,
  permanentBanScore: 90,
  banOnMaxRequests: true,
  challengeScore: 40,
  temporaryBanScore: 70,
}

const lenient = shopAcme
const strict = bankSecure

function expectAction(
  score: number,
  policy: CompanyPolicy | null | undefined,
  action: PolicyDecision['action'],
  extra?: Partial<Parameters<typeof decidePolicy>[0]>,
) {
  const d = decidePolicy({ riskScore: score, ...extra }, policy)
  expect(d.action).toBe(action)
  return d
}

// ------------------------------------------------------------------
// نفس الدرجة — شركات مختلفة
// ------------------------------------------------------------------

describe('policy.engine — نفس الدرجة، سياسة شركة مختلفة', () => {
  it('70: متساهلة challenge / صارمة temporary_ban', () => {
    expect(decidePolicy({ riskScore: 70 }, shopAcme).action).toBe('challenge')
    expect(decidePolicy({ riskScore: 70 }, bankSecure).action).toBe(
      'temporary_ban',
    )
  })

  it('85: متساهلة challenge / صارمة permanent_ban', () => {
    expect(decidePolicy({ riskScore: 85 }, shopAcme).action).toBe('challenge')
    expect(decidePolicy({ riskScore: 85 }, bankSecure).action).toBe(
      'permanent_ban',
    )
  })

  it('30: متساهلة allow / صارمة challenge', () => {
    expect(decidePolicy({ riskScore: 30 }, shopAcme).action).toBe('allow')
    expect(decidePolicy({ riskScore: 30 }, bankSecure).action).toBe('challenge')
  })

  it('10: الكل allow', () => {
    for (const p of [shopAcme, bankSecure, saasMid, orgAFromBackend]) {
      expect(decidePolicy({ riskScore: 10 }, p).action).toBe('allow')
    }
  })

  it('جدول شركات × درجات (سلوك إنتاج)', () => {
    const table: Array<[string, CompanyPolicy, number, string]> = [
      ['shop', shopAcme, 55, 'allow'],
      ['shop', shopAcme, 65, 'challenge'],
      ['shop', shopAcme, 92, 'temporary_ban'],
      ['bank', bankSecure, 15, 'allow'],
      ['bank', bankSecure, 25, 'challenge'],
      ['bank', bankSecure, 55, 'temporary_ban'],
      ['bank', bankSecure, 80, 'permanent_ban'],
      ['saas', saasMid, 34, 'allow'],
      ['saas', saasMid, 35, 'challenge'],
      ['saas', saasMid, 75, 'temporary_ban'],
      ['orgA', orgAFromBackend, 40, 'challenge'],
      ['orgA', orgAFromBackend, 70, 'temporary_ban'],
      ['orgA', orgAFromBackend, 90, 'permanent_ban'],
    ]
    for (const [, policy, score, action] of table) {
      expect(decidePolicy({ riskScore: score }, policy).action).toBe(action)
    }
  })
})

// ------------------------------------------------------------------
// DEFAULT — حدود التصميم
// ------------------------------------------------------------------

describe('policy.engine — حدود DEFAULT_POLICY', () => {
  const p = { ...DEFAULT_POLICY }

  it.each([
    [0, 'allow'],
    [30, 'allow'],
    [31, 'challenge'],
    [80, 'challenge'],
    [81, 'temporary_ban'],
    [94, 'temporary_ban'],
    [95, 'permanent_ban'],
    [100, 'permanent_ban'],
  ] as const)('درجة %i → %s', (riskScore, expected) => {
    expect(decidePolicy({ riskScore }, p).action).toBe(expected)
  })
})

// ------------------------------------------------------------------
// حظر مؤقت / دائم
// ------------------------------------------------------------------

describe('policy.engine — أنواع الحظر', () => {
  it('مؤقت يحمل banMinutes من سياسة الشركة', () => {
    const d = decidePolicy({ riskScore: 55 }, bankSecure)
    expect(d).toEqual({
      action: 'temporary_ban',
      reason: 'temporary_ban_score',
      banMinutes: 120,
    })
  })

  it('مدة الحظر تختلف بين الشركات', () => {
    expect(decidePolicy({ riskScore: 95 }, shopAcme).banMinutes).toBe(5)
    expect(decidePolicy({ riskScore: 55 }, bankSecure).banMinutes).toBe(120)
    expect(decidePolicy({ riskScore: 80 }, saasMid).banMinutes).toBe(30)
  })

  it('دائم بدون banMinutes', () => {
    const d = decidePolicy({ riskScore: 99 }, bankSecure)
    expect(d.action).toBe('permanent_ban')
    expect(d.banMinutes).toBeUndefined()
  })

  it('الدائم له أولوية على fails و max requests', () => {
    const d = decidePolicy(
      { riskScore: 100, failedChallenges: 50, maxRequestsExceeded: true },
      bankSecure,
    )
    expect(d.action).toBe('permanent_ban')
  })
})

// ------------------------------------------------------------------
// فشل Challenge / max requests
// ------------------------------------------------------------------

describe('policy.engine — فشل Challenge متكرر', () => {
  it('عند الحد بالضبط → temporary_ban رغم score=0', () => {
    expect(
      decidePolicy({ riskScore: 0, failedChallenges: 2 }, bankSecure),
    ).toEqual({
      action: 'temporary_ban',
      reason: 'auto_ban_after_fails',
      banMinutes: 120,
    })
  })

  it('فوق الحد → حظر', () => {
    expect(
      decidePolicy({ riskScore: 0, failedChallenges: 9 }, bankSecure).action,
    ).toBe('temporary_ban')
  })

  it('تحت الحد → لا حظر من fails', () => {
    expect(
      decidePolicy({ riskScore: 0, failedChallenges: 1 }, bankSecure).action,
    ).toBe('allow')
  })

  it('autoBanAfterFails=0 يعطّل', () => {
    const off = { ...bankSecure, autoBanAfterFails: 0 }
    expect(
      decidePolicy({ riskScore: 0, failedChallenges: 1000 }, off).action,
    ).toBe('allow')
  })
})

describe('policy.engine — تجاوز الطلبات', () => {
  it('banOnMaxRequests true → حظر', () => {
    expect(
      decidePolicy({ riskScore: 10, maxRequestsExceeded: true }, bankSecure),
    ).toEqual({
      action: 'temporary_ban',
      reason: 'max_requests_ban',
      banMinutes: 120,
    })
  })

  it('banOnMaxRequests false → rate_limit', () => {
    expect(
      decidePolicy({ riskScore: 10, maxRequestsExceeded: true }, shopAcme),
    ).toEqual({
      action: 'rate_limit',
      reason: 'max_requests_rate_limit',
    })
  })

  it('شركتان مختلفتان → قراران مختلفان', () => {
    const ctx = { riskScore: 10, maxRequestsExceeded: true }
    expect(decidePolicy(ctx, bankSecure).action).not.toBe(
      decidePolicy(ctx, shopAcme).action,
    )
  })
})

// ------------------------------------------------------------------
// Fallback (فشل جلب الباك)
// ------------------------------------------------------------------

describe('policy.engine — تعذر جلب السياسة', () => {
  it.each([null, undefined])('%s → DEFAULT', (missing) => {
    const r = resolvePolicy(missing)
    expect(r.policy).toEqual(DEFAULT_POLICY)
    expect(r.usedFallback).toBe(true)
    expect(decidePolicy({ riskScore: 50 }, missing).action).toBe('challenge')
    expect(decidePolicy({ riskScore: 90 }, missing).action).toBe(
      'temporary_ban',
    )
    expect(decidePolicy({ riskScore: 100 }, missing).action).toBe(
      'permanent_ban',
    )
  })

  it('نص بدل object → افتراضي', () => {
    const r = resolvePolicy('oops' as unknown as Partial<CompanyPolicy>)
    expect(r.usedFallback).toBe(true)
    expect(r.policy).toEqual(DEFAULT_POLICY)
  })

  it('سياسة كاملة صالحة → usedFallback false', () => {
    const r = resolvePolicy(bankSecure)
    expect(r.usedFallback).toBe(false)
    expect(r.policy).toEqual(bankSecure)
  })

  it('ناقصة: الحقل الصالح يبقى', () => {
    const r = resolvePolicy({ temporaryBanMinutes: 7 })
    expect(r.policy.temporaryBanMinutes).toBe(7)
    expect(r.policy.permanentBanScore).toBe(DEFAULT_POLICY.permanentBanScore)
    expect(r.usedFallback).toBe(true)
  })

  it('قيم تالفة تُستبدل', () => {
    const r = resolvePolicy({
      ...bankSecure,
      temporaryBanMinutes: -5,
      autoBanAfterFails: 1.5,
      permanentBanScore: 500,
      banOnMaxRequests: 'yes' as unknown as boolean,
    })
    expect(r.policy.temporaryBanMinutes).toBe(
      DEFAULT_POLICY.temporaryBanMinutes,
    )
    expect(r.usedFallback).toBe(true)
  })

  it('حدود غير متدرجة → إعادة الحدود الثلاثة للافتراضي', () => {
    const r = resolvePolicy({
      ...bankSecure,
      challengeScore: 90,
      temporaryBanScore: 40,
      permanentBanScore: 70,
    })
    expect(r.policy.challengeScore).toBe(DEFAULT_POLICY.challengeScore)
    expect(r.usedFallback).toBe(true)
  })

  it('تعديل نسخة resolve لا يلمس DEFAULT', () => {
    const r = resolvePolicy(null)
    r.policy.temporaryBanMinutes = 9999
    expect(DEFAULT_POLICY.temporaryBanMinutes).toBe(15)
  })

  it('DEFAULT مجمّد', () => {
    expect(Object.isFrozen(DEFAULT_POLICY)).toBe(true)
  })
})

// ------------------------------------------------------------------
// resolveBan + شاذ
// ------------------------------------------------------------------

describe('policy.engine — resolveBan', () => {
  it('تحت permanent → مؤقت', () => {
    expect(resolveBan(70, bankSecure)).toEqual({
      action: 'temporary_ban',
      reason: 'temporary_ban_score',
      banMinutes: 120,
    })
  })

  it('عند/فوق permanent → دائم', () => {
    expect(resolveBan(80, bankSecure).action).toBe('permanent_ban')
    expect(resolveBan(85, bankSecure).action).toBe('permanent_ban')
  })

  it('بدون سياسة → DEFAULT minutes', () => {
    expect(resolveBan(90, null).banMinutes).toBe(
      DEFAULT_POLICY.temporaryBanMinutes,
    )
  })
})

describe('policy.engine — مدخلات شاذة', () => {
  it('NaN / Infinity → challenge (مش allow ولا permanent)', () => {
    expect(decidePolicy({ riskScore: NaN }, bankSecure).action).toBe(
      'challenge',
    )
    expect(decidePolicy({ riskScore: Infinity }, bankSecure).action).toBe(
      'challenge',
    )
  })
})

// ------------------------------------------------------------------
// شبكة كثيفة: شركات × درجات
// ------------------------------------------------------------------

describe('policy.engine — شبكة شركات × scores', () => {
  it('اتساق: score↑ لا يخفف الإجراء لنفس السياسة', () => {
    const policies = [shopAcme, bankSecure, saasMid, orgAFromBackend]
    const rank: Record<string, number> = {
      allow: 0,
      challenge: 1,
      rate_limit: 2,
      temporary_ban: 3,
      permanent_ban: 4,
    }
    for (const p of policies) {
      let prev = -1
      for (let s = 0; s <= 100; s += 5) {
        const a = decidePolicy({ riskScore: s }, p).action
        const r = rank[a] ?? 0
        expect(r).toBeGreaterThanOrEqual(prev)
        prev = r
      }
    }
  })
})