/**
 * core/risk.engine.test.ts
 * ==================================================================
 * اختبارات شاملة لـ risk.engine
 * - بيئة "تطوير": AI فاضي / null / متعطل
 * - بيئة "حقيقية": توليفات إشارات كاملة + قيم AI متدرجة
 * - حدود، تقريب، نقاء الدالة، عدم تجاوز 100
 * ==================================================================
 */

import { describe, it, expect } from 'vitest'
import {
  calculateRisk,
  RISK_WEIGHTS,
  MAX_RISK_SCORE,
  type RiskSignals,
  type RiskSignalName,
  type RiskResult,
} from './risk.engine'

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

const clean = (): RiskSignals => ({
  badIp: false,
  highRequestRate: false,
  aiAnomalyScore: 0,
  suspiciousFingerprint: false,
  priorHistory: false,
})

const allMax = (): RiskSignals => ({
  badIp: true,
  highRequestRate: true,
  aiAnomalyScore: 1,
  suspiciousFingerprint: true,
  priorHistory: true,
})

const sumOf = (r: RiskResult): number =>
  r.components.reduce((s, c) => s + c.contribution, 0)

const bySignal = (r: RiskResult, name: RiskSignalName) =>
  r.components.find((c) => c.signal === name)!

/** محاكاة سياق تطوير: غالبًا من غير AI ومن غير سجل */
const devVisitor = (partial: Partial<RiskSignals> = {}): RiskSignals => ({
  ...clean(),
  aiAnomalyScore: null,
  ...partial,
})

/** محاكاة زائر حقيقي بعد مرور الإشارات من الطبقات */
const prodVisitor = (partial: Partial<RiskSignals>): RiskSignals => ({
  ...clean(),
  ...partial,
})

// ------------------------------------------------------------------
// الأوزان
// ------------------------------------------------------------------

