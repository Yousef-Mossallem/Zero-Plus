// frontend/src/hooks/useAutoTranslate.ts
// ترجمة نص ديناميكي (جاي من الباك) تلقائياً لما اللغة تكون zh أو de.
// ar/en → النص الأصلي. بيرجع الأصلي فوراً، وبعدين الترجمة لما توصل.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toSupported } from '../i18n/languages'
import { peekTranslation, shouldTranslate, translateText } from '../services/translation/myMemoryService'
import type { TranslationLang } from '../services/translation/types'

export function useAutoTranslate(text: string | null | undefined): string {
  const { i18n } = useTranslation()
  const lang = toSupported(i18n.language)
  const source = typeof text === 'string' ? text : ''

  const target: TranslationLang | null = lang === 'zh' || lang === 'de' ? lang : null
  const needs = target !== null && shouldTranslate(source)
  const key = `${target ?? ''}|${source}`

  // من الكاش بشكل متزامن: أول render يطلع بالترجمة من غير وميض
  const cached = useMemo(
    () => (needs && target ? peekTranslation(source, target) : null),
    [needs, target, source],
  )

  const [fetched, setFetched] = useState<{ key: string; value: string } | null>(null)

  useEffect(() => {
    if (!needs || !target || cached !== null) return
    let cancelled = false
    const ctrl = new AbortController()
    void translateText(source, target, ctrl.signal).then((value) => {
      if (!cancelled) setFetched({ key, value })
    })
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [needs, target, source, cached, key])

  if (!needs) return source
  if (cached !== null) return cached
  return fetched?.key === key ? fetched.value : source
}

export default useAutoTranslate
