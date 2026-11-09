// frontend/src/pages/policies/form.ts — بيانات الحقول + Validation + بناء الـ Patch (منطق صرف)

import i18n from '../../i18n'
import { type PolicyValues } from '../../services/policiesService'

// ==================================================================
// Field metadata (مطابقة لحدود policies.schema.ts)
// ==================================================================

export type NumKey = {
  [K in keyof PolicyValues]: PolicyValues[K] extends number | null ? K : never
}[keyof PolicyValues]

export type BoolKey = {
  [K in keyof PolicyValues]: PolicyValues[K] extends boolean ? K : never
}[keyof PolicyValues]

export interface NumMeta {
  label: string
  hint: string
  min: number
  max: number
  unit?: string
  /** maxServerRps: الفاضي معناه null (السعة بتتحدد تلقائيًا) */
  nullable?: boolean
}

function field(key: NumKey, min: number, max: number, unitKey?: string, nullable = false): NumMeta {
  return {
    get label() {
      return i18n.t(`fields.${key}.label`, { ns: 'policies', defaultValue: key })
    },
    get hint() {
      return i18n.t(`fields.${key}.hint`, { ns: 'policies', defaultValue: '' })
    },
    min,
    max,
    get unit() {
      return unitKey ? i18n.t(`units.${unitKey}`, { ns: 'policies', defaultValue: unitKey }) : undefined
    },
    nullable,
  }
}

export const NUM_META: Record<NumKey, NumMeta> = {
  allowMaxScore: field('allowMaxScore', 0, 99, 'pts'),
  rateLimitMaxScore: field('rateLimitMaxScore', 0, 99, 'pts'),
  challengeMaxScore: field('challengeMaxScore', 0, 99, 'pts'),
  passTokenTtlMinutes: field('passTokenTtlMinutes', 1, 1440, 'min'),
  rateLimitRequests: field('rateLimitRequests', 1, 100_000, 'req'),
  rateLimitWindowSec: field('rateLimitWindowSec', 1, 3600, 'sec'),
  maxRequestsPerIp: field('maxRequestsPerIp', 1, 1_000_000, 'req'),
  maxRequestsWindowSec: field('maxRequestsWindowSec', 1, 3600, 'sec'),
  maxServerRps: field('maxServerRps', 1, 1_000_000, 'rps', true),
  capacityWarnPercent: field('capacityWarnPercent', 1, 100, 'percent'),
  autoBanAfterFails: field('autoBanAfterFails', 1, 20, 'fails'),
  temporaryBanMinutes: field('temporaryBanMinutes', 1, 10_080, 'min'),
  permanentBanScore: field('permanentBanScore', 1, 10, 'score'),
}

// ==================================================================
// Draft (الفورم): الأرقام نصوص، الـ booleans زي ما هي
// ==================================================================

export type Draft = { [K in NumKey]: string } & { [K in BoolKey]: boolean }

export const NUM_KEYS = Object.keys(NUM_META) as NumKey[]
export const BOOL_KEYS: BoolKey[] = [
  'enableJsChallenge',
  'challengeAllVisitors',
  'banOnMaxRequests',
  'enableAiAnomaly',
]

export function toDraft(values: PolicyValues): Draft {
  const draft = {} as Record<string, string | boolean>
  for (const k of NUM_KEYS) draft[k] = values[k] === null ? '' : String(values[k])
  for (const k of BOOL_KEYS) draft[k] = values[k]
  return draft as Draft
}

/** بيحوّل رقم من نص: بيرجع undefined لو مش رقم صحيح */
export function parseInt10(text: string): number | undefined {
  const t = text.trim()
  return /^-?\d+$/.test(t) ? Number(t) : undefined
}

/** Validation: نفس قواعد الباك (حدود كل حقل + قواعد الترابط) */
export function validate(
  draft: Draft,
  t?: (key: string, opts?: Record<string, unknown>) => string,
): Partial<Record<NumKey, string>> {
  const translate: (key: string, opts?: Record<string, unknown>) => string =
    t ||
    ((key: string, opts?: Record<string, unknown>): string =>
      String(i18n.t(key as never, { ns: 'policies', ...opts } as never)))
  const errors: Partial<Record<NumKey, string>> = {}

  for (const key of NUM_KEYS) {
    const meta = NUM_META[key]
    const text = draft[key]
    if (meta.nullable && text.trim() === '') continue
    const n = parseInt10(text)
    if (n === undefined || n < meta.min || n > meta.max) {
      errors[key] = translate('validation.between', {
        min: meta.min.toLocaleString(i18n.language.startsWith('ar') ? 'ar-EG' : 'en-US'),
        max: meta.max.toLocaleString(i18n.language.startsWith('ar') ? 'ar-EG' : 'en-US'),
      })
    }
  }

  const allow = parseInt10(draft.allowMaxScore)
  const rate = parseInt10(draft.rateLimitMaxScore)
  const challenge = parseInt10(draft.challengeMaxScore)

  if (!errors.allowMaxScore && !errors.rateLimitMaxScore && allow! > rate!) {
    errors.allowMaxScore = translate('validation.allowLeRate')
  }
  if (!errors.rateLimitMaxScore && !errors.challengeMaxScore && rate! > challenge!) {
    errors.rateLimitMaxScore = translate('validation.rateLeChallenge')
  }

  const softReq = parseInt10(draft.rateLimitRequests)
  const softWin = parseInt10(draft.rateLimitWindowSec)
  const hardReq = parseInt10(draft.maxRequestsPerIp)
  const hardWin = parseInt10(draft.maxRequestsWindowSec)
  if (
    !errors.rateLimitRequests &&
    !errors.rateLimitWindowSec &&
    !errors.maxRequestsPerIp &&
    !errors.maxRequestsWindowSec &&
    hardReq! / hardWin! < softReq! / softWin!
  ) {
    errors.maxRequestsPerIp = translate('validation.hardGeSoft')
  }

  return errors
}

/** الفرق بين الفورم والمحفوظ → Patch للباك (الحقول المتغيرة بس) */
export function buildPatch(draft: Draft, saved: PolicyValues): Partial<PolicyValues> {
  const patch: Record<string, number | boolean | null> = {}

  for (const key of NUM_KEYS) {
    const text = draft[key].trim()
    const next = text === '' ? null : Number(text)
    if (next !== saved[key]) patch[key] = next
  }
  for (const key of BOOL_KEYS) {
    if (draft[key] !== saved[key]) patch[key] = draft[key]
  }
  return patch as Partial<PolicyValues>
}
