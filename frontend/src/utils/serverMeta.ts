// frontend/src/utils/serverMeta.ts
// ==================================================================
// Shared display info for Origin Probe results (Dashboard + Servers pages)
//   probeRecommendation: excellent | good | fair | poor | down | null
//   probeConfidence:     high | medium | low | null
//
// The maps are keyed by plain strings so they accept both the typed values
// from serversService and raw strings coming from other endpoints
// (e.g. /dashboard/servers). Use the helper functions below for a safe
// lookup that also handles null / unknown values.
//
// i18n: مفيش نصوص مكتوبة هنا. الـ label بيتجاب من servers.rec.* وقت القراءة
// (getter)، فالمكوّنات اللي بتقرا meta.label بتفضل شغالة زي ما هي وبتتغير مع اللغة.
// ==================================================================

import i18n from '../i18n'
import type { Tone } from '../components/ui/tones'

/** meta فيه tone ثابت و label مترجم (بيتحسب لما نقراه) */
function rec(tone: Tone, key: string): { label: string; tone: Tone } {
  return {
    tone,
    get label() {
      return i18n.t(`rec.${key}`, { ns: 'servers', defaultValue: key })
    },
  }
}

export const REC_META: Record<string, { label: string; tone: Tone }> = {
  excellent: rec('emerald', 'excellent'),
  good:      rec('cyan',    'good'),
  fair:      rec('amber',   'fair'),
  poor:      rec('amber',   'poor'),
  down:      rec('rose',    'down'),
}

/** Safe lookup: returns undefined for null / unknown recommendations */
export function getRecMeta(value: string | null | undefined): { label: string; tone: Tone } | undefined {
  return value ? REC_META[value] : undefined
}

/** Safe lookup: returns an empty dash for null, or the raw value if unknown */
export function getConfidenceLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return i18n.t(`confidence.${value}`, { ns: 'servers', defaultValue: value })
}

export const CONFIDENCE_LABEL: Record<string, string> = {
  get high() { return getConfidenceLabel('high') },
  get medium() { return getConfidenceLabel('medium') },
  get low() { return getConfidenceLabel('low') },
}

/** Requests per second in a readable form */
export function formatRps(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toLocaleString('en-US')} req/s`
}
