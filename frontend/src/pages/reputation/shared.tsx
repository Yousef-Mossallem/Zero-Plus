// frontend/src/pages/reputation/shared.tsx — ثوابت وعناصر عرض مشتركة (ScorePips / BanBadge)

import { Badge, type Tone } from '../../components/ui/kit'
import { type ReputationEntry, type ScoreBand } from '../../services/reputationService'
import type { IpType } from '../../services/types'

export const ACTION_ROLES = ['OWNER', 'ADMIN', 'ANALYST']

export const IP_TYPES: IpType[] = ['RESIDENTIAL', 'MOBILE', 'DATACENTER', 'VPN_PROXY', 'TOR', 'UNKNOWN']

export const BAND_META: Record<ScoreBand, { tone: Tone; hex: string; label: string }> = {
  CLEAN: { tone: 'emerald', hex: '#10B981', label: 'Clean' },
  LOW: { tone: 'cyan', hex: '#38BDF8', label: 'Low' },
  ELEVATED: { tone: 'amber', hex: '#F59E0B', label: 'Elevated' },
  HIGH: { tone: 'rose', hex: '#FB923C', label: 'High' },
  CRITICAL: { tone: 'rose', hex: '#F43F5E', label: 'Critical' },
}

export const BAND_ORDER: ScoreBand[] = ['CLEAN', 'LOW', 'ELEVATED', 'HIGH', 'CRITICAL']

export const BAN_PRESETS = [
  { label: '30 min', minutes: 30 },
  { label: '2 hours', minutes: 120 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10_080 },
]

/** 10 مربعات صغيرة بتتلون حسب الدرجة (1-10) */
export function ScorePips({ score, band }: { score: number; band: ScoreBand }) {
  const color = BAND_META[band].hex
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className="h-3.5 w-1.5 rounded-xs"
            style={{ backgroundColor: i < score ? color : 'rgba(255,255,255,0.08)' }}
          />
        ))}
      </div>
      <span className="text-sm font-semibold tabular-nums text-white">{score}</span>
    </div>
  )
}

export function BanBadge({ entry }: { entry: ReputationEntry }) {
  // بنتأكد إن الحظر المؤقت لسه ساري (الباك ممكن يسيبه TEMPORARY بعد ما ينتهي)
  const activeTemp =
    entry.banStatus === 'TEMPORARY' &&
    entry.bannedUntil !== null &&
    new Date(entry.bannedUntil).getTime() > Date.now()

  if (entry.banStatus === 'PERMANENT') return <Badge tone="rose" dot>Permanent</Badge>
  if (activeTemp) {
    const mins = Math.max(1, Math.ceil((new Date(entry.bannedUntil!).getTime() - Date.now()) / 60_000))
    const label = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
    return <Badge tone="amber" dot>Temp · {label}</Badge>
  }
  return <Badge tone="emerald">Not banned</Badge>
}

export function isCurrentlyBanned(entry: ReputationEntry): boolean {
  if (entry.banStatus === 'PERMANENT') return true
  return (
    entry.banStatus === 'TEMPORARY' &&
    entry.bannedUntil !== null &&
    new Date(entry.bannedUntil).getTime() > Date.now()
  )
}
