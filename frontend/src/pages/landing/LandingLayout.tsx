// frontend/src/pages/landing/LandingLayout.tsx
// ==================================================================
// هيكل صفحات الموقع التعريفي — UHD Pro Max Edition
// هيدر + فوتر + خلفية particle + كل الأنيميشن
// i18n: النصوص من قسم nav.landing، والروابط بتاخد اللغة في أولها (/ar/about)،
// وفيه زر اللغة، والاتجاه بييجي من <html> (شلنا dir="ltr" الثابت).
// ==================================================================

import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu, X, Mail, Phone, MapPin, ArrowUpRight } from 'lucide-react'

import { ZeroLogo } from '../../components/ZeroLogo'

import LanguageSwitcher from '../../components/LanguageSwitcher'
import { toSupported } from '../../i18n/languages'
import { landingPath, type LandingPage } from '../../router/paths'
import { useAuthStore, selectIsAuthenticated } from '../../store/authStore'

// مفاتيح الترجمة + الصفحة (من غير نصوص)
const NAV_LINKS: { key: 'home' | 'about' | 'contact' | 'policies'; page: LandingPage }[] = [
  { key: 'home', page: '' },
  { key: 'about', page: 'about' },
  { key: 'contact', page: 'contact' },
  { key: 'policies', page: 'legal' },
]

const LEGAL_LINKS = ['privacy', 'terms', 'security'] as const

// ============================================================
// Particle Field — 12 جسيم خفيف فوق الخلفية
// ============================================================
const PARTICLE_DATA = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  size: ((i * 11) % 2) + 1.5,
  left: (i * 41 + 7) % 100,
  top: (i * 67 + 13) % 100,
  color:
    i % 3 === 0
      ? 'rgba(56,189,248,0.35)'
      : i % 3 === 1
      ? 'rgba(99,102,241,0.3)'
      : 'rgba(0,245,160,0.28)',
  dur: 10 + (i % 8),
  delay: (i * 1.3) % 9,
  tx: ((i % 5) - 2) * 14,
}))

