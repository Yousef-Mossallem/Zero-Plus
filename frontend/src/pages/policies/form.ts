// frontend/src/pages/policies/form.ts — بيانات الحقول + Validation + بناء الـ Patch (منطق صرف)
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

export const NUM_META: Record<NumKey, NumMeta> = {
  allowMaxScore: { label: 'Allow up to', hint: 'Scores up to this value are allowed.', min: 0, max: 99, unit: 'pts' },
  rateLimitMaxScore: { label: 'Rate-limit up to', hint: 'Scores up to this value are rate limited.', min: 0, max: 99, unit: 'pts' },
  challengeMaxScore: { label: 'Challenge up to', hint: 'Above this value the request is blocked.', min: 0, max: 99, unit: 'pts' },
  passTokenTtlMinutes: { label: 'Clearance lifetime', hint: 'How long a visitor who passed the challenge stays cleared.', min: 1, max: 1440, unit: 'min' },
  rateLimitRequests: { label: 'Soft limit — requests', hint: 'Requests allowed per IP inside the window.', min: 1, max: 100_000, unit: 'req' },
  rateLimitWindowSec: { label: 'Soft limit — window', hint: 'Window length for the soft limit.', min: 1, max: 3600, unit: 'sec' },
  maxRequestsPerIp: { label: 'Hard limit — requests', hint: 'Absolute maximum per IP inside the window.', min: 1, max: 1_000_000, unit: 'req' },
  maxRequestsWindowSec: { label: 'Hard limit — window', hint: 'Window length for the hard limit.', min: 1, max: 3600, unit: 'sec' },
  maxServerRps: { label: 'Server capacity override', hint: 'Leave empty to use the capacity detected for each server.', min: 1, max: 1_000_000, unit: 'req/s', nullable: true },
  capacityWarnPercent: { label: 'Capacity warning at', hint: 'Notify when server load reaches this percentage.', min: 1, max: 100, unit: '%' },
  autoBanAfterFails: { label: 'Auto-ban after failures', hint: 'Failed advanced checks before a device is banned.', min: 1, max: 20, unit: 'fails' },
  temporaryBanMinutes: { label: 'Temporary ban length', hint: 'Duration of an automatic temporary ban.', min: 1, max: 10_080, unit: 'min' },
  permanentBanScore: { label: 'Permanent ban score', hint: 'Reputation score (1–10) that triggers a permanent ban.', min: 1, max: 10, unit: 'score' },
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
export function validate(draft: Draft): Partial<Record<NumKey, string>> {
  const errors: Partial<Record<NumKey, string>> = {}

  for (const key of NUM_KEYS) {
    const meta = NUM_META[key]
    const text = draft[key]
    if (meta.nullable && text.trim() === '') continue
    const n = parseInt10(text)
    if (n === undefined || n < meta.min || n > meta.max) {
      errors[key] = `Whole number between ${meta.min.toLocaleString('en-US')} and ${meta.max.toLocaleString('en-US')}`
    }
  }

  const allow = parseInt10(draft.allowMaxScore)
  const rate = parseInt10(draft.rateLimitMaxScore)
  const challenge = parseInt10(draft.challengeMaxScore)

  if (!errors.allowMaxScore && !errors.rateLimitMaxScore && allow! > rate!) {
    errors.allowMaxScore = 'Must be ≤ the rate-limit threshold'
  }
  if (!errors.rateLimitMaxScore && !errors.challengeMaxScore && rate! > challenge!) {
    errors.rateLimitMaxScore = 'Must be ≤ the challenge threshold'
  }

  const softReq = parseInt10(draft.rateLimitRequests)
  const softWin = parseInt10(draft.rateLimitWindowSec)
  const hardReq = parseInt10(draft.maxRequestsPerIp)
  const hardWin = parseInt10(draft.maxRequestsWindowSec)
  if (
    !errors.rateLimitRequests && !errors.rateLimitWindowSec &&
    !errors.maxRequestsPerIp && !errors.maxRequestsWindowSec &&
    hardReq! / hardWin! < softReq! / softWin!
  ) {
    errors.maxRequestsPerIp = 'Hard limit rate must not be lower than the soft limit rate'
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
