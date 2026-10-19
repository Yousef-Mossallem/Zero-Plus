// frontend/src/components/ui/tones.ts
// ألوان وأنواع مشتركة بين مكونات الـ UI

import type { ComponentType } from 'react'

export type IconType = ComponentType<{ className?: string }>

// ==================================================================
// Tones (ألوان موحدة)
// ==================================================================

export type Tone = 'cyan' | 'emerald' | 'amber' | 'rose' | 'slate' | 'indigo'

export const TONE_BADGE: Record<Tone, string> = {
  cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-400/20',
  emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-400/20',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-400/20',
  rose: 'bg-rose-500/10 text-rose-300 border-rose-400/20',
  slate: 'bg-white/5 text-slate-300 border-white/10',
  indigo: 'bg-indigo-500/10 text-indigo-300 border-indigo-400/20',
}

export const TONE_ICON: Record<Tone, string> = {
  cyan: 'bg-cyan-500/10 text-cyan-400',
  emerald: 'bg-emerald-500/10 text-emerald-400',
  amber: 'bg-amber-500/10 text-amber-400',
  rose: 'bg-rose-500/10 text-rose-400',
  slate: 'bg-white/5 text-slate-300',
  indigo: 'bg-indigo-500/10 text-indigo-400',
}
