// frontend/src/pages/SignupPage.tsx
// ==================================================================
// Zero Plus - Signup Page
// WebAuthn / Passkeys — نفس التصميم، منطق جديد
// ==================================================================

import {
  Activity,
  AlertCircle,
  ArrowRight,
  Building2,
  Fingerprint,
  Loader2,
  LockKeyhole,
  Mail,
  Shield,
  User,
  Zap,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import type { RegisterStartRequest } from '../services/authService'
import { useAuthStore } from '../store/authStore'

// ==================================================================
// Types
// ==================================================================

interface FormErrors {
  organizationName?: string
  fullName?: string
  email?: string
}

type SizeProfile = 'small' | 'medium' | 'large'

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
    sizeProfile: 'medium' as SizeProfile,
  })

  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [webAuthnSupported, setWebAuthnSupported] = useState(true)

  const isLoading = status === 'loading'

  // ------------------------------------------------------------------
  // هل المتصفح يدعم WebAuthn؟
  // ------------------------------------------------------------------

  useEffect(() => {
    const ok =
      typeof window !== 'undefined' &&
      !!window.PublicKeyCredential &&
      typeof window.PublicKeyCredential === 'function'
    setWebAuthnSupported(ok)
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated, navigate])

  useEffect(() => {
    return () => clearError()
  }, [clearError])

  // ------------------------------------------------------------------
  // Form helpers
  // ------------------------------------------------------------------

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

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  // ------------------------------------------------------------------
  // Submit → Store يعمل: register/start → بصمة → register/finish
  // ------------------------------------------------------------------

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    setTouched({
      organizationName: true,
      fullName: true,
      email: true,
    })

    if (!validate()) return

    if (!webAuthnSupported) {
      return
    }

    const payload: RegisterStartRequest = {
      organizationName: form.organizationName.trim(),
      fullName: form.fullName.trim(),
      email: form.email.trim().toLowerCase(),
      sizeProfile: form.sizeProfile,
    }

    const result = await signup(payload)

    if (result.success) {
      navigate('/dashboard', { replace: true })
    }
  }

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------

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
      <div className="pointer-events-none absolute -left-40 top-1/4 h-105 w-105 rounded-full bg-cyan-500/10 blur-[120px]" />
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
                Passwordless • Fingerprint or Face ID
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
                visibility — sign up with your fingerprint or face. No
                password stored on our servers.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {[
                { icon: Activity, label: 'Real-time Detection' },
                { icon: Fingerprint, label: 'Passkey Auth' },
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
                  After you submit, your device will ask for fingerprint or
                  Face ID. We only store a public key — never your biometrics.
                </p>
              </div>

              {!webAuthnSupported && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    This browser does not support Passkeys. Use Chrome, Edge,
                    Safari, or Firefox on localhost / HTTPS.
                  </span>
                </div>
              )}

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
                      onChange={(e) =>
                        handleChange('organizationName', e.target.value)
                      }
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
                    <p className="text-xs text-rose-400">
                      {formErrors.organizationName}
                    </p>
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

                {/* Traffic size → AI baseline */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Traffic Size
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'small', label: 'Small' },
                        { id: 'medium', label: 'Medium' },
                        { id: 'large', label: 'Large' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleChange('sizeProfile', opt.id)}
                        className={`
                          rounded-xl border px-3 py-2.5 text-sm font-medium transition-all
                          ${
                            form.sizeProfile === opt.id
                              ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300'
                              : 'border-white/10 bg-white/3 text-slate-400 hover:border-white/20'
                          }
                        `}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Seeds the AI model baseline for your organization.
                  </p>
                </div>

                {/* Passkey hint card */}
                <div className="flex items-center gap-3 rounded-xl border border-cyan-500/15 bg-cyan-500/5 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
                    <Fingerprint className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-sm text-slate-300">
                    <p className="font-medium text-cyan-200">Passkey required</p>
                    <p className="text-xs text-slate-500">
                      Next step: fingerprint, Face ID, or Windows Hello on this
                      device.
                    </p>
                  </div>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isLoading || !webAuthnSupported}
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
                      Waiting for biometric…
                    </>
                  ) : (
                    <>
                      <Fingerprint className="h-4 w-4" />
                      Create account with Passkey
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
              Public key only on our servers • Biometrics never leave your device
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}