// src/utils/format.ts
// ==================================================================
// دوال مساعدة لتنسيق البيانات والتواريخ والكلاسات
// (مصممة لتعمل بدون مكتبات خارجية وتتوافق مع tsconfig الصارم)
// ==================================================================

/**
 * دمج كلاسات Tailwind بشكل آمن (بديل لـ clsx)
 */
export function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(' ');
}

/**
 * تنسيق التاريخ إلى صيغة "منذ X وقت"
 */
export function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'الآن';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

/**
 * تنسيق التاريخ والوقت بشكل كامل
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * تنسيق التاريخ والوقت (صيغة بديلة)
 */
export function formatDateTime(date: string | Date): string {
  return formatDate(date);
}

/**
 * تنسيق الوقت النسبي (صيغة بديلة لـ timeAgo)
 */
export function formatRelativeTime(date: string | Date): string {
  return timeAgo(typeof date === 'string' ? date : date.toISOString());
}

/**
 * تنسيق الأرقام الكبيرة (مثل 1.2K, 3.5M)
 */
export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return '—';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString('en-US');
}

/**
 * تنسيق النسب المئوية
 */
export function formatPercent(num: number | null | undefined): string {
  if (num === null || num === undefined) return '—';
  return `${num.toFixed(1)}%`;
}

/**
 * تنسيق الوقت بالميلي ثانية
 */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
/**
 * قص النص مع إضافة … لو أطول من الحد
 */
export function truncate(value: string | null | undefined, max = 40): string {
  if (!value) return '—'
  const s = String(value)
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)) + '…'
}
