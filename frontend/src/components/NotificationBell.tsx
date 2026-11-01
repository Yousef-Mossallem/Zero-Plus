// frontend/src/components/NotificationBell.tsx
// ==================================================================
// Zero Plus - Notification Bell (جرس الـ Navbar)
//   - badge بعدد الغير مقروء (99+ كحد أقصى)
//   - الجرس بيهتز والـ badge بيعمل pop لما إشعار جديد يوصل
//   - نقطة صغيرة بتبين حالة اتصال السوكيت (أخضر = لحظي شغال)
//   - الضغط بيفتح /notifications
// ==================================================================

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'

import useNotificationStore from '../store/notificationStore'

const DOT: Record<string, string> = {
  connected: 'bg-emerald-400',
  connecting: 'bg-amber-400 animate-pulse',
  disconnected: 'bg-rose-500',
  unauthorized: 'bg-rose-500',
  idle: 'bg-slate-600',
}

export default function NotificationBell({ className = '' }: { className?: string }) {
  const navigate = useNavigate()
  const unread = useNotificationStore((s) => s.unreadCount)
  const connection = useNotificationStore((s) => s.connection)

  // الهزّة بتتفعل لما العدد يزيد بس (مش لما يقل)
  const prev = useRef(unread)
  const [ring, setRing] = useState(0)
  useEffect(() => {
    if (unread > prev.current) setRing((n) => n + 1)
    prev.current = unread
  }, [unread])

  return (
    <button
      type="button"
      onClick={() => navigate('/notifications')}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      title={connection === 'connected' ? 'Live' : 'Live updates offline'}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:border-cyan-500/30 hover:bg-white/5 hover:text-cyan-300 ${className}`}
    >
      {/* key بيعيد تشغيل الانيميشن مع كل إشعار جديد */}
      <Bell key={ring} className={`h-4.5 w-4.5 ${ring > 0 ? 'zp-anim-bell' : ''}`} />

      {unread > 0 && (
        <span
          key={unread}
          className="zp-anim-badge absolute -right-1.5 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white shadow-lg shadow-rose-500/30"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}

      <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[#070b14] ${DOT[connection] ?? DOT.idle}`} />
    </button>
  )
}
