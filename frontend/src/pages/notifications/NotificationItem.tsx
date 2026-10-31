// frontend/src/pages/notifications/NotificationItem.tsx
// ==================================================================
// صف إشعار واحد في صفحة الإشعارات
//   - "جديد" (fresh) بلون مختلف + شريط جانبي + Badge
//   - أيقونة حسب النوع، وبيّن النوع والشدة والوقت
//   - chips من الـ metadata (IP / Risk Score ...) لو موجودة
// ==================================================================

import { Check } from 'lucide-react'

import { Badge, Button } from '../../components/ui/kit'
import type { AppNotification } from '../../services/notificationsService'
import { SEVERITY_LABELS, metaFor, visualFor } from '../../utils/notificationMeta'
import { cn, formatDateTime, timeAgo, truncate } from '../../utils/format'

/** أول 4 قيم بسيطة (نص/رقم/boolean) من الـ metadata */
function metadataChips(metadata: AppNotification['metadata']): Array<[string, string]> {
  if (!metadata) return []
  return Object.entries(metadata)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 4)
    .map(([k, v]) => [k, truncate(String(v), 28)])
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
      className={cn(
        'zp-anim-fade-up relative flex gap-4 border-b border-white/5 px-5 py-4 last:border-0',
        highlighted ? 'bg-cyan-500/6' : 'hover:bg-white/2',
      )}
    >
      {/* الشريط الجانبي للجديد */}
      {highlighted && (
        <span className={cn('absolute inset-y-0 left-0 w-0.5', visual.accent)} />
      )}

      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', visual.iconCls)}>
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p dir="auto" className="text-sm font-semibold text-white">
            {n.title}
          </p>
          {highlighted && <Badge tone="cyan">New</Badge>}
        </div>

        <p dir="auto" className="mt-1 text-sm leading-relaxed text-slate-400">
          {n.message}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Badge tone="slate">{meta.label}</Badge>
          <Badge tone={visual.tone}>{SEVERITY_LABELS[n.severity] ?? `Level ${n.severity}`}</Badge>
          {chips.map(([key, value]) => (
            <span
              key={key}
              className="rounded-md border border-white/8 bg-white/3 px-2 py-0.5 font-mono text-[11px] text-slate-400"
            >
              {key}: <span className="text-slate-200">{value}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="text-xs text-slate-500">
          {timeAgo(n.createdAt)}
        </time>
        {!n.isRead && (
          <Button size="sm" variant="ghost" icon={Check} onClick={() => onMarkRead(n.id)}>
            Mark read
          </Button>
        )}
      </div>
    </li>
  )
}
