// frontend/src/utils/serverMeta.ts
// ==================================================================
// معلومات عرض مشتركة لنتائج Origin Probe (الداشبورد + السيرفرات)
//   probeRecommendation: excellent | good | fair | poor | down | null
//   probeConfidence:     high | medium | low | null
// ==================================================================

import type { Tone } from '../components/ui/kit'

export const REC_META: Record<string, { label: string; tone: Tone }> = {
  excellent: { label: 'Excellent', tone: 'emerald' },
  good: { label: 'Good', tone: 'cyan' },
  fair: { label: 'Fair', tone: 'amber' },
  poor: { label: 'Poor', tone: 'orange' },
  down: { label: 'Down', tone: 'rose' },
}

export const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

/** رقم Requests/ثانية بشكل مقروء */
export function formatRps(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toLocaleString('en-US')} req/s`
}
