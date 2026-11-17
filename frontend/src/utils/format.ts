// src/utils/format.ts
// ==================================================================
// دوال مساعدة لتنسيق البيانات والتواريخ والكلاسات
// متصلة بنظام i18n لدعم جميع اللغات (ar, en, de, zh) مع أرقام لاتينية قياسية
// ==================================================================

import i18n from '../i18n';

/**
 * دمج كلاسات Tailwind بشكل آمن (بديل لـ clsx)
 */
export function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(' ');
}

/**
 * استخراج لغة الواجهة الحالية مع ضبط التنسيق للأرقام اللاتينية
 */
function getCurrentLocale(): string {
  const lang = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  if (lang.startsWith('ar')) return 'ar-u-nu-latn';
  if (lang.startsWith('de')) return 'de-DE';
  if (lang.startsWith('zh')) return 'zh-CN';
  return 'en-US';
}

/**
 * تنسيق التاريخ إلى صيغة نسبية حسب لغة المستخدم الحالية
 */
export function timeAgo(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((date.getTime() - now.getTime()) / 1000);
  if (Number.isNaN(diffSec)) return '—';

  const locale = getCurrentLocale();

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const absDiff = Math.abs(diffSec);

    if (absDiff < 45) {
      return rtf.format(0, 'second');
    }
    if (absDiff < 3600) {
      const mins = Math.round(diffSec / 60);
      return rtf.format(mins, 'minute');
    }
    if (absDiff < 86400) {
      const hours = Math.round(diffSec / 3600);
      return rtf.format(hours, 'hour');
    }
    if (absDiff < 2592000) {
      const days = Math.round(diffSec / 86400);
      return rtf.format(days, 'day');
    }
    if (absDiff < 31536000) {
      const months = Math.round(diffSec / 2592000);
      return rtf.format(months, 'month');
    }
    const years = Math.round(diffSec / 31536000);
    return rtf.format(years, 'year');
  } catch {
    const lang = i18n.resolvedLanguage ?? i18n.language ?? 'en';
    const seconds = Math.abs(diffSec);
    if (seconds < 60) return lang === 'ar' ? 'الآن' : 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return lang === 'ar' ? `قبل ${minutes} دقيقة` : `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return lang === 'ar' ? `قبل ${hours} ساعة` : `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return lang === 'ar' ? `قبل ${days} يوم` : `${days}d ago`;
  }
}

/**
 * تنسيق التاريخ والوقت بشكل كامل حسب لغة المستخدم
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  const locale = getCurrentLocale();
  return d.toLocaleString(locale, {
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
export function formatDateTime(date: string | Date | null | undefined): string {
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
  const locale = getCurrentLocale();
  return num.toLocaleString(locale);
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

/** قص نص طويل مع … */
export function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** قيمة input من نوع datetime-local (توقيت المستخدم) → ISO UTC بصيغة الباك (…Z) */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
