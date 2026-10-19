// frontend/src/pages/LoginPage.tsx
// ==================================================================
// Zero Plus - Login Page (WebAuthn / Passkeys)
// Professional • Modern • Strong Visual Identity
// ==================================================================
//
// التدفق:
//   1) المستخدم يكتب الإيميل
//   2) login({ email }) → login/start → نافذة البصمة → login/finish
//   3) نجاح → /dashboard
//
// ملاحظة: مفيش باسورد في الدخول الأساسي.
// ==================================================================

import { useState, useEffect, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Shield,
  Mail,
  ArrowRight,
  AlertCircle,
  Loader2,
  Zap,
  Activity,
  LockKeyhole,
  ShieldCheck,
  Fingerprint,
  Info,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import type { LoginRequest } from '../services/authService'

// ==================================================================
// Constants & Helpers
// ==================================================================

/** نفس قيود emailSchema في الباك */
const EMAIL_MIN_LENGTH = 5
const EMAIL_MAX_LENGTH = 255
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * هل المتصفح يدعم WebAuthn؟
 * لو لأ، مش هنقدر نعمل login أصلًا.
 */
function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  )
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

  const isLoading = status === 'loading'

  // ----------------------------------------------------------------
  // Form State
  // ----------------------------------------------------------------

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | undefined>()
  const [emailTouched, setEmailTouched] = useState(false)
  const [passkeySupported] = useState(isPasskeySupported)

  // ----------------------------------------------------------------
  // Redirect if already authenticated
  // ----------------------------------------------------------------

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated, navigate])

  // مسح الخطأ العام عند الخروج من الصفحة
  useEffect(() => {
    return () => clearError()
  }, [clearError])

  // ----------------------------------------------------------------
  // Validation
  // ----------------------------------------------------------------

  const validateEmail = (value: string): string | undefined => {
    const trimmed = value.trim()

    if (!trimmed) return 'Work email is required'
    if (trimmed.length < EMAIL_MIN_LENGTH) return 'Email is too short'
    if (trimmed.length > EMAIL_MAX_LENGTH) return 'Email is too long'
    if (!EMAIL_REGEX.test(trimmed)) return 'Invalid email format'

    return undefined
  }

  // ----------------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------------

  const handleEmailChange = (value: string) => {
    setEmail(value)

    // لو كان فيه خطأ تحقق، نمسحه أول ما المستخدم يبدأ يكتب
    if (emailError) setEmailError(undefined)
    if (error) clearError()
  }

  const handleEmailBlur = () => {
    setEmailTouched(true)
    setEmailError(validateEmail(email))
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (isLoading) return

    setEmailTouched(true)

    const validationError = validateEmail(email)
    setEmailError(validationError)

    if (validationError) return

    const payload: LoginRequest = {
      email: email.trim().toLowerCase(),
    }

    const result = await login(payload)

    if (result.success) {
      navigate('/dashboard', { replace: true })
    }
    // لو فشل: الـ error في الـ store بيتعرض تلقائيًا في الكارد
    // والزرار بيفضل شغال عشان المستخدم يعيد المحاولة
  }

  const showEmailError = emailTouched && !!emailError

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#05070f] text-white">
      {/* ============================================================ */}
      {/* Background Layers                                            */}
      {/* ============================================================ */}

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

          {/* Hero */}
          <div className="max-w-md space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Passwordless. Phishing-resistant.
              </div>

              <h1 className="text-4xl font-bold leading-[1.15] tracking-tight text-white xl:text-5xl">
                Welcome back to
                <span className="block bg-linear-to-r from-cyan-300 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
                  command center
                </span>
              </h1>

              <p className="text-base leading-relaxed text-slate-400">
                Sign in with your fingerprint, face, or device PIN. No
                passwords to leak, no codes to type. Your live traffic and
                policies are one touch away.
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
                  Enter your work email, then confirm with your passkey.
                </p>
              </div>

              {/* Unsupported browser */}
              {!passkeySupported && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    This browser doesn&apos;t support passkeys. Please use a
                    recent version of Chrome, Safari, Edge, or Firefox.
                  </span>
                </div>
              )}

              {/* Global Error */}
              {error && (
                <div
                  role="alert"
                  className="mb-6 flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Form */}
              <form
                onSubmit={handleSubmit}
                className="space-y-5"
                noValidate
                aria-busy={isLoading}
              >
                {/* Email */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="login-email"
                    className="text-xs font-medium uppercase tracking-wider text-slate-400"
                  >
                    Work Email
                  </label>

                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />

                    <input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(e) => handleEmailChange(e.target.value)}
                      onBlur={handleEmailBlur}
                      placeholder="you@company.com"
                      disabled={isLoading}
                      autoComplete="username webauthn"
                      autoFocus
                      aria-invalid={showEmailError}
                      aria-describedby={showEmailError ? 'login-email-error' : undefined}
                      className={`
                        w-full rounded-xl border bg-white/3 py-3 pl-11 pr-4
                        text-sm text-white placeholder:text-slate-600
                        outline-none transition-all duration-200
                        focus:border-cyan-500/50 focus:bg-white/5 focus:ring-2 focus:ring-cyan-500/20
                        disabled:opacity-50
                        ${
                          showEmailError
                            ? 'border-rose-500/50'
                            : 'border-white/10 hover:border-white/20'
                        }
                      `}
                    />
                  </div>

                  {showEmailError && (
                    <p id="login-email-error" className="text-xs text-rose-400">
                      {emailError}
                    </p>
                  )}
                </div>

                {/* Passkey hint */}
                <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/2 px-4 py-3">
                  <Fingerprint className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
                  <p className="text-xs leading-relaxed text-slate-400">
                    After you continue, your device will ask for Face ID,
                    Touch ID, Windows Hello, or your device PIN.
                  </p>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isLoading || !passkeySupported}
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
                      Waiting for your passkey...
                    </>
                  ) : (
                    <>
                      <Fingerprint className="h-4 w-4" />
                      Continue with Passkey
                      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </form>

              {/* Footer */}
              <div className="mt-8 space-y-3 text-center text-sm text-slate-500">
                <p>
                  Don&apos;t have an account?{' '}
                  <Link
                    to="/signup"
                    className="font-medium text-cyan-400 transition hover:text-cyan-300"
                  >
                    Create one
                  </Link>
                </p>
                <p className="text-xs text-slate-600">
                  Lost access to your device? Contact your organization admin.
                </p>
              </div>
            </div>

            {/* Trust note */}
            <p className="mt-6 text-center text-[11px] text-slate-600">
              Protected by Zero Plus passwordless authentication
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}