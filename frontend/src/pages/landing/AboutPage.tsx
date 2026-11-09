// frontend/src/pages/landing/AboutPage.tsx
// ==================================================================
// صفحة "من نحن". النصوص من قسم landing.about، والرابط بياخد اللغة.
// ==================================================================

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Eye, Target, Scale, Scan, Users, EyeOff, Cpu, MessageSquareText } from 'lucide-react'

import { toSupported } from '../../i18n/languages'
import { landingPath } from '../../router/paths'
import LandingLayout from './LandingLayout'
import { GradientText, PageHero, SectionHeading, cardClass } from './LandingShared'

const PRINCIPLES = [
  { key: 'clear', icon: EyeOff },
  { key: 'fair', icon: Scale },
  { key: 'heavy', icon: Scan },
  { key: 'privacy', icon: Users },
] as const

// أسماء التقنيات بتفضل بالإنجليزي (LTR). وصف الـ IoT بس هو اللي بيتترجم.
const STACK = [
  { layer: 'Frontend', items: 'React, TypeScript, Vite, Tailwind CSS, Zustand, Recharts' },
  { layer: 'Backend', items: 'Node.js, Express, TypeScript, Socket.io, Zod' },
  { layer: 'Infrastructure', items: 'Docker, Nginx, PostgreSQL, Redis' },
  { layer: 'IoT Simulation', items: null },
] as const

export default function AboutPage() {
  const { t, i18n } = useTranslation('landing')
  const lng = toSupported(i18n.resolvedLanguage ?? i18n.language)

  return (
    <LandingLayout>
      <PageHero
        title={
          <>
            {t('about.hero.titleLine')} <GradientText>{t('about.hero.titleHighlight')}</GradientText>
          </>
        }
        description={t('about.hero.description')}
      />

      <section className="mx-auto grid max-w-5xl gap-5 px-6 py-8 md:grid-cols-2">
        <div className={`${cardClass} p-7`}>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Eye className="h-5 w-5" />
          </div>
          <h2 className="mb-3 text-xl font-bold text-white">{t('about.vision.title')}</h2>
          <p className="leading-relaxed text-slate-400">{t('about.vision.text')}</p>
        </div>

        <div className={`${cardClass} p-7`}>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Target className="h-5 w-5" />
          </div>
          <h2 className="mb-3 text-xl font-bold text-white">{t('about.mission.title')}</h2>
          <p className="leading-relaxed text-slate-400">{t('about.mission.text')}</p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-16">
        <SectionHeading title={t('about.why.title')} />

        <div className={`${cardClass} space-y-5 p-8 leading-loose text-slate-300`}>
          <p>{t('about.why.p1')}</p>
          <p>{t('about.why.p2')}</p>
          <p>{t('about.why.p3')}</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionHeading title={t('about.principles.title')} />
        <div className="grid gap-5 md:grid-cols-2">
          {PRINCIPLES.map(({ icon: Icon, key }) => (
            <div key={key} className={`${cardClass} flex gap-4 p-6`}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="mb-1.5 font-semibold text-white">
                  {t(`about.principles.items.${key}.title`)}
                </h3>
                <p className="text-sm leading-relaxed text-slate-400">
                  {t(`about.principles.items.${key}.desc`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHeading
          title={t('about.deciders.title')}
          description={t('about.deciders.description')}
        />
        <div className="grid gap-5 md:grid-cols-2">
          <div className={`${cardClass} border-cyan-500/30 p-7`}>
            <div className="mb-4 flex items-center gap-3">
              <Cpu className="h-5 w-5 text-cyan-400" />
              <h3 className="font-semibold text-white">{t('about.deciders.engine.title')}</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-400">
              {t('about.deciders.engine.desc')}
            </p>
          </div>

          <div className={`${cardClass} p-7`}>
            <div className="mb-4 flex items-center gap-3">
              <MessageSquareText className="h-5 w-5 text-slate-400" />
              <h3 className="font-semibold text-white">{t('about.deciders.gemini.title')}</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-400">
              {t('about.deciders.gemini.desc')}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-16">
        <SectionHeading title={t('about.stack.title')} />
        <div className={`${cardClass} divide-y divide-white/6`}>
          {STACK.map((s) => (
            <div
              key={s.layer}
              className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-center sm:gap-6"
            >
              <span className="w-40 shrink-0 font-semibold text-cyan-300" dir="ltr">
                {s.layer}
              </span>
              {/* التقنيات LTR، ووصف الـ IoT مترجم (dir=auto) */}
              <span dir="auto" className="text-sm text-slate-400">
                {s.items ?? t('about.stack.iot')}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pt-8 text-center">
        <p className="text-slate-400">{t('about.cta.question')}</p>
        <Link
          to={landingPath(lng, 'contact')}
          className="mt-5 inline-block rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:brightness-110"
        >
          {t('about.cta.contact')}
        </Link>
      </section>
    </LandingLayout>
  )
}