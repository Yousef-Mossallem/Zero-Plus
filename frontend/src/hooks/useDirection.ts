// frontend/src/hooks/useDirection.ts
// ==================================================================
// بيغير lang و dir على <html> (والخط) كل ما اللغة تتغير.
// بيسمع لحدث languageChanged مباشرة، فمش بيعمل Suspense ومش بيعمل re-render.
// ==================================================================

import { useEffect } from 'react'

import i18n from '../i18n'
import { getLanguage } from '../i18n/languages'

/** بيحمّل ملف خط اللغة مرة واحدة بس (لو اللغة ليها خط خاص) */
function ensureFont(url?: string) {
  if (!url) return
  if (document.querySelector(`link[data-zp-font="${url}"]`)) return

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  link.dataset.zpFont = url
  document.head.appendChild(link)
}

/** بيطبّق اللغة على عنصر الصفحة الرئيسي */
function applyLanguage(code: string) {
  const lang = getLanguage(code)
  const root = document.documentElement

  root.lang = lang?.code ?? 'en'
  root.dir = lang?.dir ?? 'ltr'

  // الخط: --font-sans هو اللي Tailwind (و body) بيقروه
  ensureFont(lang?.fontUrl)
  if (lang?.fontFamily) root.style.setProperty('--font-sans', lang.fontFamily)
  else root.style.removeProperty('--font-sans')
}

export function useDirection() {
  useEffect(() => {
    applyLanguage(i18n.resolvedLanguage ?? i18n.language)

    const onChange = (code: string) => applyLanguage(code)
    i18n.on('languageChanged', onChange)
    return () => {
      i18n.off('languageChanged', onChange)
    }
  }, [])
}