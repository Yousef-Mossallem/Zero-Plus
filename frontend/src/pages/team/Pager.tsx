// frontend/src/pages/team/Pager.tsx
// Pagination موحد لصفحات الفريق — الأسهم بتتقلب في RTL (prev دايمًا ناحية البداية)

import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function Pager({
  page,
  totalPages,
  onPage,
  disabled,
}: {
  page: number
  totalPages: number
  onPage: (p: number) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('team')
  const btn =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        className={btn}
        disabled={disabled || page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label={t('pager.prev')}
      >
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
      </button>
      <span className="min-w-14 text-center text-xs text-slate-400">
        {page} / {Math.max(1, totalPages)}
      </span>
      <button
        type="button"
        className={btn}
        disabled={disabled || page >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label={t('pager.next')}
      >
        <ChevronRight className="h-4 w-4 rtl:rotate-180" />
      </button>
    </div>
  )
}