function ParticleField() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {PARTICLE_DATA.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full"
          style={{
            width: `${p.size}px`,
            height: `${p.size}px`,
            left: `${p.left}%`,
            top: `${p.top}%`,
            background: p.color,
            animation: `zp-particle-rise ${p.dur}s ${p.delay}s ease-in-out infinite`,
            ['--tx' as string]: `${p.tx}px`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  )
}

// ============================================================
// Scene Background — aurora + grid + orbs
// ============================================================
function SceneBackground() {
  return (
    <>
      {/* Base dark gradient */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[#060810]" />

      {/* Aurora nebula — تدرج لوني بطيء */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.55]"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 15% 10%,  rgba(14, 30, 64, 0.9)  0%, transparent 70%),
            radial-gradient(ellipse 70% 50% at 90% 15%,  rgba(16, 10, 50, 0.8)  0%, transparent 65%),
            radial-gradient(ellipse 60% 70% at 50% 95%,  rgba(6,  25, 50, 0.7)  0%, transparent 70%),
            radial-gradient(ellipse 90% 40% at 20% 55%,  rgba(5,  40, 60, 0.5)  0%, transparent 60%)
          `,
          backgroundSize: '200% 200%',
          animation: 'zp-aurora 22s ease infinite',
        }}
      />

      {/* Subtle cyan grid — خفيف جداً */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.028]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(56,189,248,0.8) 1px, transparent 1px),
            linear-gradient(90deg, rgba(56,189,248,0.8) 1px, transparent 1px)
          `,
          backgroundSize: '72px 72px',
          animation: 'zp-mesh-drift 90s linear infinite',
        }}
      />

      {/* Scan line — خلف كل شيء (z-0) وخفيف جداً */}
      <div
        className="pointer-events-none fixed inset-x-0 z-0 h-px bg-linear-to-r from-transparent via-cyan-400/8 to-transparent"
        style={{ animation: 'zp-line-scan 14s linear infinite' }}
      />

      {/* Glow orbs — تتحرك ببطء */}
      <div
        className="pointer-events-none fixed -start-32 top-[20%] z-0 h-[520px] w-[520px] rounded-full bg-cyan-500/[0.055] blur-[150px]"
        style={{ animation: 'zp-glow-drift 18s ease-in-out infinite' }}
      />
      <div
        className="pointer-events-none fixed -end-32 bottom-[15%] z-0 h-[440px] w-[440px] rounded-full bg-indigo-600/[0.07] blur-[130px]"
        style={{ animation: 'zp-glow-drift 24s ease-in-out infinite reverse', animationDelay: '6s' }}
      />
      <div
        className="pointer-events-none fixed left-1/2 top-[55%] z-0 h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-blue-800/[0.06] blur-[120px]"
        style={{ animation: 'zp-glow-drift 20s ease-in-out infinite', animationDelay: '10s' }}
      />
    </>
  )
}

// ============================================================
// Logo — الشعار الجديد (ZeroLogo SVG + Wordmark)
// ============================================================
function Logo({ to }: { to: string }) {
  return (
    <Link to={to} className="group flex items-center gap-2.5" aria-label="Zero Plus">
      <ZeroLogo size={34} glow className="transition-all duration-500 group-hover:scale-110" />
      {/* اسم المنتج بيفضل بالحروف اللاتينية في كل اللغات */}
      <span className="text-[15px] font-bold tracking-tight text-white" dir="ltr">
        Zero<span className="text-cyan-400">Plus</span>
      </span>
    </Link>
  )
}

// ============================================================
// Main Layout
// ============================================================
export default function LandingLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { t, i18n } = useTranslation('nav')
  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // اللغة الحالية: بتتحط في أول كل رابط
  const lng = toSupported(i18n.resolvedLanguage ?? i18n.language)
  const homePath = landingPath(lng)

  useEffect(() => {
    window.scrollTo(0, 0)
    setMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `relative rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
      isActive
        ? 'bg-cyan-500/10 text-cyan-300 after:absolute after:inset-x-2 after:bottom-0.5 after:h-px after:bg-cyan-400/60'
        : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'
    }`

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#060810] text-white">
      {/* Background layers — z-0, خلف كل شيء */}
      <SceneBackground />
      <ParticleField />

      {/* Header */}
      <header
        className={`sticky top-0 z-40 border-b transition-all duration-300 ${
          scrolled
            ? 'border-cyan-500/10 bg-[#05070f]/90 shadow-lg shadow-black/40 backdrop-blur-2xl'
            : 'border-white/5 bg-[#05070f]/60 backdrop-blur-xl'
        }`}
      >
        {/* Top accent line */}
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/40 to-transparent" />

        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Logo to={homePath} />

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((l) => (
              <NavLink key={l.key} to={landingPath(lng, l.page)} end className={linkClass}>
                {t(`landing.links.${l.key}`)}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <LanguageSwitcher />
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="group flex items-center gap-1.5 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition-all hover:shadow-cyan-500/50 hover:scale-105 hover:brightness-110"
              >
                {t('landing.auth.dashboard')}
                <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-xl px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-white/5"
                >
                  {t('landing.auth.login')}
                </Link>
                <Link
                  to="/signup"
                  className="group flex items-center gap-1.5 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition-all hover:shadow-cyan-500/50 hover:scale-105 hover:brightness-110"
                >
                  {t('landing.auth.signup')}
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('landing.menu')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:bg-white/5 hover:border-white/20 md:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-white/6 bg-[#070b14]/95 px-6 py-4 backdrop-blur-xl md:hidden">
            <nav className="flex flex-col gap-1">
              {NAV_LINKS.map((l) => (
                <NavLink key={l.key} to={landingPath(lng, l.page)} end className={linkClass}>
                  {t(`landing.links.${l.key}`)}
                </NavLink>
              ))}
            </nav>
            <LanguageSwitcher className="mt-4 w-full" />
            <div className="mt-4 flex gap-2">
              {isAuthenticated ? (
                <Link
                  to="/dashboard"
                  className="flex-1 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 py-2.5 text-center text-sm font-semibold text-white"
                >
                  {t('landing.auth.dashboard')}
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="flex-1 rounded-xl border border-white/10 py-2.5 text-center text-sm font-medium text-slate-200 hover:bg-white/5"
                  >
                    {t('landing.auth.login')}
                  </Link>
                  <Link
                    to="/signup"
                    className="flex-1 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 py-2.5 text-center text-sm font-semibold text-white"
                  >
                    {t('landing.auth.signup')}
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="relative z-10">{children}</main>

      {/* Footer */}
      <footer className="relative z-10 mt-24 border-t border-white/6 bg-[#04060c]/80 backdrop-blur-xl">
        {/* Top accent */}
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/30 to-transparent" />

        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-4 lg:col-span-1">
            <Logo to={homePath} />
            <p className="text-sm leading-relaxed text-slate-500">
              {t('landing.footer.tagline')}
            </p>
            {/* Status badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-3 py-1 text-xs text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              All Systems Operational
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold text-white">{t('landing.footer.pages')}</h3>
            <ul className="space-y-2.5 text-sm text-slate-400">
              {NAV_LINKS.map((l) => (
                <li key={l.key}>
                  <Link
                    to={landingPath(lng, l.page)}
                    className="group inline-flex items-center gap-1 transition-colors hover:text-cyan-300"
                  >
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-cyan-400">›</span>
                    {t(`landing.links.${l.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold text-white">{t('landing.footer.legal')}</h3>
            <ul className="space-y-2.5 text-sm text-slate-400">
              {LEGAL_LINKS.map((tab) => (
                <li key={tab}>
                  {/* ?tab=... بتختار التبويب جوه صفحة السياسات */}
                  <Link
                    to={`${landingPath(lng, 'legal')}?tab=${tab}`}
                    className="group inline-flex items-center gap-1 transition-colors hover:text-cyan-300"
                  >
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-cyan-400">›</span>
                    {t(`landing.footer.legalLinks.${tab}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold text-white">{t('landing.footer.contact')}</h3>
            <ul className="space-y-3 text-sm text-slate-400">
              <li className="group flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 transition-colors group-hover:bg-cyan-500/20">
                  <Mail className="h-3.5 w-3.5" />
                </div>
                {/* الإيميل والتليفون دايماً LTR */}
                <span dir="ltr" className="transition-colors group-hover:text-slate-300">example@example.com</span>
              </li>
              <li className="group flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 transition-colors group-hover:bg-cyan-500/20">
                  <Phone className="h-3.5 w-3.5" />
                </div>
                <span dir="ltr" className="transition-colors group-hover:text-slate-300">+20 000 000 0000</span>
              </li>
              <li className="group flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 transition-colors group-hover:bg-cyan-500/20">
                  <MapPin className="h-3.5 w-3.5" />
                </div>
                <span className="transition-colors group-hover:text-slate-300">{t('landing.footer.address')}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/6 py-5 text-center text-xs text-slate-600">
          {t('landing.footer.rights', { year: new Date().getFullYear() })}
        </div>
      </footer>
    </div>
  )
}
