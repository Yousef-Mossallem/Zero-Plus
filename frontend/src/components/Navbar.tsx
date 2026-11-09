// frontend/src/components/Navbar.tsx
// ==================================================================
// Zero Plus - Navigation (Command Sidebar)
// منظم • احترافي • مناسب لعدد صفحات كبير
// i18n: النصوص من قسم nav، والشريط بيتقلب لليمين تلقائياً في العربي
// (start/end بدل left/right + عكس أسهم الطي).
// ==================================================================

import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  FlaskConical,
  ShieldAlert,
  FileText,
  Fingerprint,
  Server,
  Building2,
  Bell,
  SlidersHorizontal,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  UserRound,
} from 'lucide-react'

// import Logo from './Logo'
import NotificationBell from './NotificationBell'
import LanguageSwitcher from './LanguageSwitcher'
import {
  useAuthStore,
  selectCurrentUser,
  selectCurrentOrganization,
} from '../store/authStore'

// ==================================================================
// Nav Config
// بنخزن مفاتيح الترجمة (بتوصف الوظيفة) والمكوّن هو اللي يترجمها
// ==================================================================

const NAV_GROUPS = [
  {
    titleKey: 'overview',
    items: [
      { labelKey: 'dashboard', path: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    titleKey: 'security',
    items: [
      { labelKey: 'securityEvents', path: '/security-events', icon: ShieldAlert },
      { labelKey: 'reputation', path: '/reputation', icon: Fingerprint },
      { labelKey: 'simulation', path: '/simulation', icon: FlaskConical },
    ],
  },
  {
    titleKey: 'infrastructure',
    items: [
      { labelKey: 'servers', path: '/servers', icon: Server },
      { labelKey: 'policies', path: '/policies', icon: SlidersHorizontal },
      { labelKey: 'reports', path: '/reports', icon: FileText },
    ],
  },
  {
    titleKey: 'workspace',
    items: [
      { labelKey: 'organization', path: '/organizations', icon: Building2 },
      { labelKey: 'notifications', path: '/notifications', icon: Bell },
      { labelKey: 'profile', path: '/profile', icon: UserRound },
    ],
  },
] as const

// ==================================================================
// Component
// ==================================================================

export default function Navbar() {
  const navigate = useNavigate()
  const { t } = useTranslation('nav')

  const user = useAuthStore(selectCurrentUser)
  const organization = useAuthStore(selectCurrentOrganization)
  const logout = useAuthStore((s) => s.logout)

  const userName = user?.fullName ?? t('user.fallback')
  const profileInitials = (user?.fullName ?? 'User')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const sidebarWidth = collapsed ? 'w-[76px]' : 'w-[260px]'

  // ----------------------------------------------------------------
  // Shared nav list
  // ----------------------------------------------------------------

  const NavContent = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div
        className={`
          flex h-16 shrink-0 items-center border-b border-white/6
          ${collapsed ? 'justify-center px-2' : 'gap-3 px-5'}
        `}
      >
        {/* <Logo className="h-8 w-8 shrink-0" /> */}
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-white" dir="ltr">
              Zero<span className="text-cyan-400">Plus</span>
            </p>
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
              {t('brand.tagline')}
            </p>
          </div>
        )}
        {/* جرس الإشعارات + badge غير المقروء (لحظي) */}
        <NotificationBell className={collapsed ? '' : 'ms-auto'} />
      </div>

      {/* Groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        <div className="space-y-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.titleKey}>
              {!collapsed && (
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
                  {t(`groups.${group.titleKey}`)}
                </p>
              )}
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const label = t(`items.${item.labelKey}`)
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        onClick={onNavigate}
                        title={collapsed ? label : undefined}
                        className={({ isActive }) =>
                          `
                          group relative flex items-center gap-3 rounded-xl px-3 py-2.5
                          text-sm font-medium transition-all duration-200
                          ${
                            isActive
                              ? 'bg-cyan-500/10 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.2)]'
                              : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'
                          }
                          ${collapsed ? 'justify-center' : ''}
                        `
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {/* شريط الصفحة النشطة: بيبقى على بداية السطر (شمال/يمين) */}
                            {isActive && (
                              <span className="absolute start-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-cyan-400" />
                            )}
                            <Icon
                              className={`h-4.5 w-4.5 shrink-0 ${
                                isActive ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'
                              }`}
                            />
                            {!collapsed && <span className="truncate">{label}</span>}
                          </>
                        )}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* User + Logout */}
      <div className="shrink-0 border-t border-white/6 p-3">
        {/* زر اللغة (مخفي لما الشريط مطوي لأنه ضيق) */}
        {!collapsed && <LanguageSwitcher className="mb-2 w-full" />}

        <div
          className={`mb-2 flex items-center rounded-xl border border-white/5 bg-white/2 px-2 py-2.5 ${
            collapsed ? 'justify-center' : 'gap-3 px-3'
          }`}
          title={collapsed ? userName : undefined}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-500/10 text-xs font-bold text-cyan-300">
            {profileInitials || 'U'}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate text-sm font-medium text-white">
                {userName}
              </p>
              <p dir="auto" className="truncate text-[11px] text-slate-500">
                {organization?.name ?? t('user.organizationFallback')}
              </p>
              {user?.role && (
                <span className="mt-1.5 inline-block rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                  {user.role}
                </span>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleLogout}
          title={collapsed ? t('signOut') : undefined}
          className={`
            flex w-full items-center gap-3 rounded-xl px-3 py-2.5
            text-sm font-medium text-slate-400
            transition-all duration-200
            hover:bg-rose-500/10 hover:text-rose-300
            ${collapsed ? 'justify-center' : ''}
          `}
        >
          <LogOut className="h-4.5 w-4.5 shrink-0 rtl:rotate-180" />
          {!collapsed && <span>{t('signOut')}</span>}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* ============================================================ */}
      {/* Desktop Sidebar                                              */}
      {/* ============================================================ */}
      <aside
        className={`
          fixed start-0 top-0 z-40 hidden h-screen
          border-e border-white/6 bg-[#070b14]/95 backdrop-blur-xl
          transition-all duration-300 ease-out
          lg:flex lg:flex-col
          ${sidebarWidth}
        `}
      >
        <NavContent />

        {/* Collapse toggle: السهمين بيتعكسوا في العربي */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="
            absolute -end-3 top-20 z-50 flex h-6 w-6 items-center justify-center
            rounded-full border border-white/10 bg-[#0c1220] text-slate-400
            shadow-lg transition hover:border-cyan-500/30 hover:text-cyan-300
          "
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
          )}
        </button>
      </aside>

      {/* Spacer for desktop content */}
      <div className={`hidden shrink-0 transition-all duration-300 lg:block ${sidebarWidth}`} />

      {/* ============================================================ */}
      {/* Mobile Top Bar                                               */}
      {/* ============================================================ */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-white/6 bg-[#070b14]/95 px-4 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-2.5">
          {/* <Logo className="h-7 w-7" /> */}
          <span className="text-sm font-bold text-white" dir="ltr">
            Zero<span className="text-cyan-400">Plus</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label={t('landing.menu')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/5"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute start-0 top-0 flex h-full w-70 flex-col border-e border-white/6 bg-[#070b14] shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-white/6 px-4">
              <div className="flex items-center gap-2.5">
                {/* <Logo className="h-7 w-7" /> */}
                <span className="text-sm font-bold text-white" dir="ltr">
                  Zero<span className="text-cyan-400">Plus</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <NavContent onNavigate={() => setMobileOpen(false)} />
            </div>
          </aside>
        </div>
      )}
    </>
  )
}