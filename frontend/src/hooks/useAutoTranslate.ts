// frontend/src/hooks/useAutoTranslate.ts
// ==================================================================
// Hook للترجمة التلقائية للنصوص الديناميكية
//
// الاستخدام:
//   const translated = useAutoTranslate(text)
//
// بيترجم فقط لو اللغة الحالية zh أو de
// بيرجع النص الأصلي لو en/ar أو حصل خطأ
// ==================================================================

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { translateText } from '../services/translation/myMemoryService'
import { needsTranslation } from '../services/translation/types'

export function useAutoTranslate(text: string | null | undefined): string {
  const { i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  const [translated, setTranslated] = useState<string>(text ?? '')

  useEffect(() => {
    // Reset لو النص اتغير
    setTranslated(text ?? '')

    if (!text || !needsTranslation(lang)) return

    let cancelled = false

    void translateText(text, lang).then((result) => {
      if (!cancelled) setTranslated(result)
    })

    return () => { cancelled = true }
  }, [text, lang])

  return translated
}
