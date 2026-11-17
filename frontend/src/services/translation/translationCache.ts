// frontend/src/services/translation/translationCache.ts
// ==================================================================
// كاش الترجمة في localStorage
// مفتاح: mymemory:{من}:{إلى}:{هاش النص}
// الكاش يعيش مع المتصفح مش له وقت انتهاء
// ==================================================================

/** هاش بسيط للنص */
function simpleHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // convert to 32bit int
  }
  return Math.abs(hash).toString(36)
}

function cacheKey(from: string, to: string, text: string): string {
  return `mymemory:${from}:${to}:${simpleHash(text)}`
}

export function getCached(from: string, to: string, text: string): string | null {
  try {
    const key = cacheKey(from, to, text)
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setCached(from: string, to: string, text: string, translated: string): void {
  try {
    const key = cacheKey(from, to, text)
    localStorage.setItem(key, translated)
  } catch {
    // localStorage full — ignore silently
  }
}
