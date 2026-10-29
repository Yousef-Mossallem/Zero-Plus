// frontend/src/components/ProtectedRoute.tsx
// ==================================================================
// Zero Plus - Protected Route
// بيحمي أي Page محتاجة تسجيل دخandل
// ==================================================================

import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import LoadingScreen from './LoadingScreen'

import {
  useAuthStore,
  selectIsAuthenticated,
  selectIsInitialized,
  selectIsLoading,
} from '../store/authStore'

// ==================================================================
// andضع التطandير
// ------------------------------------------------------------------
// true  = تخطي Page تسجيل الدخandل أثناء التطandير
// false = تشغيل الحماية الأصلية زي ما هي
// ==================================================================

const BYPASS_AUTH = true  // TEMP: avoid blank while backend/login not ready

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
  // تأكد إن الـ Session اتحقق منها مرة على الLess
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
    return (
      <LoadingScreen
        message="Verifying session…"
        subMessage="Securing your workspace"
      />
    )
  }

  // ----------------------------------------------------------------
  // مش مسجل دخandل → يتحandل لPage Login
  // (في andضع التطandير BYPASS_AUTH بيتخطى الخطandة دي)
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
  // مسجل دخandل → يShowing الصفحة المطلandبة
  // ----------------------------------------------------------------

  return <>{children}</>
}