describe('risk.engine — الأوزان', () => {
  it('مطابقة للتصميم (دوسيه Zero Plus)', () => {
    expect(RISK_WEIGHTS).toEqual({
      badIp: 15,
      highRequestRate: 25,
      aiAnomaly: 30,
      suspiciousFingerprint: 10,
      priorHistory: 20,
    })
  })

  it('مجموع الأوزان = 100', () => {
    const total = Object.values(RISK_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBe(MAX_RISK_SCORE)
    expect(total).toBe(100)
  })

  it('MAX_RISK_SCORE = 100', () => {
    expect(MAX_RISK_SCORE).toBe(100)
  })
})

// ------------------------------------------------------------------
// نظيف / ترتيب المكونات
// ------------------------------------------------------------------

describe('risk.engine — إشارات نظيفة', () => {
  it('درجة 0 ولا مكوّن مفعّل', () => {
    const r = calculateRisk(clean())
    expect(r.score).toBe(0)
    expect(r.components.every((c) => !c.triggered && c.contribution === 0)).toBe(
      true,
    )
  })

  it('خمسة مكونات بنفس الترتيب دائمًا', () => {
    const r = calculateRisk(clean())
    expect(r.components).toHaveLength(5)
    expect(r.components.map((c) => c.signal)).toEqual([
      'badIp',
      'highRequestRate',
      'aiAnomaly',
      'suspiciousFingerprint',
      'priorHistory',
    ])
  })

  it('كل مكوّن يحمل وزنه حتى لو غير مفعّل', () => {
    const r = calculateRisk(clean())
    for (const c of r.components) {
      expect(c.weight).toBe(RISK_WEIGHTS[c.signal])
    }
  })

  it('sum(components) === score', () => {
    const r = calculateRisk(clean())
    expect(sumOf(r)).toBe(r.score)
  })
})

// ------------------------------------------------------------------
// كل إشارة لوحدها
// ------------------------------------------------------------------

describe('risk.engine — كل إشارة بمفردها', () => {
  const cases: Array<[RiskSignalName, Partial<RiskSignals>, number]> = [
    ['badIp', { badIp: true }, 15],
    ['highRequestRate', { highRequestRate: true }, 25],
    ['aiAnomaly', { aiAnomalyScore: 1 }, 30],
    ['suspiciousFingerprint', { suspiciousFingerprint: true }, 10],
    ['priorHistory', { priorHistory: true }, 20],
  ]

  it.each(cases)(
    '%s وحدها → %i نقطة والمكوّنات الأخرى صفر',
    (signal, override, expected) => {
      const r = calculateRisk({ ...clean(), ...override })
      expect(r.score).toBe(expected)
      for (const c of r.components) {
        if (c.signal === signal) {
          expect(c.contribution).toBe(expected)
          expect(c.triggered).toBe(true)
        } else {
          expect(c.contribution).toBe(0)
          expect(c.triggered).toBe(false)
        }
      }
    },
  )
})

// ------------------------------------------------------------------
// تجميعات
// ------------------------------------------------------------------

describe('risk.engine — تجميعات جزئية وكاملة', () => {
  it('كل الإشارات → 100', () => {
    expect(calculateRisk(allMax()).score).toBe(100)
  })

  it('كل مكوّن = وزنه الكامل عند allMax', () => {
    const r = calculateRisk(allMax())
    for (const c of r.components) {
      expect(c.contribution).toBe(c.weight)
      expect(c.triggered).toBe(true)
    }
  })

  it('IP + معدل = 40', () => {
    expect(
      calculateRisk({ ...clean(), badIp: true, highRequestRate: true }).score,
    ).toBe(40)
  })

  it('AI كامل + سجل + بصمة = 60', () => {
    expect(
      calculateRisk({
        ...clean(),
        aiAnomalyScore: 1,
        priorHistory: true,
        suspiciousFingerprint: true,
      }).score,
    ).toBe(60)
  })

  it('معدل + سجل = 45', () => {
    expect(
      calculateRisk({
        ...clean(),
        highRequestRate: true,
        priorHistory: true,
      }).score,
    ).toBe(45)
  })

  it('IP + بصمة + سجل = 45', () => {
    expect(
      calculateRisk({
        ...clean(),
        badIp: true,
        suspiciousFingerprint: true,
        priorHistory: true,
      }).score,
    ).toBe(45)
  })

  it('أربع إشارات بدون AI = 70', () => {
    expect(
      calculateRisk({
        badIp: true,
        highRequestRate: true,
        aiAnomalyScore: 0,
        suspiciousFingerprint: true,
        priorHistory: true,
      }).score,
    ).toBe(70)
  })
})

// ------------------------------------------------------------------
// AI متدرج + بيانات تالفة
// ------------------------------------------------------------------

describe('risk.engine — AI متدرج وحدود', () => {
  it('0.5 → 15', () => {
    expect(calculateRisk({ ...clean(), aiAnomalyScore: 0.5 }).score).toBe(15)
  })

  it('0.33 → 10 (تقريب)', () => {
    const r = calculateRisk({ ...clean(), aiAnomalyScore: 0.33 })
    expect(r.score).toBe(10)
    expect(Number.isInteger(r.score)).toBe(true)
  })

  it('0.01 → 0 وغير مفعّل', () => {
    const r = calculateRisk({ ...clean(), aiAnomalyScore: 0.01 })
    expect(r.score).toBe(0)
    expect(bySignal(r, 'aiAnomaly').triggered).toBe(false)
  })

  it('> 1 يُقصّ → 30 فقط', () => {
    expect(calculateRisk({ ...clean(), aiAnomalyScore: 7 }).score).toBe(30)
    expect(calculateRisk({ ...clean(), aiAnomalyScore: 1.0001 }).score).toBe(30)
  })

  it('سالب → 0', () => {
    expect(calculateRisk({ ...clean(), aiAnomalyScore: -3 }).score).toBe(0)
  })

  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'قيمة غير صالحة (%s) → 0 ولا تكسر',
    (bad) => {
      const r = calculateRisk({
        ...clean(),
        aiAnomalyScore: bad as number | null | undefined,
      })
      expect(r.score).toBe(0)
      expect(sumOf(r)).toBe(0)
    },
  )

  it('حذف aiAnomalyScore (AI متعطل) لا يمنع باقي الإشارات', () => {
    const signals: RiskSignals = { ...clean(), badIp: true }
    delete signals.aiAnomalyScore
    expect(calculateRisk(signals).score).toBe(15)
  })

  it.each([
    [0, 0],
    [0.1, 3],
    [0.2, 6],
    [0.25, 8],
    [0.4, 12],
    [0.6, 18],
    [0.75, 23],
    [0.9, 27],
    [1, 30],
  ] as const)('ai=%f → contribution تقريبًا %i', (ai, expected) => {
    const r = calculateRisk({ ...clean(), aiAnomalyScore: ai })
    expect(bySignal(r, 'aiAnomaly').contribution).toBe(expected)
    expect(r.score).toBe(expected)
  })
})

