// ==================================================================
// Zero Plus - Root Application Component
// بيغلّف التطبيق كله: الـ Router + استعادة الجلسة عند فتح الموقع
// ==================================================================

import { useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'

import AppRouter from './router/AppRouter'
import useAuthStore from './store/authStore'
import { SESSION_EXPIRED_EVENT } from './services/api'

// ==================================================================
// App Component
// ==================================================================

export default function App() {
  // ----------------------------------------------------------------
  // Restore Session on App Load
  // ----------------------------------------------------------------

  // لما الموقع يتفتح أول مرة (أو يتعمله refresh)، بنحاول نتأكد
  // هل فيه جلسة (session) محفوظة صالحة ولا لأ، عن طريق
  // initializeAuth() اللي في authStore.ts
  useEffect(() => {
    useAuthStore.getState().initializeAuth()
  }, [])

  // ----------------------------------------------------------------
  // Listen for Session Expired Event
  // ----------------------------------------------------------------

  // لما api.ts يكتشف إن الـ Token بقى غير صالح (401)،
  // هو بيبعت الإشارة دي، وإحنا هنا بنسمعها ونعمل logout كامل.
  useEffect(() => {
    const handleSessionExpired = () => {
      useAuthStore.getState().logout()
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)

    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    }
  }, [])

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  )
}