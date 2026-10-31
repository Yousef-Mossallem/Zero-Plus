// frontend/src/components/AlertToast.tsx
// ==================================================================
// Zero Plus - Alert Toast (توست الإشعارات اللحظية)
// بيظهر فوق كل صفحة (top-right) أول ما notification:new يوصل.
//
//   - أيقونة حسب NotificationType، ولون حسب الشدة (severity)
//   - بيختفي بعد 5 ثواني، أو بالـ X، والـ hover بيوقف العدّاد
//   - الضغط عليه بيفتح صفحة الإشعارات
//   - بيدخل في نفس حاوية توست النظام (#zp-toast-stack) عن طريق Portal
//     عشان الاتنين يتراكموا تحت بعض ومايتغطوش
// ==================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'

import useNotificationStore from '../store/notificationStore'
import type { AppNotification } from '../services/notificationsService'
import { SEVERITY_LABELS, metaFor, visualFor } from '../utils/notificationMeta'

const DURATION_MS = 5000
const LEAVE_MS = 250

function NotificationToastCard({
  notification,
  onClose,
  onOpen,
}: {
  notification: AppNotification
  onClose: (id: string) => void
  onOpen: (id: string) => void
}) {
  const [leaving, setLeaving] = useState(false)
  const [paused, setPaused] = useState(false)

  // الوقت المتبقي (بيتحفظ لما المستخدم يعمل hover)
  const remaining = useRef(DURATION_MS)
  const startedAt = useRef(Date.now())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const close = useCallback(() => {
    setLeaving(true)
    setTimeout(() => onClose(notification.id), LEAVE_MS)
  }, [notification.id, onClose])

  useEffect(() => {
    if (paused) return
    startedAt.current = Date.now()
    timer.current = setTimeout(close, remaining.current)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      // لو اتوقف بـ hover: نخزن اللي فاضل
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
    }
  }, [paused, close])

  const meta = metaFor(notification.type)
  const visual = visualFor(notification.type, notification.severity)
  const Icon = meta.icon

  return (
    <div
      role={notification.severity >= 4 ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`
        pointer-events-auto relative w-full cursor-pointer overflow-hidden rounded-xl border
        bg-[#0b1224]/95 shadow-2xl shadow-black/50 backdrop-blur-xl
        ${visual.ring}
        ${leaving ? 'zp-anim-toast-out' : 'zp-anim-toast-in'}
      `}
      onClick={() => onOpen(notification.id)}
    >
      <div className="flex items-start gap-3 p-4">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${visual.iconCls}`}>
          <Icon className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-2">
            <p dir="auto" className="truncate text-sm font-semibold text-white">
              {notification.title}
            </p>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {SEVERITY_LABELS[notification.severity] ?? ''}
            </span>
          </div>
          <p dir="auto" className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-400">
            {notification.message}
          </p>
        </div>

        <button
          type="button"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation() // مايفتحش الصفحة
            close()
          }}
          className="rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* شريط الوقت */}
      <div
        className={`absolute bottom-0 left-0 h-0.5 w-full origin-left opacity-70 ${visual.bar}`}
        style={{
          animation: `zp-progress ${DURATION_MS}ms linear forwards`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </div>
  )
}

export default function AlertToast() {
  const navigate = useNavigate()
  const toasts = useNotificationStore((s) => s.toasts)
  const dismiss = useNotificationStore((s) => s.dismissToast)

  // الحاوية بتتعمل في ToastProvider (بعد أول render) فبندوّر عليها في effect
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHost(document.getElementById('zp-toast-stack'))
  }, [])

  const open = useCallback(
    (id: string) => {
      dismiss(id)
      navigate('/notifications')
    },
    [dismiss, navigate],
  )

  if (toasts.length === 0) return null

  const cards = toasts.map((n) => (
    <NotificationToastCard key={n.id} notification={n} onClose={dismiss} onOpen={open} />
  ))

  // لو ToastProvider مش موجود لأي سبب: حاوية احتياطية خاصة بينا
  if (!host) {
    return (
      <div
        dir="ltr"
        className="pointer-events-none fixed right-4 top-4 z-100 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2.5 sm:right-6 sm:top-6"
      >
        {cards}
      </div>
    )
  }

  return createPortal(cards, host)
}