// ------------------------------------------------------------------
// محاكاة تطوير vs إنتاج (سيناريوهات)
// ------------------------------------------------------------------

describe('risk.engine — سيناريوهات تطوير', () => {
  it('زائر عادي محلي: كل شيء فاضي → 0 (ALLOW لاحقًا)', () => {
    const r = calculateRisk(devVisitor())
    expect(r.score).toBe(0)
  })

  it('تطوير + rate فقط (اختبار load) → 25', () => {
    const r = calculateRisk(devVisitor({ highRequestRate: true }))
    expect(r.score).toBe(25)
  })

  it('تطوير + AI null + IP سيئ → 15 فقط', () => {
    const r = calculateRisk(
      devVisitor({ badIp: true, aiAnomalyScore: null }),
    )
    expect(r.score).toBe(15)
    expect(bySignal(r, 'aiAnomaly').contribution).toBe(0)
  })
})

describe('risk.engine — سيناريوهات إنتاج / دوسيه', () => {
  /** 0–30 ALLOW تقريبًا */
  it('زائر نظيف أو إشارة خفيفة → score ≤ 30', () => {
    expect(calculateRisk(prodVisitor({})).score).toBeLessThanOrEqual(30)
    expect(
      calculateRisk(prodVisitor({ suspiciousFingerprint: true })).score,
    ).toBe(10)
    expect(calculateRisk(prodVisitor({ badIp: true })).score).toBe(15)
  })

  /** 31–60 RATE / MONITOR */
  it('معدل + IP → 40 (نطاق متوسط)', () => {
    const score = calculateRisk(
      prodVisitor({ badIp: true, highRequestRate: true }),
    ).score
    expect(score).toBe(40)
    expect(score).toBeGreaterThan(30)
    expect(score).toBeLessThanOrEqual(60)
  })

  /** 61–80 CHALLENGE */
  it('AI قوي + معدل → 55… مع سجل يدخل نطاق أعلى', () => {
    const mid = calculateRisk(
      prodVisitor({
        highRequestRate: true,
        aiAnomalyScore: 0.9, // 27
      }),
    ).score
    expect(mid).toBe(25 + 27) // 52

    const challengeBand = calculateRisk(
      prodVisitor({
        highRequestRate: true,
        aiAnomalyScore: 1,
        priorHistory: true,
      }),
    ).score
    expect(challengeBand).toBe(25 + 30 + 20) // 75
    expect(challengeBand).toBeGreaterThan(60)
    expect(challengeBand).toBeLessThanOrEqual(80)
  })

  /** 81–100 BLOCK */
  it('هجوم واضح: كل الإشارات → 100', () => {
    const score = calculateRisk(allMax()).score
    expect(score).toBe(100)
    expect(score).toBeGreaterThan(80)
  })

  it('من غير AI لكن باقي الإشارات → 70 (لسه عالي، مش 100)', () => {
    expect(
      calculateRisk(
        prodVisitor({
          badIp: true,
          highRequestRate: true,
          suspiciousFingerprint: true,
          priorHistory: true,
          aiAnomalyScore: null,
        }),
      ).score,
    ).toBe(70)
  })

  it('botnet-like: rate + AI + history → 75', () => {
    expect(
      calculateRisk(
        prodVisitor({
          highRequestRate: true,
          aiAnomalyScore: 1,
          priorHistory: true,
        }),
      ).score,
    ).toBe(75)
  })
})

