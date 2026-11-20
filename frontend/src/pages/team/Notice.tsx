// frontend/src/pages/team/Notice.tsx
// إشعار نجاح/فشل بسيط (Toast) لصفحات الفريق — يتبع اتجاه اللغة (end)

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

type NoticeType = 'success' | 'error'

export function useNotice() {
  const [notice, setNotice] = useState<{ type: NoticeType; text: string } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = useCallback((type: NoticeType, text: string) => {
    window.clearTimeout(timer.current)
    setNotice({ type, text })
    timer.current = window.setTimeout(() => setNotice(null), 4000)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const node = notice ? (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 end-4 start-4 z-80 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur sm:start-auto sm:max-w-sm ${
        notice.type === 'success'
          ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
          : 'border-rose-400/30 bg-rose-500/15 text-rose-200'
      }`}
    >
      {notice.type === 'success' ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      )}
      <span dir="auto">{notice.text}</span>
    </div>
  ) : null

  return { show, node }
}
