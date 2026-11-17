// frontend/src/services/translation/myMemoryService.ts
// ==================================================================
// MyMemory Translation API
// الرابط: https://api.mymemory.translated.net/get
// الإيميل من VITE_MYMEMORY_EMAIL → 50k حرف/يوم (بدلاً من 5k)
//
// قواعد:
//   - لو اللغة مش zh/de → ارجع النص الأصلي
//   - لو النص فاضي / أرقام بس / قصير جداً → ارجع النص الأصلي
//   - لو حصل خطأ → ارجع النص الأصلي (Fail-open)
//   - الكاش أولاً دايماً
// ==================================================================

import { getCached, setCached } from './translationCache'
import type { MyMemoryResponse } from './types'

const API_URL = 'https://api.mymemory.translated.net/get'
const EMAIL = (import.meta.env.VITE_MYMEMORY_EMAIL as string | undefined) ?? ''

/** هل النص يستاهل ترجمة؟ */
function shouldTranslate(text: string): boolean {
  if (!text || text.trim().length < 3) return false
  // كله أرقام ورموز فقط
  if (/^[\d\s\W]+$/.test(text)) return false
  // كله حروف لاتينية مفردة (URL / code)
  if (/^[a-zA-Z0-9_\-./:#@]+$/.test(text.trim()) && text.trim().length < 20) return false
  return true
}

/**
 * تحليل تكوين النص ولغته:
 * لو النص فيه حروف عربية كتير → ar
 * لو النص معظمه إنجليزي → en
 * لو النص مختلط بشكل واضح → تحديد الأنسب والترجمة Fail-open
 */
function analyzeLanguageComposition(text: string): {
  fromLang: string
  isMixed: boolean
} {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) ?? []).length
  const latinChars = (text.match(/[a-zA-Z]/g) ?? []).length
  const totalLetters = arabicChars + latinChars

  if (totalLetters === 0) return { fromLang: 'en', isMixed: false }

  const arabicRatio = arabicChars / totalLetters

  if (arabicRatio >= 0.35) {
    return { fromLang: 'ar', isMixed: latinChars > 3 }
  } else {
    return { fromLang: 'en', isMixed: arabicChars > 0 }
  }
}

/**
 * يترجم نص واحد عبر MyMemory API
 * يرجع النص الأصلي لو حصل أي خطأ أو مش محتاج ترجمة
 */
export async function translateText(text: string, toLang: string): Promise<string> {
  if (!shouldTranslate(text)) return text

  const { fromLang } = analyzeLanguageComposition(text)

  // لو المصدر والهدف نفس اللغة
  if (fromLang === toLang) return text

  // شيك الكاش أولاً
  const cached = getCached(fromLang, toLang, text)
  if (cached !== null) return cached

  try {
    const params = new URLSearchParams({
      q: text,
      langpair: `${fromLang}|${toLang}`,
    })
    if (EMAIL) params.set('de', EMAIL)

    const res = await fetch(`${API_URL}?${params.toString()}`)
    if (!res.ok) return text

    const data = (await res.json()) as MyMemoryResponse

    if (data.responseStatus !== 200) return text
    const translated = data.responseData?.translatedText
    if (!translated || translated === text) return text

    // احفظ في الكاش
    setCached(fromLang, toLang, text, translated)
    return translated
  } catch {
    // Fail-open: ارجع النص الأصلي
    return text
  }
}

/** ترجمة مجموعة نصوص (عمليات متوازية) */
export async function translateMany(
  texts: string[],
  toLang: string,
): Promise<string[]> {
  return Promise.all(texts.map((t) => translateText(t, toLang)))
}
