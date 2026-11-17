// ==================================================================
// Zero Plus - Root Application Component
// بيغلّف التطبيق كله: الـ Router + استعادة الجلسة + صائد الأخطاء
// ==================================================================

import { useEffect, Component, Suspense, ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'

import i18n from './i18n'
import AppRouter from './router/AppRouter'
import AlertToast from './components/AlertToast'
import { useNotificationsLive } from './hooks/useNotificationsLive'
import { useDirection } from './hooks/useDirection'
import useAuthStore from './store/authStore'

// استيراد آمن لتجنب خطأ المسار إذا كان اسم الملف apiClient بدلاً من api
import * as apiModule from './services/api'

// تحديد اسم الحدث بشكل آمن تحسباً لعدم وجوده في ملف api
const SESSION_EXPIRED = (apiModule as any).SESSION_EXPIRED_EVENT || 'SESSION_EXPIRED'

// ==================================================================
// Error Boundary (صائد الأخطاء لمنع الشاشة البيضاء)
// ==================================================================
interface EBProps {
  children: ReactNode
}
interface EBState {
  hasError: boolean
  error: Error | null
}

class AppErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    // تحديث الحالة لكي يُظهر الـ fallback UI
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      // الكلاس مينفعش يستخدم هوكس، فبنستخدم i18n.t مباشرة
      const t = i18n.t.bind(i18n)

      // بدلاً من الشاشة البيضاء، نعرض الخطأ بوضوح
      return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6">
          <div className="bg-rose-950/50 border border-rose-800 p-6 rounded-xl max-w-2xl w-full">
            <h1 className="text-xl font-bold text-rose-500 mb-4">⚠️ {t('boundary.title', { ns: 'errors' })}</h1>
            <p className="text-sm text-slate-300 mb-2">{t('boundary.intro', { ns: 'errors' })}</p>
            {/* رسالة الخطأ التقنية بتفضل LTR حتى في العربي */}
            <pre dir="ltr" className="bg-black/50 p-4 rounded-lg text-rose-300 text-sm overflow-auto whitespace-pre-wrap">
              {this.state.error?.message || this.state.error?.toString()}
            </pre>
            <p className="text-xs text-slate-500 mt-4">{t('boundary.hint', { ns: 'errors' })}</p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// ==================================================================
// App Component
// ==================================================================

export default function App() {
  // lang + dir على <html> حسب اللغة الحالية (وتحميل خط العربي)
  useDirection()

  // إشعارات لحظية (Socket.IO): بتشتغل لما المستخدم يسجّل دخول وبتتنضف عند الخروج
  useNotificationsLive()

  // ----------------------------------------------------------------
  // Restore Session on App Load (بشكل آمن)
  // ----------------------------------------------------------------
  useEffect(() => {
    const store = useAuthStore.getState()
    // التحقق من وجود الدالة قبل استدعائها لمنع انهيار التطبيق
    if (typeof (store as any).initializeAuth === 'function') {
      (store as any).initializeAuth()
    } else if (typeof (store as any).init === 'function') {
      (store as any).init()
    }
  }, [])

  // ----------------------------------------------------------------
  // Listen for Session Expired Event
  // ----------------------------------------------------------------
  useEffect(() => {
    const handleSessionExpired = () => {
      const store = useAuthStore.getState()
      if (typeof store.logout === 'function') {
        store.logout()
      }
    }

    window.addEventListener(SESSION_EXPIRED, handleSessionExpired)
    return () => {
      window.removeEventListener(SESSION_EXPIRED, handleSessionExpired)
    }
  }, [])

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        {/* Suspense: لحد ما ملفات الترجمة تتحمل (نفس خلفية الموقع عشان مفيش وميض) */}
        <Suspense fallback={<div className="min-h-screen bg-[#05070f]" />}>
          <AppRouter />
          {/* توست الإشعارات اللحظية: فوق كل الصفحات */}
          <AlertToast />
        </Suspense>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}