// frontend/src/router/paths.ts
// الصفحة الافتراضية جوه التطبيق: الإشعارات، مش اللاندنج ومش السياسات.

export const HOME_PATH = '/notifications'

// true = الصفحات المحمية تتفتح من غير جلسة.
// رجّعه false لما تسجيل الدخول يبقى مطلوب تاني.
export const BYPASS_AUTH = false

// صفحات اللاندينج بتاخد اللغة في أول الرابط: /ar /en /de
export type LandingPage = '' | 'about' | 'contact' | 'legal'

/** landingPath('de', 'about') → /de/about  |  landingPath('ar') → /ar */
export const landingPath = (lng: string, page: LandingPage = ''): string =>
  `/${lng}${page ? `/${page}` : ''}`