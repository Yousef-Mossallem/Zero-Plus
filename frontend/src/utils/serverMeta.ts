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
// ==================================================================

import type { Tone } from '../components/ui/tones'

export const REC_META: Record<string, { label: string; tone: Tone }> = {
  excellent: { label: 'Excellent', tone: 'emerald' },
  good: { label: 'Good', tone: 'cyan' },
  fair: { label: 'Fair', tone: 'amber' },
  poor: { label: 'Poor', tone: 'amber' },
  down: { label: 'Down', tone: 'rose' },
}

export const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

/** Safe lookup: returns undefined for null / unknown recommendations */
export function getRecMeta(value: string | null | undefined): { label: string; tone: Tone } | undefined {
  return value ? REC_META[value] : undefined
}

/** Safe lookup: returns an empty dash for null, or the raw value if unknown */
export function getConfidenceLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return CONFIDENCE_LABEL[value] ?? value
}

/** Requests per second in a readable form */
export function formatRps(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toLocaleString('en-US')} req/s`
}