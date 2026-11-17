// frontend/src/i18n/languages.ts
// ==================================================================
// قائمة اللغات في مكان واحد — ده الملف الوحيد اللي بيتعدل لإضافة لغة.
// (مع إضافة فولدر الترجمة في src/locales/<code>/)
// ==================================================================

export type Direction = 'ltr' | 'rtl'

export interface LanguageConfig {
  /** كود اللغة = اسم فولدر locales */
  code: string
  /** اسم اللغة بلغتها (بيظهر في زر اللغات) */
  label: string
  /** اتجاه الصفحة */
  dir: Direction
  /** (اختياري) رابط خط خاص باللغة، بيتحمل لما اللغة تتفعل بس */
  fontUrl?: string
  /** (اختياري) font-family الخاص باللغة، لو مفيش بيستخدم الافتراضي */
  fontFamily?: string
}

export const LANGUAGES: LanguageConfig[] = [
  {
    code: 'ar',
    label: 'العربية',
    dir: 'rtl',
    fontUrl:
      'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap',
    fontFamily: 'Cairo, Inter, ui-sans-serif, system-ui, sans-serif',
  },
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'de', label: 'Deutsch', dir: 'ltr' },
  {
    code: 'zh',
    label: '中文',
    dir: 'ltr',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  },
]

/** اللغة الاحتياطية: أي ترجمة ناقصة بتظهر بيها */
export const FALLBACK_LANGUAGE = 'en'

export const SUPPORTED_CODES = LANGUAGES.map((l) => l.code)

/** هل الكود لغة مدعومة بالظبط؟ (بدون تحويل ar-EG) */
export function isSupported(code?: string): boolean {
  return !!code && SUPPORTED_CODES.includes(code)
}

/** بيحوّل ar-EG → ar و de-AT → de، ولو غير مدعوم بيرجع الاحتياطي */
export function toSupported(code?: string): string {
  const base = (code ?? '').split('-')[0].toLowerCase()
  return isSupported(base) ? base : FALLBACK_LANGUAGE
}

export function getLanguage(code?: string): LanguageConfig | undefined {
  return LANGUAGES.find((l) => l.code === toSupported(code))
}

export function getDirection(code?: string): Direction {
  return getLanguage(code)?.dir ?? 'ltr'
}