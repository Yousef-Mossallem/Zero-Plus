// frontend/src/pages/landing/LandingLayout.tsx
// ==================================================================
// Zero Plus - Landing Layout
// Header + Footer + Shared Background for all public pages
// ==================================================================
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Shield, Menu, X, Mail, Phone, MapPin } from 'lucide-react'
import { useAuthStore, selectIsAuthenticated } from '../../store/authStore'

// ==================================================================
// Config
// ==================================================================
const NAV_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
  { label: 'Policies', to: '/legal' },
]

const LEGAL_LINKS = [
  { label: 'Privacy Policy', to: '/legal?tab=privacy' },
  { label: 'Terms of Service', to: '/legal?tab=terms' },
  { label: 'Security & Data Isolation', to: '/legal?tab=security' },
]

// ==================================================================
// Logo
// ==================================================================
function Logo() {
  return (
    <Link to="/" className="flex items-center gap-3" aria-label="Zero Plus">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/25">
        <Shield className="h-5 w-5 text-white" strokeWidth={2.2} />
      </div>
      <span className="text-lg font-bold tracking-tight text-white" dir="ltr">
        Zero <span className="text-cyan-400">Plus</span>
      </span>
    </Link>
  )
}

// ==================================================================
// Component
// ==================================================================
export default function LandingLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    window.scrollTo(0, 0)
    setMenuOpen(false)
  }, [pathname])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive
        ? 'bg-cyan-500/10 text-cyan-300'
        : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'
    }`

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#05070f] text-white">
      {/* Background Layers */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-[#0b1224] via-[#05070f] to-[#02040a]" />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.07]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(56, 189, 248, 0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(56, 189, 248, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: '64px 64px',
        }}
      />
      <div className="pointer-events-none fixed -left-40 top-1/4 h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-[120px]" />
      <div className="pointer-events-none fixed -right-40 bottom-1/4 h-[380px] w-[380px] rounded-full bg-indigo-600/15 blur-[110px]" />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/6 bg-[#05070f]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:brightness-110"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-xl px-4 py-2 text-sm font-medium text-slate-300 hover:text-white"
                >
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  className="rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:brightness-110"
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 md:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-white/6 bg-[#070b14] px-6 py-4 md:hidden">
            <nav className="flex flex-col gap-1">
              {NAV_LINKS.map((l) => (
                <NavLink key={l.to} to={l.to} end className={linkClass}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-4 flex gap-2">
              {isAuthenticated ? (
                <Link
                  to="/dashboard"
                  className="flex-1 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 py-2.5 text-center text-sm font-semibold text-white"
                >
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="flex-1 rounded-xl border border-white/10 py-2.5 text-center text-sm font-medium text-slate-200"
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/signup"
                    className="flex-1 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 py-2.5 text-center text-sm font-semibold text-white"
                  >
                    Sign Up
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="relative z-10">{children}</main>

      {/* Footer */}
      <footer className="relative z-10 mt-24 border-t border-white/6 bg-[#04060c]/80">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-4 lg:col-span-1">
            <Logo />
            <p className="text-sm leading-relaxed text-slate-500">
              Smart multi-layer DDoS protection system, built for small and
              medium-sized businesses.
            </p>
          </div>
          <div>
            <h3 className="mb-4 text-sm font-semibold text-white">Pages</h3>
            <ul className="space-y-2.5 text-sm text-slate-400">
              {NAV_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-cyan-300">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-4 text-sm font-semibold text-white">Policies</h3>
            <ul className="space-y-2.5 text-sm text-slate-400">
              {LEGAL_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-cyan-300">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-4 text-sm font-semibold text-white">Contact</h3>
            <ul className="space-y-3 text-sm text-slate-400">
              <li className="flex items-center gap-2.5">
                <Mail className="h-4 w-4 shrink-0 text-cyan-400" />
                <span>example@example.com</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Phone className="h-4 w-4 shrink-0 text-cyan-400" />
                <span>+20 000 000 0000</span>
              </li>
              <li className="flex items-center gap-2.5">
                <MapPin className="h-4 w-4 shrink-0 text-cyan-400" />
                <span>Cairo, Egypt</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/6 py-5 text-center text-xs text-slate-600">
          © {new Date().getFullYear()} Zero Plus. All rights reserved.
        </div>
      </footer>
    </div>
  )
}