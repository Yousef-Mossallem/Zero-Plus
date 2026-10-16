// frontend/src/utils/format.ts
// ==================================================================
// Zero Plus - Formatting Helpers
// دوال صغيرة لتنسيق التواريخ والأرقام (مكان واحد بدل التكرار في كل صفحة)
// ==================================================================

/** دمج class names (بيتجاهل القيم الفاضية) */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** تاريخ + وقت بصيغة مقروءة، أو '—' لو مفيش قيمة */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** "منذ كذا" بشكل مختصر: 5s / 3m / 2h / 4d */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  const s = Math.max(0, Math.floor(diff / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** رقم بفواصل آلاف: 12345 → 12,345 */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US')
}

/** قص نص طويل */
export function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** تحويل قيمة datetime-local (بتوقيت المستخدم) لـ ISO UTC بصيغة الباك (…Z) */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}
