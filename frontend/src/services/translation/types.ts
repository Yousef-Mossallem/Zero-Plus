// frontend/src/services/translation/types.ts
// ==================================================================
// نظام الترجمة التلقائية للنصوص الديناميكية (من الباك اند)
// بيشتغل فقط مع الصيني (zh) والألماني (de)
// ==================================================================

export type SupportedLang = 'ar' | 'en' | 'zh' | 'de'

/** اللغات اللي بتحتاج ترجمة (مش en ومش ar) */
export const TRANSLATE_LANGS: SupportedLang[] = ['zh', 'de']

/** هل اللغة دي تحتاج ترجمة؟ */
export function needsTranslation(lang: string): lang is 'zh' | 'de' {
  return lang === 'zh' || lang === 'de'
}

export interface TranslationResult {
  translatedText: string
  fromCache: boolean
}

export interface MyMemoryResponse {
  responseStatus: number
  responseData: {
    translatedText: string
    match: number
  }
  quotaFinished?: boolean
  mtLangSupported?: boolean | null
}
