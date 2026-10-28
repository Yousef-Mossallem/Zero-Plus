// frontend/src/components/Navbar.tsx
// ==================================================================
// Zero Plus - Navigation (Command Sidebar)
// منظم • احترافي • مناسب لعدد صفحات كبير
// ==================================================================

import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Activity,
  ShieldAlert,
  FileText,
  Fingerprint,
  Radar,
  Server,
  Building2,
  Bell,
  SlidersHorizontal,
  User,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react'

import Logo from './logo'
import {
  useAuthStore,
  selectCurrentUser,
  selectCurrentOrganization,
} from '../store/authStore'

// ==================================================================
// Nav Config
// ==================================================================

type NavItem = {
  label: string
  path: string
  icon: React.ComponentType<{ className?: string }>
}

type NavGroup = {
  title: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { label: 'Live Traffic', path: '/live-traffic', icon: Activity },
    ],
  },
  {
    title: 'Security',
    items: [
      { label: 'Security Events', path: '/security-events', icon: ShieldAlert },
      { label: 'Reputation', path: '/reputation', icon: Fingerprint },
      { label: 'Threat Intel', path: '/threat-intelligence', icon: Radar },
      // Simulation temporarily disabled
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { label: 'Servers', path: '/servers', icon: Server },
      { label: 'Policies', path: '/policies', icon: SlidersHorizontal },
      { label: 'Reports', path: '/reports', icon: FileText },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Organization', path: '/organizations', icon: Building2 },
      { label: 'Notifications', path: '/notifications', icon: Bell },
      { label: 'Profile', path: '/profile', icon: User },
    ],
  },
]

// ==================================================================
// Component
// ==================================================================

export default function Navbar() {
  const navigate = useNavigate()

  const user = useAuthStore(selectCurrentUser)
  const organization = useAuthStore(selectCurrentOrganization)
  const logout = useAuthStore((s) => s.logout)

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
        <Logo className="h-8 w-8 shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-white">
              Zero<span className="text-cyan-400">Plus</span>
            </p>
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
              Security Gateway
            </p>
          </div>
        )}
      </div>

      {/* Groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 zp-scrollbar-thin">
        <div className="space-y-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
                  {group.title}
                </p>
              )}
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        onClick={onNavigate}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          [
                            'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                            isActive
                              ? 'zp-nav-active text-cyan-300'
                              : 'text-slate-400 hover:bg-white/4 hover:text-slate-200',
                            collapsed ? 'justify-center' : '',
                          ].join(' ')
                        }
                      >
                        <Icon className="h-4.5 w-4.5 shrink-0 text-slate-500 group-hover:text-slate-300 group-[.active]:text-cyan-400" />
                        {!collapsed && <span className="truncate">{item.label}</span>}
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
        {!collapsed && (
          <div className="mb-2 rounded-xl border border-white/5 bg-white/2  px-3 py-2.5">
            <p className="truncate text-sm font-medium text-white">
              {user?.fullName ?? 'User'}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {organization?.name ?? 'Organization'}
            </p>
            {user?.role && (
              <span className="mt-1.5 inline-block rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                {user.role}
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleLogout}
          title={collapsed ? 'Sign out' : undefined}
          className={`
            flex w-full items-center gap-3 rounded-xl px-3 py-2.5
            text-sm font-medium text-slate-400
            transition-all duration-200
            hover:bg-rose-500/10 hover:text-rose-300
            ${collapsed ? 'justify-center' : ''}
          `}
        >
          <LogOut className="h-4.5 w-4.5 shrink-0" />
          {!collapsed && <span>Sign out</span>}
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
          fixed left-0 top-0 z-50 hidden h-screen
          border-r border-white/6 bg-[#070b14]/95 backdrop-blur-xl
          transition-all duration-300 ease-out
          lg:flex lg:flex-col
          ${sidebarWidth}
        `}
      >
        <NavContent />

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="
            group absolute -right-3.5 top-20 z-50 flex h-7 w-7 items-center justify-center
            rounded-full border border-cyan-400/25 bg-[#0a1220]/95 text-cyan-300/80
            shadow-[0_0_16px_rgba(34,211,238,0.2)] backdrop-blur-md
            transition-all duration-300
            hover:border-cyan-300/50 hover:text-cyan-200 hover:shadow-[0_0_24px_rgba(34,211,238,0.4)]
            hover:scale-105
          "
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400/10 to-transparent opacity-0 transition group-hover:opacity-100" />
          {collapsed ? (
            <ChevronRight className="relative h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="relative h-3.5 w-3.5" />
          )}
        </button>
      </aside>

      {/* Spacer for desktop content */}
      <div className={`hidden shrink-0 transition-all duration-300 lg:block ${sidebarWidth}`} />

      {/* ============================================================ */}
      {/* Mobile Top Bar                                               */}
      {/* ============================================================ */}
      <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-white/6 bg-[#070b14]/95 px-4 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-2.5">
          <Logo className="h-7 w-7" />
          <span className="text-sm font-bold text-white">
            Zero<span className="text-cyan-400">Plus</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/5"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-70 flex-col border-r border-white/6 bg-[#070b14] shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-white/6 px-4">
              <div className="flex items-center gap-2.5">
                <Logo className="h-7 w-7" />
                <span className="text-sm font-bold text-white">
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