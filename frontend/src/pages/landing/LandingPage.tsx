// frontend/src/pages/landing/LandingPage.tsx
// ==================================================================
// الصفحة الرئيسية للموقع التعريفي — UHD Pro Max Edition
// i18n: كل النصوص من قسم landing.home، والثوابت هنا مفاتيح بس (من غير نصوص).
// الروابط بتاخد اللغة في أولها، والأسهم بتتعكس في العربي.
// كل قسم يحتوي على أشكال ورسوم توضيحية أمنية متخصصة ومتحركة (Bespoke Animated Glyphs)
// ==================================================================

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Layers,
  Fingerprint,
  Network,
  LockKeyhole,
  Zap,
  FileText,
  Check,
  Ban,
  Shield,
  Activity,
  TrendingUp,
  Users,
  Lock,
} from 'lucide-react'

import { toSupported } from '../../i18n/languages'
import { landingPath } from '../../router/paths'
import { useAuthStore, selectIsAuthenticated } from '../../store/authStore'
import LandingLayout from './LandingLayout'
import { GradientText, SectionHeading, cardClass, Reveal } from './LandingShared'
import { useInView } from '../../hooks/useInView'
import { ZeroLogo } from '../../components/ZeroLogo'
import { HeroIllustration } from './HeroIllustration'
import {
  StatIllustrationAttacks,
  StatIllustrationIncrease,
  StatIllustrationThroughput,
  StatIllustrationPassRate,
} from './StatsIllustrations'
import {
  IllustrationTiered,
  IllustrationReputation,
  IllustrationSilent,
  IllustrationFederated,
  IllustrationIsolation,
  IllustrationReports,
} from './FeatureIllustrations'
import { PipelineFlowLine, PipelineStageGlyph } from './PipelineIllustration'
import { ArchitectureBefore, ArchitectureAfter } from './ArchitectureIllustration'
import { SetupFlowRail } from './SetupIllustration'
import { LiveDemoScope } from './LiveDemoIllustration'
import { CtaShieldBackdrop } from './CtaShieldIllustration'

// ============================================================
// ثوابت الإحصائيات مع رسوم متحركة مخصصة لكل بطاقة
// ============================================================
interface StatItem {
  key: 'attacks' | 'increase' | 'largest' | 'passRate'
  value: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  Illustration: React.ComponentType
}

const STATS: StatItem[] = [
  { key: 'attacks',  value: '47.1M',     icon: Activity,   color: 'cyan',    Illustration: StatIllustrationAttacks },
  { key: 'increase', value: '+121%',     icon: TrendingUp, color: 'rose',    Illustration: StatIllustrationIncrease },
  { key: 'largest',  value: '31.4 Tbps', icon: Zap,        color: 'amber',   Illustration: StatIllustrationThroughput },
  { key: 'passRate', value: '~90%',      icon: Users,      color: 'emerald', Illustration: StatIllustrationPassRate },
]

// ============================================================
// ثوابت الميزات مع رسوم توضيحية سيبرانية مخصصة
// ============================================================
type FeatureKey = 'tiered' | 'reputation' | 'silent' | 'federated' | 'isolation' | 'reports'

interface FeatureItem {
  key: FeatureKey
  icon: React.ComponentType<{ className?: string }>
  Illustration: React.ComponentType
}

const FEATURES: FeatureItem[] = [
  { key: 'tiered',      icon: Layers,      Illustration: IllustrationTiered },
  { key: 'reputation',  icon: Fingerprint, Illustration: IllustrationReputation },
  { key: 'silent',      icon: Zap,         Illustration: IllustrationSilent },
  { key: 'federated',   icon: Network,     Illustration: IllustrationFederated },
  { key: 'isolation',   icon: LockKeyhole, Illustration: IllustrationIsolation },
  { key: 'reports',     icon: FileText,    Illustration: IllustrationReports },
]

