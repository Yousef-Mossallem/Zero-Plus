// frontend/src/pages/notifications/NotificationItem.tsx
// ==================================================================
// إشعار واحد في التايم لاين
//   - أيقونة على الخط الرأسي (rail) + كارت بالمحتوى
//   - "جديد" (fresh) بحدود ملوّنة حسب الشدة + Badge
//   - chips من الـ metadata (IP / Risk Score ...) لو موجودة
// ==================================================================

import { Check } from 'lucide-react'

import { Badge, Button } from '../../components/ui/kit'
import type { AppNotification } from '../../services/notificationsService'
import { SEVERITY_LABELS, metaFor, visualFor } from '../../utils/notificationMeta'
import { cn, formatDateTime, truncate } from '../../utils/format'

/** أول 4 قيم بسيطة (نص/رقم/boolean) من الـ metadata */
function metadataChips(metadata: AppNotification['metadata']): Array<[string, string]> {
  if (!metadata) return []
  return Object.entries(metadata)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 4)
    .map(([k, v]) => [k, truncate(String(v), 28)])
}

function clockTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function NotificationItem({
  notification: n,
  fresh,
  index,
  onMarkRead,
}: {
  notification: AppNotification
  fresh: boolean
  index: number
  onMarkRead: (id: string) => void
}) {
  const meta = metaFor(n.type)
  const visual = visualFor(n.type, n.severity)
  const Icon = meta.icon
  const chips = metadataChips(n.metadata)
  const highlighted = fresh || !n.isRead

  return (
    <li
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
      className="zp-anim-fade-up relative flex gap-3 sm:gap-4"
    >
      {/* عقدة التايم لاين */}
      <span
        className={cn(
          'relative z-10 mt-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-[#0a0f1d]',
          highlighted ? visual.ring : 'border-white/10',
          visual.iconCls,
        )}
      >
        <Icon className="h-4.5 w-4.5" />
        {highlighted && (
          <span className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#0a0f1d]', visual.accent)} />
        )}
      </span>

      {/* الكارت */}
      <div
        className={cn(
          'min-w-0 flex-1 rounded-2xl border p-4 backdrop-blur-xl transition',
          highlighted
            ? cn('bg-white/5 shadow-lg shadow-black/20', visual.ring)
            : 'border-white/8 bg-white/2 hover:bg-white/4',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p dir="auto" className="text-sm font-semibold text-white">
                {n.title}
              </p>
              {highlighted && <Badge tone="cyan">New</Badge>}
            </div>
            <p dir="auto" className="mt-1 text-sm leading-relaxed text-slate-400">
              {n.message}
            </p>
          </div>
          <time
            dateTime={n.createdAt}
            title={formatDateTime(n.createdAt)}
            className="shrink-0 pt-0.5 font-mono text-xs text-slate-500"
          >
            {clockTime(n.createdAt)}
          </time>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="slate">{meta.label}</Badge>
          <Badge tone={visual.tone} dot>
            {SEVERITY_LABELS[n.severity] ?? `Level ${n.severity}`}
          </Badge>
          {chips.map(([key, value]) => (
            <span
              key={key}
              className="rounded-md border border-white/8 bg-white/3 px-2 py-0.5 font-mono text-[11px] text-slate-400"
            >
              {key}: <span className="text-slate-200">{value}</span>
            </span>
          ))}
          {!n.isRead && (
            <Button size="sm" variant="ghost" icon={Check} className="ml-auto" onClick={() => onMarkRead(n.id)}>
              Mark read
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
