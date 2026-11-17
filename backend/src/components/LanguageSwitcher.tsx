// frontend/src/components/LanguageSwitcher.tsx
// ==================================================================
// زر اختيار اللغة. بيتحط في Navbar و LandingLayout و ProfilePage.
// في صفحات اللاندينج (اللي اللغة في أول رابطها) بيبدّل أول جزء في الرابط كمان.
// className بيتطبق على الغلاف (label)، والـ select بياخد عرضه كله (w-full).
// ==================================================================

import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { LANGUAGES, isSupported, toSupported } from '../i18n/languages'

interface Props {
  className?: string
}

export default function LanguageSwitcher({ className = '' }: Props) {
  const { i18n, t } = useTranslation()
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()

  const current = toSupported(i18n.resolvedLanguage ?? i18n.language)

  const handleChange = (code: string) => {
    // بيتحفظ تلقائياً في localStorage عن طريق الـ detector
    void i18n.changeLanguage(code)

    // لو الرابط الحالي أوله لغة (/ar/about) نبدّلها (/de/about)
    const [, first, ...rest] = pathname.split('/')
    if (isSupported(first)) {
      navigate(`/${[code, ...rest].join('/')}${search}${hash}`, { replace: true })
    }
  }

  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <Globe className="pointer-events-none absolute start-2.5 h-4 w-4 text-slate-400" />

      <select
        aria-label={t('language.label')}
        value={current}
        onChange={(e) => handleChange(e.target.value)}
        className="
          w-full cursor-pointer appearance-none rounded-lg border border-white/10 bg-white/5
          py-1.5 ps-8 pe-3 text-xs font-medium text-slate-200 outline-none
          transition hover:border-white/20
          focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20
        "
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} className="bg-slate-900 text-white">
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}