// أسماء المراحل أسماء تقنية (بتفضل بالإنجليزي)، والدور بس هو اللي بيتترجم
const PIPELINE = [
  { key: 'intake', name: 'Intake Classifier' },
  { key: 'baseline', name: 'Baseline Verifier' },
  { key: 'ipScanner', name: 'IP Reputation Scanner' },
  { key: 'similarity', name: 'Similarity Matcher' },
  { key: 'deep', name: 'Deep Comparison Engine' },
  { key: 'fingerprint', name: 'Fingerprint Authenticator' },
  { key: 'orchestrator', name: 'Traffic Orchestrator' },
  { key: 'dashboard', name: 'Adaptive Dashboard Engine' },
  { key: 'isolation', name: 'Isolation & Immunity Manager' },
] as const

const STEPS = ['create', 'addServer', 'dns', 'verify', 'live'] as const

const DEMO_ROWS = [
  { key: 'newVisitor', allowed: true },
  { key: 'lowReputation', allowed: true },
  { key: 'datacenterIp', allowed: false },
  { key: 'federated', allowed: false },
] as const

// ============================================================
// Animated Demo Card (قائمة المحاكاة الحية)
// ============================================================
function LiveDemoCard() {
  const { t } = useTranslation('landing')
  const [activeRow, setActiveRow] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setActiveRow((p) => (p + 1) % DEMO_ROWS.length), 2200)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={`${cardClass} relative flex h-full flex-col justify-between overflow-hidden p-6 shadow-xl shadow-black/30`}>
      {/* Top accent line — ثابتة وناعمة */}
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/40 to-transparent" />

      <div>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-semibold text-white">{t('home.demo.title')}</h2>
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="relative h-2 w-2">
              <span className="absolute inset-0 h-2 w-2 rounded-full bg-emerald-400 animate-ping opacity-60" />
              <span className="relative block h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            {t('home.demo.active')}
          </span>
        </div>

        <ul className="space-y-3">
          {DEMO_ROWS.map((row, i) => (
            <li
              key={row.key}
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition-all duration-500 ${
                i === activeRow
                  ? 'border-cyan-500/40 bg-cyan-500/8 scale-[1.01]'
                  : 'border-white/6 bg-white/2'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {i === activeRow && (
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                )}
                <span className="text-slate-300">{t(`home.demo.rows.${row.key}` as never)}</span>
              </div>
              <span
                className={`flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all duration-300 ${
                  row.allowed
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-rose-500/10 text-rose-400'
                } ${i === activeRow ? 'ring-1 ring-inset ring-current' : ''}`}
              >
                {row.allowed ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                {row.allowed ? t('home.demo.allow') : t('home.demo.block')}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Progress bar */}
      <div className="mt-6 h-0.5 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full bg-linear-to-r from-cyan-400 via-emerald-400 to-blue-500 transition-all duration-300"
          style={{ width: `${((activeRow + 1) / DEMO_ROWS.length) * 100}%` }}
        />
      </div>
    </div>
  )
}

// ============================================================
// Stat Card with Dedicated Animated SVG Telemetry
// ============================================================
function StatCard({ stat, index }: { stat: StatItem; index: number }) {
  const { t } = useTranslation('landing')
  const [ref, inView] = useInView<HTMLDivElement>()
  const Icon = stat.icon
  const Illustration = stat.Illustration

  const colorMap: Record<string, string> = {
    cyan:    'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    rose:    'text-rose-400 bg-rose-500/10 border-rose-500/20',
    amber:   'text-amber-400 bg-amber-500/10 border-amber-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  }

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${index * 90}ms` }}
      className={`group ${cardClass} relative flex flex-col justify-between overflow-hidden p-6 transition-all duration-700 hover:border-cyan-500/30 ${
        inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
    >
      {/* Subtle hover gradient */}
      <div className="absolute inset-0 bg-linear-to-br from-white/[0.015] to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${colorMap[stat.color]}`}>
            <Icon className="h-5 w-5" />
          </div>
          {/* Subtle live pulse badge */}
          <span className="flex h-2 w-2 rounded-full bg-cyan-400/60 animate-pulse" />
        </div>

        <p className="text-3xl font-extrabold tracking-tight text-white" dir="ltr">
          {stat.value}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          {t(`home.stats.items.${stat.key}` as never)}
        </p>
      </div>

      {/* Dedicated Animated Micro-Illustration */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <Illustration />
      </div>
    </div>
  )
}

// ============================================================
// Feature Card with Bespoke Cybersecurity Glyph
// ============================================================
function FeatureCard({
  icon: Icon,
  illustration: Illustration,
  featureKey,
  index,
}: {
  icon: React.ComponentType<{ className?: string }>
  illustration: React.ComponentType
  featureKey: FeatureKey
  index: number
}) {
  const { t } = useTranslation('landing')
  const [ref, inView] = useInView<HTMLDivElement>()
  const [hovered, setHovered] = useState(false)

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ transitionDelay: `${index * 80}ms` }}
      className={`group ${cardClass} relative flex cursor-default flex-col justify-between overflow-hidden p-6 transition-all duration-700 hover:border-cyan-500/30 hover:shadow-xl hover:shadow-cyan-500/5 ${
        inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
    >
      {/* Hover background */}
      <div
        className={`absolute inset-0 bg-linear-to-br from-cyan-500/5 via-indigo-600/3 to-transparent transition-opacity duration-500 ${
          hovered ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Top glowing accent line on hover */}
      <div
        className={`absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent transition-opacity duration-500 ${
          hovered ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div>
        {/* Custom Animated SVG Glyph at Top */}
        <div className={`mb-4 flex items-center justify-between transition-transform duration-300 ${hovered ? '-translate-y-1' : ''}`}>
          <Illustration />
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/8 bg-white/3 text-cyan-400">
            <Icon className="h-4 w-4" />
          </div>
        </div>

        {/* Title */}
        <h3 className="mb-2 text-base font-bold text-white transition-colors group-hover:text-cyan-200">
          {t(`home.features.items.${featureKey}.title` as never)}
        </h3>

        {/* Description */}
        <p className="text-sm leading-relaxed text-slate-400">
          {t(`home.features.items.${featureKey}.desc` as never)}
        </p>
      </div>

      {/* Bottom indicator badge */}
      <div className="mt-4 flex items-center gap-1.5 text-[11px] font-mono text-slate-500 transition-colors group-hover:text-cyan-400/80">
        <span>●</span>
        <span>Active Shield Module</span>
      </div>
    </div>
  )
}

// ============================================================
// Pipeline Step with Specialized Stage Glyph
// ============================================================
function PipelineStep({
  step,
  index,
  total,
}: {
  step: (typeof PIPELINE)[number]
  index: number
  total: number
}) {
  const { t } = useTranslation('landing')
  const [ref, inView] = useInView<HTMLLIElement>()

  return (
    <li
      ref={ref}
      style={{ transitionDelay: `${index * 60}ms` }}
      className={`group ${cardClass} relative flex gap-4 p-5 transition-all duration-700 hover:border-cyan-500/40 hover:bg-[#070e1c]/80 ${
        inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
    >
      {/* Number badge */}
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-cyan-500 to-blue-600 text-sm font-bold text-white shadow-lg shadow-cyan-500/25">
        {index + 1}
        {index < total - 1 && (
          <span className="absolute -bottom-5 left-1/2 h-5 w-px -translate-x-1/2 bg-linear-to-b from-cyan-400/40 to-transparent" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          {/* Micro-Glyph Specialized for this specific Stage */}
          <PipelineStageGlyph stageKey={step.key} />
          <h3 className="truncate text-sm font-semibold text-white" dir="ltr">
            {step.name}
          </h3>
        </div>
        <p className="text-xs leading-relaxed text-slate-400">
          {t(`home.pipeline.roles.${step.key}` as never)}
        </p>
      </div>
    </li>
  )
}

// ============================================================
// Main Landing Page Component
// ============================================================
export default function LandingPage() {
  const { t, i18n } = useTranslation('landing')
  const isAuthenticated = useAuthStore(selectIsAuthenticated)

  const lng = toSupported(i18n.resolvedLanguage ?? i18n.language)

  const ctaTo = isAuthenticated ? '/dashboard' : '/signup'
  const ctaLabel = isAuthenticated ? t('home.hero.ctaDashboard') : t('home.hero.ctaStart')

  return (
    <LandingLayout>
      {/* ====================== HERO SECTION ====================== */}
      <section className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 pb-24 pt-16 lg:grid-cols-2 lg:pt-28">
        {/* Ambient atmospheric glow */}
        <div className="pointer-events-none absolute -top-20 left-1/4 h-[520px] w-[520px] rounded-full bg-cyan-500/6 blur-[130px]" />

        <div className="relative space-y-7">
          {/* Trust Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/8 px-4 py-1.5 text-[11px] font-medium tracking-wide text-cyan-300 zp-anim-fade-up">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Zero-Trust Next-Generation DDoS Shield
          </div>

          <h1
            className="break-words text-4xl font-extrabold leading-[1.15] tracking-tight text-white sm:text-5xl xl:text-6xl zp-anim-fade-up"
            style={{ animationDelay: '0.1s' }}
          >
            {t('home.hero.titleLine')}
            <span className="mt-2 block">
              <GradientText>{t('home.hero.titleHighlight')}</GradientText>
            </span>
          </h1>

          <p
            className="max-w-xl text-lg leading-relaxed text-slate-400 zp-anim-fade-up"
            style={{ animationDelay: '0.2s' }}
          >
            {t('home.hero.description')}
          </p>

          <div className="flex flex-wrap gap-3 zp-anim-fade-up" style={{ animationDelay: '0.3s' }}>
            <Link
              to={ctaTo}
              className="group relative flex items-center gap-2 overflow-hidden rounded-xl bg-linear-to-r from-cyan-500 via-blue-600 to-indigo-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition-all hover:shadow-cyan-500/50 hover:brightness-110"
            >
              <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              {ctaLabel}
              <ArrowRight className="h-4 w-4 transition-transform rtl:rotate-180 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
            </Link>
            <Link
              to={landingPath(lng, 'about')}
              className="rounded-xl border border-white/10 bg-white/4 px-7 py-3.5 text-sm font-medium text-slate-200 backdrop-blur-sm transition-all hover:border-white/20 hover:bg-white/8"
            >
              {t('home.hero.learnMore')}
            </Link>
          </div>

          {/* Trust indicators */}
          <div
            className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400 zp-anim-fade-up"
            style={{ animationDelay: '0.4s' }}
          >
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-cyan-400" />
              SOC 2 Certified Ready
            </span>
            <span className="h-3 w-px bg-white/10" />
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-cyan-400" />
              Zero-Trust Architecture
            </span>
            <span className="h-3 w-px bg-white/10" />
            <span className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-cyan-400" />
              Sub-1ms Mitigation Latency
            </span>
          </div>
        </div>

        {/* Hero Autonomous Scrubbing Matrix Illustration */}
        <div className="relative zp-anim-fade-up" style={{ animationDelay: '0.2s' }}>
          <HeroIllustration />
        </div>
      </section>

      {/* ====================== STATS SECTION ====================== */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <SectionHeading
          badge="By the numbers"
          title={t('home.stats.title')}
          description={t('home.stats.description')}
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <StatCard key={s.key} stat={s} index={i} />
          ))}
        </div>
      </section>

      {/* ====================== FEATURES SECTION ====================== */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <SectionHeading
          badge="Core Capabilities"
          title={t('home.features.title')}
          description={t('home.features.description')}
        />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon, key, Illustration }, i) => (
            <FeatureCard
              key={key}
              icon={icon}
              illustration={Illustration}
              featureKey={key}
              index={i}
            />
          ))}
        </div>
      </section>

      {/* ====================== LIVE DEMO SECTION ====================== */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <SectionHeading
          badge="Real-Time Telemetry"
          title={t('home.demo.title')}
        />
        <Reveal>
          <div className="grid gap-6 md:grid-cols-2 items-stretch">
            <LiveDemoCard />
            <LiveDemoScope />
          </div>
        </Reveal>
      </section>

      {/* ====================== DETECTION PIPELINE ====================== */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <SectionHeading
          badge="Detection Pipeline"
          title={t('home.pipeline.title')}
          description={t('home.pipeline.description')}
        />
        {/* High-speed Optical Data Bus */}
        <PipelineFlowLine />

        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((p, i) => (
            <PipelineStep key={p.key} step={p} index={i} total={PIPELINE.length} />
          ))}
        </ol>
      </section>

      {/* ====================== ARCHITECTURE (BEFORE / AFTER) ====================== */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <SectionHeading
          badge="Architecture Comparison"
          title={t('home.flow.title')}
          description={t('home.flow.description')}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <Reveal>
            <ArchitectureBefore />
          </Reveal>
          <Reveal delay={150}>
            <ArchitectureAfter />
          </Reveal>
        </div>
      </section>

      {/* ====================== QUICK SETUP (STEPS) ====================== */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <SectionHeading badge="Quick Setup" title={t('home.steps.title')} />

        {/* 3-Minute Setup Visual Rail */}
        <SetupFlowRail />

        <ol className="grid gap-4 md:grid-cols-5">
          {STEPS.map((key, i) => (
            <Reveal key={key} delay={i * 80}>
              <li className={`${cardClass} flex h-full flex-col justify-between p-5 transition-all duration-300 hover:border-cyan-500/30`}>
                <div>
                  <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-sm font-bold text-cyan-300">
                    {i + 1}
                  </span>
                  <h3 className="mb-1.5 text-sm font-semibold text-white">
                    {t(`home.steps.items.${key}.title` as never)}
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-400">
                    {t(`home.steps.items.${key}.desc` as never)}
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-1 text-[11px] font-mono text-emerald-400/80">
                  <span>✓</span>
                  <span>Instant verify</span>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ====================== FINAL CTA ====================== */}
      <section className="mx-auto max-w-4xl px-6 pb-20 pt-8">
        <Reveal>
          <div className={`${cardClass} relative overflow-hidden px-8 py-20 text-center shadow-2xl`}>
            {/* Top & bottom glowing border lines */}
            <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/70 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-transparent via-indigo-500/40 to-transparent" />

            {/* Orbital Shield Backdrop Animation */}
            <CtaShieldBackdrop />

            {/* Zero-Plus Master Logo */}
            <div className="relative mx-auto mb-6 flex justify-center">
              <ZeroLogo size={68} glow variant="gradient" animated />
            </div>

            <h2 className="relative text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              {t('home.cta.title')}
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-base text-slate-400">
              {t('home.cta.description')}
            </p>

            <div className="relative mt-8 flex flex-wrap justify-center gap-4">
              <Link
                to={ctaTo}
                className="group relative flex items-center gap-2 overflow-hidden rounded-xl bg-linear-to-r from-cyan-500 via-blue-600 to-indigo-600 px-8 py-4 text-sm font-bold text-white shadow-lg shadow-cyan-500/30 transition-all hover:shadow-cyan-500/50 hover:brightness-110"
              >
                <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                {ctaLabel}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
              <Link
                to={landingPath(lng, 'contact')}
                className="rounded-xl border border-white/12 bg-white/4 px-8 py-4 text-sm font-semibold text-slate-200 backdrop-blur-sm transition-all hover:border-white/25 hover:bg-white/8"
              >
                {t('home.cta.contact')}
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </LandingLayout>
  )
}
