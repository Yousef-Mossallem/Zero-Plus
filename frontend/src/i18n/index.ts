// frontend/src/i18n/index.ts
// ==================================================================
// قلب نظام الترجمة: بيهيّئ i18next ويحمّل ملفات JSON تلقائياً
// من src/locales/<lang>/<namespace>.json — من غير ما نلمس الكود
// لما نضيف لغة أو ملف جديد.
// ==================================================================

import i18n, { type BackendModule } from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import { FALLBACK_LANGUAGE, SUPPORTED_CODES } from './languages'

// Vite بيجمع كل ملفات الترجمة وقت البناء، وكل ملف بيتحمل بـ import() لوحده
const loaders = import.meta.glob<{ default: Record<string, unknown> }>(
  '../locales/*/*.json',
)

// أسماء الأقسام (namespaces) = أسماء الملفات الموجودة (common, auth, ...)
const NAMESPACES = Array.from(
  new Set(
    Object.keys(loaders).map((p) => p.split('/').pop()!.replace('.json', '')),
  ),
)

// Backend صغير بدل مكتبة إضافية: بيقرا الملف المطلوب من الـ glob فوق
const jsonBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(lng, ns, callback) {
    const load = loaders[`../locales/${lng}/${ns}.json`]
    // ملف مش موجود للغة دي → نرجع {} وi18next يكمل من الإنجليزي
    if (!load) return callback(null, {})
    load()
      .then((m) => callback(null, m.default))
      .catch((err) => callback(err, null))
  },
}

void i18n
  .use(jsonBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: SUPPORTED_CODES,
    fallbackLng: FALLBACK_LANGUAGE,

    // ar-EG و de-AT يتعاملوا على إنهم ar و de
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',

    ns: NAMESPACES,
    defaultNS: 'common',
    fallbackNS: 'common',

    // ترتيب الاكتشاف: أول جزء في الرابط (/ar) ← المحفوظة في المتصفح ← لغة المتصفح ← الاحتياطي
    detection: {
      order: ['path', 'localStorage', 'navigator'],
      lookupFromPathIndex: 0,
      lookupLocalStorage: 'zp-lang',
      caches: ['localStorage'],
    },

    // React بيعمل escape لوحده
    interpolation: { escapeValue: false },
    react: { useSuspense: true },

    // وضع التصحيح وقت التطوير: أي مفتاح ناقص يظهر في الكونسول
    debug: import.meta.env.DEV,
  })

export default i18n