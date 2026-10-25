import { describe, it, expect } from 'vitest';
import {
  calculateRisk,
  RISK_WEIGHTS,
  MAX_RISK_SCORE,
  type RiskSignals,
  type RiskSignalName,
  type RiskResult,
} from './risk.engine';

/** إشارات نظيفة كنقطة بداية؛ كل اختبار يغيّر ما يحتاجه فقط. */
const clean = (): RiskSignals => ({
  badIp: false,
  highRequestRate: false,
  aiAnomalyScore: 0,
  suspiciousFingerprint: false,
  priorHistory: false,
});

/** كل الإشارات في أقصى حالاتها. */
const all = (): RiskSignals => ({
  badIp: true,
  highRequestRate: true,
  aiAnomalyScore: 1,
  suspiciousFingerprint: true,
  priorHistory: true,
});

/** مجموع نقاط المكونات (للمقارنة مع الدرجة النهائية). */
const sumOf = (r: RiskResult): number => r.components.reduce((s, c) => s + c.contribution, 0);

describe('risk.engine - الأوزان', () => {
  it('الأوزان مطابقة للتصميم', () => {
    expect(RISK_WEIGHTS).toEqual({
      badIp: 15,
      highRequestRate: 25,
      aiAnomaly: 30,
      suspiciousFingerprint: 10,
      priorHistory: 20,
    });
  });

  it('مجموع الأوزان = 100 تماماً', () => {
    const total = Object.values(RISK_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(MAX_RISK_SCORE);
  });
});

describe('risk.engine - إشارات نظيفة', () => {
  it('الدرجة 0 ولا يوجد مكوّن مفعّل', () => {
    const r = calculateRisk(clean());
    expect(r.score).toBe(0);
    expect(r.components.every((c) => !c.triggered && c.contribution === 0)).toBe(true);
  });

  it('المكونات الخمسة تُرجع دائماً بنفس الترتيب', () => {
    const r = calculateRisk(clean());
    expect(r.components.map((c) => c.signal)).toEqual([
      'badIp',
      'highRequestRate',
      'aiAnomaly',
      'suspiciousFingerprint',
      'priorHistory',
    ]);
  });

  it('كل مكوّن يحمل وزنه الصحيح حتى لو لم يُفعَّل', () => {
    const r = calculateRisk(clean());
    for (const c of r.components) {
      expect(c.weight).toBe(RISK_WEIGHTS[c.signal]);
    }
  });
});

describe('risk.engine - كل إشارة بمفردها', () => {
  const cases: Array<[RiskSignalName, Partial<RiskSignals>, number]> = [
    ['badIp', { badIp: true }, 15],
    ['highRequestRate', { highRequestRate: true }, 25],
    ['aiAnomaly', { aiAnomalyScore: 1 }, 30],
    ['suspiciousFingerprint', { suspiciousFingerprint: true }, 10],
    ['priorHistory', { priorHistory: true }, 20],
  ];

  it.each(cases)('%s وحدها تعطي %i نقطة فقط', (signal, override, expected) => {
    const r = calculateRisk({ ...clean(), ...override });
    expect(r.score).toBe(expected);

    // المكوّن المقصود مفعّل بوزنه الكامل، وكل ما عداه صفر.
    for (const c of r.components) {
      if (c.signal === signal) {
        expect(c.contribution).toBe(expected);
        expect(c.triggered).toBe(true);
      } else {
        expect(c.contribution).toBe(0);
        expect(c.triggered).toBe(false);
      }
    }
  });
});

describe('risk.engine - كل الإشارات مجتمعة', () => {
  it('الدرجة 100 بالضبط', () => {
    expect(calculateRisk(all()).score).toBe(100);
  });

  it('كل مكوّن يساهم بوزنه الكامل', () => {
    const r = calculateRisk(all());
    for (const c of r.components) {
      expect(c.contribution).toBe(c.weight);
      expect(c.triggered).toBe(true);
    }
  });

  it('مجموعة جزئية: IP سيئ + معدل مرتفع = 40', () => {
    const r = calculateRisk({ ...clean(), badIp: true, highRequestRate: true });
    expect(r.score).toBe(40);
  });

  it('مجموعة جزئية: AI + سجل سابق + بصمة = 60', () => {
    const r = calculateRisk({
      ...clean(),
      aiAnomalyScore: 1,
      priorHistory: true,
      suspiciousFingerprint: true,
    });
    expect(r.score).toBe(60);
  });
});

describe('risk.engine - شذوذ الـ AI المتدرج', () => {
  it('0.5 تعطي 15', () => {
    expect(calculateRisk({ ...clean(), aiAnomalyScore: 0.5 }).score).toBe(15);
  });

  it('التقريب لأقرب عدد صحيح (0.33 -> 10)', () => {
    const r = calculateRisk({ ...clean(), aiAnomalyScore: 0.33 });
    expect(r.score).toBe(10);
    expect(Number.isInteger(r.score)).toBe(true);
  });

  it('قيمة صغيرة جداً (0.01) تُقرَّب إلى 0 ولا تُعتبر مفعّلة', () => {
    const r = calculateRisk({ ...clean(), aiAnomalyScore: 0.01 });
    expect(r.score).toBe(0);
    expect(r.components.find((c) => c.signal === 'aiAnomaly')?.triggered).toBe(false);
  });

  it('قيمة أكبر من 1 تُقصّ إلى 1 (30 نقطة فقط)', () => {
    expect(calculateRisk({ ...clean(), aiAnomalyScore: 7 }).score).toBe(30);
  });

  it('قيمة سالبة تُقصّ إلى 0', () => {
    expect(calculateRisk({ ...clean(), aiAnomalyScore: -3 }).score).toBe(0);
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'القيمة غير الصالحة (%s) تُحسب 0 ولا تكسر الحساب',
    (bad) => {
      const r = calculateRisk({ ...clean(), aiAnomalyScore: bad as number | null | undefined });
      expect(r.score).toBe(0);
    },
  );

  it('غياب aiAnomalyScore تماماً (الـ AI متعطل) لا يمنع باقي الإشارات', () => {
    const signals = { ...clean(), badIp: true };
    delete signals.aiAnomalyScore;
    expect(calculateRisk(signals).score).toBe(15);
  });
});

describe('risk.engine - سلامة النتيجة', () => {
  it('لا تتجاوز 100 حتى مع مدخلات مبالغ فيها', () => {
    const r = calculateRisk({ ...all(), aiAnomalyScore: 9999 });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBe(100);
  });

  it('مجموع contribution = score لكل 96 توليفة (16 للإشارات الثنائية × 6 مستويات AI)', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (const ai of [0, 0.1, 0.37, 0.5, 0.99, 1]) {
        const r = calculateRisk({
          badIp: !!(mask & 1),
          highRequestRate: !!(mask & 2),
          suspiciousFingerprint: !!(mask & 4),
          priorHistory: !!(mask & 8),
          aiAnomalyScore: ai,
        });
        expect(sumOf(r)).toBe(r.score);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        expect(Number.isInteger(r.score)).toBe(true);
      }
    }
  });

  it('كل contribution بين 0 ووزن إشارته دائماً', () => {
    for (const ai of [0, 0.2, 0.5, 0.8, 1, 5, -5]) {
      const r = calculateRisk({ ...all(), aiAnomalyScore: ai });
      for (const c of r.components) {
        expect(c.contribution).toBeGreaterThanOrEqual(0);
        expect(c.contribution).toBeLessThanOrEqual(c.weight);
      }
    }
  });

  it('triggered تتطابق دائماً مع contribution > 0', () => {
    const r = calculateRisk({ ...clean(), badIp: true, aiAnomalyScore: 0.5 });
    for (const c of r.components) {
      expect(c.triggered).toBe(c.contribution > 0);
    }
  });

  it('لا يعدّل الكائن المُدخل (دالة نقية)', () => {
    const input = all();
    const snapshot = JSON.stringify(input);
    calculateRisk(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('نفس المدخلات تعطي نفس النتيجة في كل مرة', () => {
    expect(calculateRisk(all())).toEqual(calculateRisk(all()));
  });
});
