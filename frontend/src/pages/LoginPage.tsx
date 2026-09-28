// frontend/src/pages/LoginPage.tsx
// ==================================================================
// Zero Plus - Login Page
// Professional • Modern • Strong Visual Identity
// ==================================================================

import { useState, useEffect, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Shield,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  Loader2,
  Zap,
  Activity,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react'

import { useAuthStore } from '../store/authStore'
import type { LoginRequest } from '../services/authService'

// ==================================================================
// Types
// ==================================================================

interface FormErrors {
  email?: string
  password?: string
}

// ==================================================================
// Component
// ==================================================================

export default function LoginPage() {
  const navigate = useNavigate()

  const login = useAuthStore((s) => s.login)
  const status = useAuthStore((s) => s.status)
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated')

  // ----------------------------------------------------------------
  // Form State
  // ----------------------------------------------------------------

  const [form, setForm] = useState({
    email: '',
    password: '',
  })

  const [showPassword, setShowPassword] = useState(false)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [rememberMe, setRememberMe] = useState(true)

  const isLoading = status === 'loading'

  // ----------------------------------------------------------------
  // Redirect if already authenticated
  // ----------------------------------------------------------------

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated, navigate])

  // Clear global error when unmounting
  useEffect(() => {
    return () => clearError()
  }, [clearError])

  // ----------------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------------

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (formErrors[field as keyof FormErrors]) {
      setFormErrors((prev) => ({ ...prev, [field]: undefined }))
    }
    if (error) clearError()
  }

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  const validate = (): boolean => {
    const errors: FormErrors = {}

    if (!form.email.trim()) {
      errors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Invalid email format'
    }

    if (!form.password) {
      errors.password = 'Password is required'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    setTouched({
      email: true,
      password: true,
    })

    if (!validate()) return

    const payload: LoginRequest = {
      email: form.email.trim().toLowerCase(),
      password: form.password,
    }

    const result = await login(payload)

    if (result.success) {
      navigate('/dashboard', { replace: true })
    }
  }

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#05070f] text-white">
      {/* ============================================================ */}
      {/* Background Layers                                            */}
      {/* ============================================================ */}

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-[#0b1224] via-[#05070f] to-[#02040a]" />

      {/* Animated grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(56, 189, 248, 0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(56, 189, 248, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: '64px 64px',
        }}
      />

      {/* Soft glow orbs */}
      <div className="pointer-events-none absolute -left-40 top-1/4 h-105 w-105 rounded-full bg-cyan-500/10 blur-[120px]" />
      <div className="pointer-events-none absolute -right-40 bottom-1/4 h-95 w-95 rounded-full bg-indigo-600/15 blur-[110px]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-70 w-150 -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[100px]" />

      {/* ============================================================ */}
      {/* Main Content                                                 */}
      {/* ============================================================ */}

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col lg:flex-row">
        {/* ---------------------------------------------------------- */}
        {/* Left Panel – Branding                                      */}
        {/* ---------------------------------------------------------- */}

        <div className="hidden flex-1 flex-col justify-between p-12 lg:flex xl:p-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-linear-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/25">
              <Shield className="h-6 w-6 text-white" strokeWidth={2.2} />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight text-white">
                Zero<span className="text-cyan-400">Plus</span>
              </span>
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                Adaptive Security Gateway
              </p>
            </div>
          </div>

          {/* Hero Text */}
          <div className="max-w-md space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Your defense layer is ready
              </div>

              <h1 className="text-4xl font-bold leading-[1.15] tracking-tight text-white xl:text-5xl">
                Welcome back to
                <span className="block bg-linear-to-r from-cyan-300 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
                  command center
                </span>
              </h1>

              <p className="text-base leading-relaxed text-slate-400">
                Access your live traffic, threat intelligence, and adaptive
                policies. Everything is already watching the edge for you.
              </p>
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-3">
              {[
                { icon: Activity, label: 'Live Traffic Feed' },
                { icon: LockKeyhole, label: 'Session Secured' },
                { icon: Zap, label: 'Instant Decisions' },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/3 px-3 py-2 text-sm text-slate-300 backdrop-blur-sm"
                >
                  <Icon className="h-4 w-4 text-cyan-400" />
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Footer note */}
          <p className="text-xs text-slate-600">
            Multi-tenant isolation • Real-time Socket updates • Audit-ready logs
          </p>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Right Panel – Form                                         */}
        {/* ---------------------------------------------------------- */}

        <div className="flex flex-1 items-center justify-center p-6 sm:p-10 lg:p-12">
          <div className="w-full max-w-110">
            {/* Mobile logo */}
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-cyan-400 to-blue-600">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-bold text-white">
                Zero<span className="text-cyan-400">Plus</span>
              </span>
            </div>

            {/* Card */}
            <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-white/3 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
              {/* Top accent line */}
              <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />

              {/* Header */}
              <div className="mb-8 space-y-2">
                <h2 className="text-2xl font-bold tracking-tight text-white">
                  Sign in to Zero Plus
                </h2>
                <p className="text-sm text-slate-400">
                  Enter your credentials to access the dashboard.
                </p>
              </div>

              {/* Global Error */}
              {error && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Work Email
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      onBlur={() => handleBlur('email')}
                      placeholder="you@company.com"
                      disabled={isLoading}
                      autoComplete="email"
                      className={`
                        w-full rounded-xl border bg-white/3 py-3 pl-11 pr-4
                        text-sm text-white placeholder:text-slate-600
                        outline-none transition-all duration-200
                        focus:border-cyan-500/50 focus:bg-white/5 focus:ring-2 focus:ring-cyan-500/20
                        disabled:opacity-50
                        ${
                          touched.email && formErrors.email
                            ? 'border-rose-500/50'
                            : 'border-white/10 hover:border-white/20'
                        }
                      `}
                    />
                  </div>
                  {touched.email && formErrors.email && (
                    <p className="text-xs text-rose-400">{formErrors.email}</p>
                  )}
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                      Password
                    </label>
                    <button
                      type="button"
                      className="text-xs font-medium text-cyan-400/80 transition hover:text-cyan-300"
                      tabIndex={-1}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => handleChange('password', e.target.value)}
                      onBlur={() => handleBlur('password')}
                      placeholder="Enter your password"
                      disabled={isLoading}
                      autoComplete="current-password"
                      className={`
                        w-full rounded-xl border bg-white/3 py-3 pl-11 pr-12
                        text-sm text-white placeholder:text-slate-600
                        outline-none transition-all duration-200
                        focus:border-cyan-500/50 focus:bg-white/5 focus:ring-2 focus:ring-cyan-500/20
                        disabled:opacity-50
                        ${
                          touched.password && formErrors.password
                            ? 'border-rose-500/50'
                            : 'border-white/10 hover:border-white/20'
                        }
                      `}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-300"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {touched.password && formErrors.password && (
                    <p className="text-xs text-rose-400">{formErrors.password}</p>
                  )}
                </div>

                {/* Remember me */}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setRememberMe((v) => !v)}
                    className={`
                      flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded
                      border transition-all duration-200
                      ${
                        rememberMe
                          ? 'border-cyan-500 bg-cyan-500'
                          : 'border-white/20 bg-transparent hover:border-white/40'
                      }
                    `}
                  >
                    {rememberMe && (
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span className="text-sm text-slate-400">Keep me signed in</span>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="
                    group relative mt-2 flex w-full items-center justify-center gap-2
                    overflow-hidden rounded-xl bg-linear-to-r from-cyan-500 to-blue-600
                    px-6 py-3.5 text-sm font-semibold text-white
                    shadow-lg shadow-cyan-500/25
                    transition-all duration-300
                    hover:shadow-cyan-500/40 hover:brightness-110
                    active:scale-[0.98]
                    disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100
                  "
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </form>

              {/* Footer */}
              <p className="mt-8 text-center text-sm text-slate-500">
                Don&apos;t have an account?{' '}
                <Link
                  to="/signup"
                  className="font-medium text-cyan-400 transition hover:text-cyan-300"
                >
                  Create one
                </Link>
              </p>
            </div>

            {/* Trust note */}
            <p className="mt-6 text-center text-[11px] text-slate-600">
              Protected by Zero Plus adaptive authentication
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}