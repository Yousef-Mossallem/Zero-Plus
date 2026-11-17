// frontend/src/pages/landing/SitePoliciesPage.tsx
// ==================================================================
// صفحة السياسات (خصوصية / شروط / أمان) بتبويبات (?tab=...).
// المحتوى كله في legal.json كمصفوفات (sections → heading + body/points)،
// فالكود هنا بس بيحدد التبويبات والأيقونات — الترجمة ملفات بس.
// ==================================================================

import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, FileText, LockKeyhole } from 'lucide-react'

import LandingLayout from './LandingLayout'
import { GradientText, PageHero, cardClass } from './LandingShared'

interface PolicySection {
  heading: string
  body?: string
  points?: string[]
}

const POLICIES = [
  { id: 'privacy', icon: ShieldCheck },
  { id: 'terms', icon: FileText },
  { id: 'security', icon: LockKeyhole },
] as const

export default function SitePoliciesPage() {
  const { t } = useTranslation('legal')

  // مفاتيح ديناميكية + returnObjects: بنستخدم نسخة غير مقيّدة بالأنواع هنا فقط
  const tr = t as unknown as (key: string, opts?: object) => unknown

  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const active = POLICIES.find((p) => p.id === tabParam) ?? POLICIES[0]

  const intro = tr(`${active.id}.intro`) as string
  const sections = (tr(`${active.id}.sections`, { returnObjects: true }) ?? []) as PolicySection[]

  return (
    <LandingLayout>
      <PageHero
        title={
          <>
            {t('hero.titleLine')} <GradientText>{t('hero.titleHighlight')}</GradientText>
          </>
        }
        description={t('hero.description')}
      />

      <section className="mx-auto max-w-4xl px-6 py-8">
        <div
          role="tablist"
          className="mb-8 flex flex-wrap gap-2 rounded-2xl border border-white/8 bg-white/3 p-2"
        >
          {POLICIES.map(({ id, icon: Icon }) => {
            const isActive = id === active.id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setParams({ tab: id }, { replace: true })}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.2)]'
                    : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tr(`${id}.label`) as string}</span>
              </button>
            )
          })}
        </div>

        <article className={`${cardClass} p-8`} role="tabpanel">
          <p className="mb-8 leading-relaxed text-slate-300">{intro}</p>

          <div className="space-y-8">
            {sections.map((section) => (
              <div key={section.heading}>
                <h2 className="mb-3 text-lg font-semibold text-white">{section.heading}</h2>

                {section.body && <p className="leading-loose text-slate-400">{section.body}</p>}

                {section.points && (
                  <ul className="space-y-2.5">
                    {section.points.map((point) => (
                      <li key={point} className="flex gap-3 leading-relaxed text-slate-400">
                        <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <p className="mt-10 border-t border-white/6 pt-5 text-xs text-slate-600">
            {t('updated')}
          </p>
        </article>
      </section>
    </LandingLayout>
  )
}