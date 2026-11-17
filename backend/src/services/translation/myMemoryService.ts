// frontend/src/services/translation/myMemoryService.ts
// ترجمة النصوص الديناميكية عبر MyMemory مع كاش + Fail-open.
// translateText() مبترميش أبداً: أي مشكلة = النص الأصلي.

import { buildCacheKey, getCached, setCached } from './translationCache'
import type { ApiLang, DetectedSource, MyMemoryResponse, TranslationLang } from './types'

const ENDPOINT = 'https://api.mymemory.translated.net/get'
const MAX_BYTES = 450 // الحد عند MyMemory 500 بايت للطلب
const TIMEOUT_MS = 8000
const MIN_LENGTH = 3
const DOMINANCE = 0.6

const TARGET_API: Record<TranslationLang, ApiLang> = { zh: 'zh-CN', de: 'de' }

const AR = '\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF'
const AR_CHAR_RE = new RegExp(`[${AR}]`, 'g')
const LATIN_CHAR_RE = /[A-Za-z]/g
// "جزء عربي" = حروف عربية ممكن يتخللها مسافات/أرقام/علامات ترقيم
const AR_RUN_RE = new RegExp(`[${AR}]+(?:[\\s\\d.,،؛؟!:()\\-]+[${AR}]+)*`, 'g')
const SKIP_RE = /^(https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\d{1,3}(\.\d{1,3}){3}(:\d+)?)$/i
const BAD_OUTPUT_RE = /MYMEMORY WARNING|INVALID (LANGUAGE|EMAIL)|QUERY LENGTH LIMIT|NO QUERY SPECIFIED/i

const inflight = new Map<string, Promise<string>>()
let warnedNoEmail = false

// ---------------------------------------------------------------- helpers

const encoder = new TextEncoder()
const bytes = (s: string): number => encoder.encode(s).length

/** هل النص يستاهل الترجمة؟ (مش فاضي/قصير/أرقام/رموز/URL/إيميل/IP) */
export function shouldTranslate(text: string | null | undefined): text is string {
  if (typeof text !== 'string') return false
  const t = text.trim()
  if (t.length < MIN_LENGTH) return false
  if (!/\p{L}/u.test(t)) return false
  return !SKIP_RE.test(t)
}

