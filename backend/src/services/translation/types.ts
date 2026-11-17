// frontend/src/services/translation/types.ts
// أنواع نظام الترجمة التلقائية (MyMemory) — للنصوص الديناميكية فقط

/** اللغات اللي بنترجم ليها فعلاً (ar/en بيرجعوا النص الأصلي) */
export type TranslationLang = 'zh' | 'de'

/** أكواد اللغات المقبولة في langpair بتاع MyMemory */
export type ApiLang = 'ar' | 'en' | 'zh-CN' | 'de'

/** مصدر النص بعد التحليل: عربي / إنجليزي / مختلط / سكربت تاني (مش بنترجمه) */
export type DetectedSource = 'ar' | 'en' | 'mixed' | 'other'

/** شكل مفتاح الكاش: mymemory:من:إلى:هاش */
export type CacheKey = `mymemory:${string}:${string}:${string}`

export interface MyMemoryResponse {
  responseStatus?: number | string
  responseData?: { translatedText?: unknown }
}