// ------------------------------------------------------------------
// سلامة + نقاء + شبكة توليفات
// ------------------------------------------------------------------

describe('risk.engine — سلامة النتيجة', () => {
  it('لا تتجاوز 100 مع AI مبالغ', () => {
    const r = calculateRisk({ ...allMax(), aiAnomalyScore: 9999 })
    expect(r.score).toBe(100)
  })

  it('96 توليفة: sum === score و 0..100 صحيح', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (const ai of [0, 0.1, 0.37, 0.5, 0.99, 1]) {
        const r = calculateRisk({
          badIp: !!(mask & 1),
          highRequestRate: !!(mask & 2),
          suspiciousFingerprint: !!(mask & 4),
          priorHistory: !!(mask & 8),
          aiAnomalyScore: ai,
        })
        expect(sumOf(r)).toBe(r.score)
        expect(r.score).toBeGreaterThanOrEqual(0)
        expect(r.score).toBeLessThanOrEqual(100)
        expect(Number.isInteger(r.score)).toBe(true)
        expect(r.components).toHaveLength(5)
      }
    }
  })

  it('كل contribution بين 0 و weight', () => {
    for (const ai of [0, 0.2, 0.5, 0.8, 1, 5, -5, null, undefined]) {
      const r = calculateRisk({
        ...allMax(),
        aiAnomalyScore: ai as number | null | undefined,
      })
      for (const c of r.components) {
        expect(c.contribution).toBeGreaterThanOrEqual(0)
        expect(c.contribution).toBeLessThanOrEqual(c.weight)
      }
    }
  })

  it('triggered ⇔ contribution > 0', () => {
    const r = calculateRisk({
      ...clean(),
      badIp: true,
      aiAnomalyScore: 0.5,
    })
    for (const c of r.components) {
      expect(c.triggered).toBe(c.contribution > 0)
    }
  })

  it('لا يعدّل المدخل (pure)', () => {
    const input = allMax()
    const snapshot = JSON.stringify(input)
    calculateRisk(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('حتمي: نفس المدخل = نفس الناتج', () => {
    expect(calculateRisk(allMax())).toEqual(calculateRisk(allMax()))
    const a = prodVisitor({
      badIp: true,
      aiAnomalyScore: 0.42,
      priorHistory: true,
    })
    expect(calculateRisk(a)).toEqual(calculateRisk({ ...a }))
  })
})

// ------------------------------------------------------------------
// شبكة عشوائية كثيفة (كأن بيئة حقيقية متغيرة)
// ------------------------------------------------------------------

describe('risk.engine — شبكة حالات كثيفة', () => {
  it('أكثر من 500 حالة: حدود + اتساق المكونات', () => {
    const aiLevels = [
      null,
      undefined,
      0,
      0.01,
      0.15,
      0.33,
      0.5,
      0.66,
      0.85,
      1,
      1.5,
      -0.2,
      NaN,
    ]
    let count = 0
    for (let mask = 0; mask < 16; mask++) {
      for (const ai of aiLevels) {
        const r = calculateRisk({
          badIp: !!(mask & 1),
          highRequestRate: !!(mask & 2),
          suspiciousFingerprint: !!(mask & 4),
          priorHistory: !!(mask & 8),
          aiAnomalyScore: ai as number | null | undefined,
        })
        expect(r.score).toBeGreaterThanOrEqual(0)
        expect(r.score).toBeLessThanOrEqual(100)
        expect(sumOf(r)).toBe(r.score)
        expect(r.components.map((c) => c.signal)).toEqual([
          'badIp',
          'highRequestRate',
          'aiAnomaly',
          'suspiciousFingerprint',
          'priorHistory',
        ])
        count++
      }
    }
    expect(count).toBe(16 * aiLevels.length)
  })
})