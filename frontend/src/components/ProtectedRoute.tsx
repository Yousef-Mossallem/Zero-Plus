// frontend/src/components/ProtectedRoute.tsx
// ==================================================================
// Zero Plus - Protected Route
// بيحمي أي صفحة محتاجة تسجيل دخول
// ==================================================================

import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2, Shield } from 'lucide-react'

import {
  useAuthStore,
  selectIsAuthenticated,
  selectIsInitialized,
  selectIsLoading,
} from '../store/authStore'

// ==================================================================
// وضع التطوير
// ------------------------------------------------------------------
// true  = تخطي صفحة تسجيل الدخول أثناء التطوير
// false = تشغيل الحماية الأصلية زي ما هي
// ==================================================================

const BYPASS_AUTH = false

// ==================================================================
// Props
// ==================================================================

interface ProtectedRouteProps {
  children: React.ReactNode
}

// ==================================================================
// Component
// ==================================================================

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation()

  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const isInitialized = useAuthStore(selectIsInitialized)
  const isLoading = useAuthStore(selectIsLoading)
  const initializeAuth = useAuthStore((s) => s.initializeAuth)

  // ----------------------------------------------------------------
  // تأكد إن الـ Session اتحقق منها مرة على الأقل
  // ----------------------------------------------------------------

  useEffect(() => {
    if (!isInitialized) {
      initializeAuth()
    }
  }, [isInitialized, initializeAuth])

  // ----------------------------------------------------------------
  // لسه بيتحقق من الـ Token
  // ----------------------------------------------------------------

  if (!BYPASS_AUTH && (!isInitialized || isLoading)) {
      const newLocal = "pointer-events-none absolute -left-40 top-1/4 h-80 w-[320px] rounded-full bg-cyan-500/10 blur-[100px]"
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#05070f]">
        {/* Background */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-[#0b1224] via-[#05070f] to-[#02040a]" />
        <div className={newLocal} />
        <div className="pointer-events-none absolute -right-40 bottom-1/4 h-70 w-70 rounded-full bg-indigo-600/10 blur-[90px]" />

        <div className="relative z-10 flex flex-col items-center gap-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/25">
            <Shield className="h-7 w-7 text-white" strokeWidth={2.2} />
          </div>

          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
            <p className="text-sm text-slate-400">Verifying session...</p>
          </div>
        </div>
      </div>
    )
  }

  // ----------------------------------------------------------------
  // مش مسجل دخول → يتحول لصفحة Login
  // (في وضع التطوير BYPASS_AUTH بيتخطى الخطوة دي)
  // ----------------------------------------------------------------

  if (!BYPASS_AUTH && !isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname }}
      />
    )
  }

  // ----------------------------------------------------------------
  // مسجل دخول → يعرض الصفحة المطلوبة
  // ----------------------------------------------------------------

  return <>{children}</>
}