/** تحليل مصدر النص: ≥60% عربي → ar، ≥60% لاتيني → en، غير كده مختلط */
export function detectSource(text: string): DetectedSource {
  const ar = (text.match(AR_CHAR_RE) ?? []).length
  const la = (text.match(LATIN_CHAR_RE) ?? []).length
  const total = ar + la
  if (total === 0) return 'other'
  if (ar / total >= DOMINANCE) return 'ar'
  if (la / total >= DOMINANCE) return 'en'
  return 'mixed'
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** تقسيم لقطع ≤450 بايت على حدود الجمل (ثم الكلمات لو الجملة طويلة) */
function splitIntoChunks(text: string): string[] {
  const sentences = text.match(/[^.!?؟۔\n]+[.!?؟۔]*\s*|\n+/g) ?? [text]
  const pieces: string[] = []
  for (const s of sentences) {
    if (bytes(s) <= MAX_BYTES) {
      pieces.push(s)
      continue
    }
    let cur = ''
    for (const w of s.split(/(\s+)/)) {
      if (bytes(cur + w) > MAX_BYTES && cur) {
        pieces.push(cur)
        cur = ''
      }
      if (bytes(w) > MAX_BYTES) {
        for (let i = 0; i < w.length; i += 100) pieces.push(w.slice(i, i + 100))
      } else {
        cur += w
      }
    }
    if (cur) pieces.push(cur)
  }
  const chunks: string[] = []
  let cur = ''
  for (const p of pieces) {
    if (cur && bytes(cur + p) > MAX_BYTES) {
      chunks.push(cur)
      cur = p
    } else {
      cur += p
    }
  }
  if (cur) chunks.push(cur)
  return chunks
}

// ---------------------------------------------------------------- network

async function fetchChunk(q: string, from: ApiLang, to: ApiLang): Promise<string> {
  const params = new URLSearchParams({ q, langpair: `${from}|${to}` })
  const email = import.meta.env?.VITE_MYMEMORY_EMAIL as string | undefined
  if (email) {
    params.set('de', email) // مع الإيميل الحد 50 ألف حرف/يوم بدل 5 آلاف
  } else if (import.meta.env?.DEV && !warnedNoEmail) {
    warnedNoEmail = true
    console.warn('[translation] VITE_MYMEMORY_EMAIL مش مضبوط: الحد اليومي 5000 حرف بس')
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as MyMemoryResponse
    if (Number(json.responseStatus) !== 200) throw new Error('bad status')
    const out = json.responseData?.translatedText
    if (typeof out !== 'string' || !out.trim() || BAD_OUTPUT_RE.test(out)) {
      throw new Error('bad output')
    }
    return decodeEntities(out)
  } finally {
    clearTimeout(timer)
  }
}

/** بيترجم نص (بيتقسم لو طويل) ويحافظ على المسافات في أول/آخر كل قطعة */
async function translateChunks(text: string, from: ApiLang, to: ApiLang): Promise<string> {
  const chunks = splitIntoChunks(text)
  const out = await Promise.all(
    chunks.map(async (c) => {
      const core = c.trim()
      if (!core || !/\p{L}/u.test(core)) return c
      const lead = c.slice(0, c.length - c.trimStart().length)
      const trail = c.slice(c.trimEnd().length)
      return lead + (await fetchChunk(core, from, to)) + trail
    }),
  )
  return out.join('')
}

/** نص مختلط: بنترجم الأجزاء اللاتينية بس (en→to) ونسيب العربي زي ما هو */
async function translateMixed(text: string, to: ApiLang): Promise<string> {
  const parts: { t: string; ar: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(AR_RUN_RE)) {
    const i = m.index ?? 0
    if (i > last) parts.push({ t: text.slice(last, i), ar: false })
    parts.push({ t: m[0], ar: true })
    last = i + m[0].length
  }
  if (last < text.length) parts.push({ t: text.slice(last), ar: false })

  const out = await Promise.all(
    parts.map((p) =>
      p.ar || !LATIN_CHAR_RE.test(p.t) ? Promise.resolve(p.t) : translateChunks(p.t, 'en', to),
    ),
  )
  return out.join('')
}

// ---------------------------------------------------------------- public API

function cacheFrom(source: DetectedSource): ApiLang {
  return source === 'ar' ? 'ar' : 'en' // المختلط بنترجم جزأه الإنجليزي → 'en'
}

/** قراءة متزامنة من الكاش بس (من غير شبكة) — بيستخدمها الهوك في أول render */
export function peekTranslation(text: string, target: TranslationLang): string | null {
  if (!shouldTranslate(text)) return null
  const source = detectSource(text)
  if (source === 'other') return null
  return getCached(cacheFrom(source), TARGET_API[target], text)
}

/**
 * الترجمة الرئيسية. بترجع دايماً string ومبترميش:
 * أي خطأ شبكة/API/JSON → النص الأصلي (ومن غير ما نكتب الفشل في الكاش).
 * الـ signal بيوقف الانتظار بس؛ الطلب المشترك (dedupe) بيكمل عشان باقي المستخدمين.
 */
export async function translateText(
  text: string,
  targetLang: TranslationLang,
  signal?: AbortSignal,
): Promise<string> {
  try {
    if (signal?.aborted || !shouldTranslate(text)) return text
    const source = detectSource(text)
    if (source === 'other') return text

    const from = cacheFrom(source)
    const to = TARGET_API[targetLang]
    const cached = getCached(from, to, text)
    if (cached !== null) return cached

    const key = buildCacheKey(from, to, text)
    let job = inflight.get(key)
    if (!job) {
      job = (async () => {
        try {
          const result =
            source === 'mixed' ? await translateMixed(text, to) : await translateChunks(text, from, to)
          if (!result.trim()) return text
          setCached(from, to, text, result)
          return result
        } catch {
          return text // Fail-open
        } finally {
          inflight.delete(key)
        }
      })()
      inflight.set(key, job)
    }
    return await job
  } catch {
    return text
  }
}
