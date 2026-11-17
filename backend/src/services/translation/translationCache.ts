// frontend/src/services/translation/translationCache.ts
// كاش الترجمة في localStorage — بيعيش مع المتصفح ومفيهوش TTL.
// المفتاح: mymemory:<from>:<to>:<hash>

import type { ApiLang, CacheKey } from './types'

const PREFIX = 'mymemory:'
const EVICT_COUNT = 50

/** هاش سريع (cyrb53) — ثابت لنفس النص */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

export function buildCacheKey(from: ApiLang, to: ApiLang, text: string): CacheKey {
  return `${PREFIX}${from}:${to}:${cyrb53(text).toString(36)}` as CacheKey
}

export function getCached(from: ApiLang, to: ApiLang, text: string): string | null {
  try {
    return localStorage.getItem(buildCacheKey(from, to, text))
  } catch {
    return null // localStorage ممنوع أو تالف
  }
}

/** لو الكتابة فشلت (quota) بنمسح 50 مفتاح من مفاتيحنا ونجرب مرة واحدة */
export function setCached(from: ApiLang, to: ApiLang, text: string, value: string): void {
  const key = buildCacheKey(from, to, text)
  try {
    localStorage.setItem(key, value)
  } catch {
    try {
      const doomed: string[] = []
      for (let i = 0; i < localStorage.length && doomed.length < EVICT_COUNT; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(PREFIX)) doomed.push(k)
      }
      doomed.forEach((k) => localStorage.removeItem(k))
      localStorage.setItem(key, value)
    } catch {
      /* نتجاهل: الترجمة هتشتغل من غير كاش */
    }
  }
}
