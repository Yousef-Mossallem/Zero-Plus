// frontend/src/pages/SignupPage.tsx
// ==================================================================
// Zero Plus - Signup Page
// Professional • Modern • Strong Visual Identity
// ==================================================================

import {
  Activity,
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LockKeyhole,
  Mail,
  Shield,
  User,
  Zap,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import type { SignupRequest } from '../services/authService'
import { useAuthStore } from '../store/authStore'

// ==================================================================
// Types
// ==================================================================

interface FormErrors {
  organizationName?: string
  fullName?: string
  email?: string
  password?: string
  confirmPassword?: string
}

// ==================================================================
// Password Requirements
// ==================================================================

const PASSWORD_RULES = [
  {
    id: 'length',
    label: 'At least 8 characters',
    test: (p: string) => p.length >= 8,
  },
  {
    id: 'lowercase',
    label: 'One lowercase letter (a-z)',
    test: (p: string) => /[a-z]/.test(p),
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter (A-Z)',
    test: (p: string) => /[A-Z]/.test(p),
  },
  {
    id: 'number',
    label: 'One number (0-9)',
    test: (p: string) => /[0-9]/.test(p),
  },
] as const

function getPasswordStrength(password: string): {
  score: number
  label: string
  color: string
} {
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[a-z]/.test(password)) score += 1
  if (/[A-Z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^a-zA-Z0-9]/.test(password)) score += 1

  if (score <= 2) return { score, label: 'Weak', color: 'bg-rose-500' }
  if (score <= 4) return { score, label: 'Fair', color: 'bg-amber-500' }
  if (score <= 5) return { score, label: 'Good', color: 'bg-emerald-500' }
  return { score, label: 'Strong', color: 'bg-cyan-400' }
}

// ==================================================================
// Component
// ==================================================================

