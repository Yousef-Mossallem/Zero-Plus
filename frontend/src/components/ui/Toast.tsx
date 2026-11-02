// frontend/src/components/ui/Toast.tsx
// ==================================================================
// Zero Plus - Toast System (Provider + useToast)
// نظام التنبيهات المنبثقة: نجاح / خطأ / تحذير / معلومة
//
// الاستخدام في أي صفحة:
//   const toast = useToast()
//   toast.success('تم الحفظ', 'تفاصيل اختيارية')
//   toast.error('فشل الطلب')
// ==================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
  duration: number
  leaving: boolean
}

interface ToastApi {
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
}

// ------------------------------------------------------------------
// Visual config لكل نوع (ألوان الثيم: mint / rose / amber / cyan)
// ------------------------------------------------------------------

const KIND_STYLES: Record<
  ToastKind,
  { icon: typeof Info; ring: string; iconCls: string; bar: string }
> = {
  success: {
    icon: CheckCircle2,
    ring: 'border-emerald-400/25',
    iconCls: 'text-emerald-400 bg-emerald-400/10',
    bar: 'bg-emerald-400',
  },
  error: {
    icon: AlertCircle,
    ring: 'border-rose-500/30',
    iconCls: 'text-rose-400 bg-rose-500/10',
    bar: 'bg-rose-400',
  },
  warning: {
    icon: AlertTriangle,
    ring: 'border-amber-400/30',
    iconCls: 'text-amber-400 bg-amber-400/10',
    bar: 'bg-amber-400',
  },
  info: {
    icon: Info,
    ring: 'border-cyan-400/25',
    iconCls: 'text-cyan-400 bg-cyan-400/10',
    bar: 'bg-cyan-400',
  },
}

const MAX_VISIBLE = 4
const LEAVE_MS = 250

// ------------------------------------------------------------------
// Context
// ------------------------------------------------------------------

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return ctx
}

// ------------------------------------------------------------------
// Single toast card
// ------------------------------------------------------------------

function ToastCard({
  toast,
  onClose,
}: {
  toast: ToastItem
  onClose: (id: number) => void
}) {
  const style = KIND_STYLES[toast.kind]
  const Icon = style.icon

  // أول ما الوقت يخلص نبدأ انيميشن الخروج
  useEffect(() => {
    const timer = setTimeout(() => onClose(toast.id), toast.duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onClose])

  return (
    <div
      role="status"
      className={`
        pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-xl
        border bg-[#0b1224]/95 shadow-2xl shadow-black/50 backdrop-blur-xl
        ${style.ring}
        ${toast.leaving ? 'zp-anim-toast-out' : 'zp-anim-toast-in'}
      `}
    >
      <div className="flex items-start gap-3 p-4">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.iconCls}`}
        >
          <Icon className="h-4.5 w-4.5" />
        </span>

        <div className="min-w-0 flex-1 pt-0.5">
          {/* dir=auto: الرسائل العربية من الباك تتعرض صح من اليمين */}
          <p dir="auto" className="text-sm font-semibold text-white">
            {toast.title}
          </p>
          {toast.description && (
            <p dir="auto" className="mt-0.5 text-xs leading-relaxed text-slate-400">
              {toast.description}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => onClose(toast.id)}
          className="rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-white"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* شريط الوقت المتبقي */}
      <div
        className={`absolute bottom-0 left-0 h-0.5 w-full origin-left ${style.bar} opacity-70`}
        style={{ animation: `zp-progress ${toast.duration}ms linear forwards` }}
      />
    </div>
  )
}

// ------------------------------------------------------------------
// Provider
// ------------------------------------------------------------------

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)

  // إخفاء ناعم: نعلّم التوست إنه "بيخرج" ثم نمسحه بعد مدة الانيميشن
  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, LEAVE_MS)
  }, [])

  const push = useCallback((kind: ToastKind, title: string, description?: string) => {
    counter.current += 1
    const id = counter.current
    // الأخطاء بتفضل أطول شوية عشان المستخدم يلحق يقراها
    const duration = kind === 'error' ? 6500 : 4000

    setToasts((prev) => {
      const item: ToastItem = {
        id,
        kind,
        title,
        duration,
        leaving: false,
        ...(description !== undefined && { description }),
      }
      // نحتفظ بآخر MAX_VISIBLE بس
      return [...prev, item].slice(-MAX_VISIBLE)
    })
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, d) => push('success', t, d),
      error: (t, d) => push('error', t, d),
      warning: (t, d) => push('warning', t, d),
      info: (t, d) => push('info', t, d),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* حاوية التوست: ثابتة أعلى اليمين فوق كل حاجة */}
      <div
        dir="ltr"
        className="pointer-events-none fixed right-4 top-4 z-100 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2.5 sm:right-6 sm:top-6"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export default ToastProvider
