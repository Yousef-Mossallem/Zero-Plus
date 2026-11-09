// frontend/src/pages/reputation/shared.tsx — ثوابت وعناصر عرض مشتركة (ScorePips / BanBadge)

import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { Badge, type Tone } from '../../components/ui/kit'
import { type ReputationEntry, type ScoreBand } from '../../services/reputationService'
import type { IpType } from '../../services/types'

export const ACTION_ROLES = ['OWNER', 'ADMIN', 'ANALYST']

export const IP_TYPES: IpType[] = ['RESIDENTIAL', 'MOBILE', 'DATACENTER', 'VPN_PROXY', 'TOR', 'UNKNOWN']

function band(tone: Tone, hex: string, key: ScoreBand): { tone: Tone; hex: string; label: string } {
  return {
    tone,
    hex,
    get label() {
      return i18n.t(`bands.${key}`, { ns: 'reputation', defaultValue: key })
    },
  }
}

export const BAND_META: Record<ScoreBand, { tone: Tone; hex: string; label: string }> = {
  CLEAN: band('emerald', '#10B981', 'CLEAN'),
  LOW: band('cyan', '#38BDF8', 'LOW'),
  ELEVATED: band('amber', '#F59E0B', 'ELEVATED'),
  HIGH: band('rose', '#FB923C', 'HIGH'),
  CRITICAL: band('rose', '#F43F5E', 'CRITICAL'),
}

export const BAND_ORDER: ScoreBand[] = ['CLEAN', 'LOW', 'ELEVATED', 'HIGH', 'CRITICAL']

export const BAN_PRESETS = [
  {
    get label() {
      return i18n.t('modal.presets.p30', { ns: 'reputation', defaultValue: '30 min' })
    },
    minutes: 30,
  },
  {
    get label() {
      return i18n.t('modal.presets.p120', { ns: 'reputation', defaultValue: '2 hours' })
    },
    minutes: 120,
  },
  {
    get label() {
      return i18n.t('modal.presets.p1440', { ns: 'reputation', defaultValue: '24 hours' })
    },
    minutes: 1440,
  },
  {
    get label() {
      return i18n.t('modal.presets.p10080', { ns: 'reputation', defaultValue: '7 days' })
    },
    minutes: 10_080,
  },
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
  const { t } = useTranslation('reputation')
  // بنتأكد إن الحظر المؤقت لسه ساري (الباك ممكن يسيبه TEMPORARY بعد ما ينتهي)
  const activeTemp =
    entry.banStatus === 'TEMPORARY' &&
    entry.bannedUntil !== null &&
    new Date(entry.bannedUntil).getTime() > Date.now()

  if (entry.banStatus === 'PERMANENT') return <Badge tone="rose" dot>{t('filters.perm')}</Badge>
  if (activeTemp) {
    const mins = Math.max(1, Math.ceil((new Date(entry.bannedUntil!).getTime() - Date.now()) / 60_000))
    const timeStr = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
    return <Badge tone="amber" dot>{t('table.tempLabel', { label: timeStr })}</Badge>
  }
  return <Badge tone="emerald">{t('filters.notBanned')}</Badge>
}

export function isCurrentlyBanned(entry: ReputationEntry): boolean {
  if (entry.banStatus === 'PERMANENT') return true
  return (
    entry.banStatus === 'TEMPORARY' &&
    entry.bannedUntil !== null &&
    new Date(entry.bannedUntil).getTime() > Date.now()
  )
}