export default function SignupPage() {
  const navigate = useNavigate()

  const signup = useAuthStore((s) => s.signup)
  const status = useAuthStore((s) => s.status)
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated')

  const [form, setForm] = useState({
    organizationName: '',
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  })

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const isLoading = status === 'loading'
  const passwordStrength = getPasswordStrength(form.password)
  const showPasswordRules = form.password.length > 0 || touched.password

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated, navigate])

  useEffect(() => {
    return () => clearError()
  }, [clearError])

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

    if (!form.organizationName.trim() || form.organizationName.trim().length < 2) {
      errors.organizationName = 'Organization name must be at least 2 characters'
    }

    if (!form.fullName.trim() || form.fullName.trim().length < 2) {
      errors.fullName = 'Full name must be at least 2 characters'
    }

    if (!form.email.trim()) {
      errors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Invalid email format'
    }

    if (!form.password) {
      errors.password = 'Password is required'
    } else if (form.password.length < 8) {
      errors.password = 'Password must be at least 8 characters'
    } else if (
      !/[a-z]/.test(form.password) ||
      !/[A-Z]/.test(form.password) ||
      !/[0-9]/.test(form.password)
    ) {
      errors.password = 'Must include uppercase, lowercase and a number'
    }

    if (form.password !== form.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    setTouched({
      organizationName: true,
      fullName: true,
      email: true,
      password: true,
      confirmPassword: true,
    })

    if (!validate()) return

    const payload: SignupRequest = {
      organizationName: form.organizationName.trim(),
      fullName: form.fullName.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password,
    }

    const result = await signup(payload)

    if (result.success) {
      navigate('/dashboard', { replace: true })
    }
  }

  const newLocal = "pointer-events-none absolute -left-40 top-1/4 h-105 w-105 rounded-full bg-cyan-500/10 blur-[120px]"
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#05070f] text-white">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-[#0b1224] via-[#05070f] to-[#02040a]" />
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
      <div className={newLocal} />
      <div className="pointer-events-none absolute -right-40 bottom-1/4 h-95 w-95 rounded-full bg-indigo-600/15 blur-[110px]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-70 w-150 -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[100px]" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col lg:flex-row">
        {/* Left Panel */}
        <div className="hidden flex-1 flex-col justify-between p-12 lg:flex xl:p-16">
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

          <div className="max-w-md space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
                <Zap className="h-3.5 w-3.5" />
                Enterprise-grade protection in minutes
              </div>
              <h1 className="text-4xl font-bold leading-[1.15] tracking-tight text-white xl:text-5xl">
                Secure your traffic
                <span className="block bg-linear-to-r from-cyan-300 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
                  before it reaches you
                </span>
              </h1>
              <p className="text-base leading-relaxed text-slate-400">
                Zero Plus stands between the internet and your servers.
                Intelligent detection, silent challenges, and real-time
                visibility — without the CAPTCHA pain.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {[
                { icon: Activity, label: 'Real-time Detection' },
                { icon: LockKeyhole, label: 'Silent JS Challenge' },
                { icon: Shield, label: 'Adaptive Risk Engine' },
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

          <p className="text-xs text-slate-600">
            Trusted architecture • Multi-tenant isolation • Online learning
          </p>
        </div>

        {/* Right Panel – Form */}
        <div className="flex flex-1 items-center justify-center p-6 sm:p-10 lg:p-12">
          <div className="w-full max-w-110">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-cyan-400 to-blue-600">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-bold text-white">
                Zero<span className="text-cyan-400">Plus</span>
              </span>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-white/3 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
              <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />

              <div className="mb-8 space-y-2">
                <h2 className="text-2xl font-bold tracking-tight text-white">
                  Create your account
                </h2>
                <p className="text-sm text-slate-400">
                  Start protecting your infrastructure in under a minute.
                </p>
              </div>

              {error && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                {/* Organization Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Organization Name
                  </label>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={form.organizationName}
                      onChange={(e) => handleChange('organizationName', e.target.value)}
                      onBlur={() => handleBlur('organizationName')}
                      placeholder="Acme Security"
                      disabled={isLoading}
                      className={`
                        w-full rounded-xl border bg-white/3 py-3 pl-11 pr-4
                        text-sm text-white placeholder:text-slate-600
                        outline-none transition-all duration-200
                        focus:border-cyan-500/50 focus:bg-white/5 focus:ring-2 focus:ring-cyan-500/20
                        disabled:opacity-50
                        ${
                          touched.organizationName && formErrors.organizationName
                            ? 'border-rose-500/50'
                            : 'border-white/10 hover:border-white/20'
                        }
                      `}
                    />
                  </div>
                  {touched.organizationName && formErrors.organizationName && (
                    <p className="text-xs text-rose-400">{formErrors.organizationName}</p>
                  )}
                </div>

                {/* Full Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={form.fullName}
                      onChange={(e) => handleChange('fullName', e.target.value)}
                      onBlur={() => handleBlur('fullName')}
                      placeholder="John Doe"
                      disabled={isLoading}
                      className={`
                        w-full rounded-xl border bg-white/3 py-3 pl-11 pr-4
                        text-sm text-white placeholder:text-slate-600
                        outline-none transition-all duration-200
                        focus:border-cyan-500/50 focus:bg-white/5 focus:ring-2 focus:ring-cyan-500/20
                        disabled:opacity-50
                        ${
                          touched.fullName && formErrors.fullName
                            ? 'border-rose-500/50'
                            : 'border-white/10 hover:border-white/20'
                        }
                      `}
                    />
                  </div>
                  {touched.fullName && formErrors.fullName && (
                    <p className="text-xs text-rose-400">{formErrors.fullName}</p>
                  )}
                </div>

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
                  <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => handleChange('password', e.target.value)}
                      onBlur={() => handleBlur('password')}
                      placeholder="Min. 8 characters"
                      disabled={isLoading}
                      autoComplete="new-password"
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

                  {/* Strength bar */}
                  {form.password.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                          <div
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                              i <= passwordStrength.score
                                ? passwordStrength.color
                                : 'bg-white/10'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Strength:{' '}
                        <span className="text-slate-300">{passwordStrength.label}</span>
                      </p>
                    </div>
                  )}

                  {/* Password Requirements Checklist */}
                  <div
                    className={`
                      overflow-hidden transition-all duration-300 ease-out
                      ${showPasswordRules ? 'mt-3 max-h-40 opacity-100' : 'max-h-0 opacity-0'}
                    `}
                  >
                    <div className="rounded-xl border border-white/6 bg-white/2 px-3.5 py-3 space-y-2">
                      {PASSWORD_RULES.map((rule) => {
                        const passed = rule.test(form.password)
                        return (
                          <div
                            key={rule.id}
                            className="flex items-center gap-2.5 transition-all duration-300"
                          >
                            <div
                              className={`
                                flex h-4 w-4 shrink-0 items-center justify-center rounded-full
                                transition-all duration-300
                                ${
                                  passed
                                    ? 'bg-emerald-500/20 text-emerald-400 scale-100'
                                    : 'bg-white/5 text-slate-600 scale-95'
                                }
                              `}
                            >
                              {passed ? (
                                <CheckCircle2 className="h-3.5 w-3.5 animate-[fadeIn_0.25s_ease-out]" />
                              ) : (
                                <Circle className="h-3 w-3" strokeWidth={2} />
                              )}
                            </div>
                            <span
                              className={`
                                text-xs transition-colors duration-300
                                ${passed ? 'text-emerald-400/90' : 'text-slate-500'}
                              `}
                            >
                              {rule.label}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {touched.password && formErrors.password && (
                    <p className="text-xs text-rose-400">{formErrors.password}</p>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={form.confirmPassword}
                      onChange={(e) => handleChange('confirmPassword', e.target.value)}
                      onBlur={() => handleBlur('confirmPassword')}
                      placeholder="Repeat your password"
                      disabled={isLoading}
                      autoComplete="new-password"
                      className={`
                        w-full rounded-xl border bg-white/3 py-3 pl-11 pr-12
                        text-sm text-white placeholder:text-slate-600
                        outline-none transition-all duration-200
                        focus:border-cyan-500/50 focus:bg-white/5 focus:ring-2 focus:ring-cyan-500/20
                        disabled:opacity-50
                        ${
                          touched.confirmPassword && formErrors.confirmPassword
                            ? 'border-rose-500/50'
                            : 'border-white/10 hover:border-white/20'
                        }
                      `}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-300"
                      tabIndex={-1}
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {touched.confirmPassword && formErrors.confirmPassword && (
                    <p className="text-xs text-rose-400">{formErrors.confirmPassword}</p>
                  )}
                  {form.confirmPassword &&
                    form.password === form.confirmPassword &&
                    !formErrors.confirmPassword && (
                      <p className="flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Passwords match
                      </p>
                    )}
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
                      Creating account...
                    </>
                  ) : (
                    <>
                      Create Account
                      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </form>

              <p className="mt-8 text-center text-sm text-slate-500">
                Already have an account?{' '}
                <Link
                  to="/login"
                  className="font-medium text-cyan-400 transition hover:text-cyan-300"
                >
                  Sign in
                </Link>
              </p>
            </div>

            <p className="mt-6 text-center text-[11px] text-slate-600">
              By creating an account you agree to our Terms of Service
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}