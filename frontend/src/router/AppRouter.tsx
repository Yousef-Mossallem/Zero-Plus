// frontend/src/router/AppRouter.tsx
// ==================================================================
// Zero Plus - Application Router
// كل صفحات النظام وتوزيعها على المسارات (Routes) — نسخة مدمجة
// ==================================================================

import { useEffect, type ReactElement } from 'react'
import { Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom'

import i18n from '../i18n'
import { isSupported, toSupported } from '../i18n/languages'

// ------------------------------------------------------------------
// Landing Pages (الموقع العام)
// ------------------------------------------------------------------

import LandingPage from '../pages/landing/LandingPage'
import AboutPage from '../pages/landing/AboutPage'
import ContactPage from '../pages/landing/ContactPage'
import SitePoliciesPage from '../pages/landing/SitePoliciesPage'

// ------------------------------------------------------------------
// Auth Pages
// ------------------------------------------------------------------

import SignupPage from '../pages/SignupPage'
import LoginPage from '../pages/LoginPage'

// ------------------------------------------------------------------
// Core / Dashboard Pages
// ------------------------------------------------------------------

import DashboardPage from '../pages/DashboardPage'
import ServersPage from '../pages/ServersPage'
import SecurityEventsPage from '../pages/SecurityEventsPage'
import ReputationPage from '../pages/ReputationPage'
import OrganizationsPage from '../pages/OrganizationsPage'
import PoliciesPage from '../pages/PoliciesPage'
import ReportsPage from '../pages/ReportsPage'
import NotificationsPage from '../pages/NotificationsPage'
import SimulationPage from '../pages/SimulationPage'
import ProfilePage from '../pages/ProfilePage'

// ------------------------------------------------------------------
// Secondary (تفعّل لما الملفات تبقى جاهزة)
// ------------------------------------------------------------------

// import LiveTrafficPage from '../pages/LiveTrafficPage'
// import ThreatIntelligencePage from '../pages/ThreatIntelligencePage'

// ------------------------------------------------------------------
// Protected Route
// ------------------------------------------------------------------

import ProtectedRoute from '../components/ProtectedRoute'

// ==================================================================
// Language Helpers (اللغة في أول رابط اللاندينج)
// ==================================================================

/** اللغة المناسبة حالياً: (المحفوظة ← لغة المتصفح ← الإنجليزي) والـ detector بيرتبهم */
const currentLang = () => toSupported(i18n.resolvedLanguage ?? i18n.language)

/** "/" من غير لغة → تحويل تلقائي لـ /ar أو /en أو /de */
function RootRedirect() {
  return <Navigate to={`/${currentLang()}`} replace />
}

/** روابط قديمة (/about /contact /legal) → نفس الصفحة بس بلغة في أولها */
function LegacyRedirect({ page }: { page: string }) {
  return <Navigate to={`/${currentLang()}/${page}`} replace />
}

/**
 * بوابة اللغة: بتقرا :lng من الرابط وتفعّلها.
 * لو أول جزء مش لغة مدعومة (مسار غير معروف) → نفس سلوك الـ fallback القديم (/dashboard).
 */
function LangGate() {
  const { lng } = useParams()
  const valid = isSupported(lng)

  useEffect(() => {
    if (valid && i18n.resolvedLanguage !== lng) void i18n.changeLanguage(lng)
  }, [valid, lng])

  if (!valid) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/** اختصار: بيلف الصفحة بـ ProtectedRoute بدل تكرار الكود 10 مرات */
const guard = (page: ReactElement) => <ProtectedRoute>{page}</ProtectedRoute>

// ==================================================================
// Router
// ==================================================================

export default function AppRouter() {
  return (
    <Routes>
      {/* ============================================================
          Public — الموقع العام (بلغة في أول الرابط) + المصادقة
      ============================================================ */}

      <Route path="/" element={<RootRedirect />} />

      {/* الروابط القديمة من غير لغة */}
      <Route path="/about" element={<LegacyRedirect page="about" />} />
      <Route path="/contact" element={<LegacyRedirect page="contact" />} />
      <Route path="/legal" element={<LegacyRedirect page="legal" />} />

      {/* /:lng/... → المسارات الثابتة (login, dashboard...) ليها أولوية أعلى تلقائياً */}
      <Route path="/:lng" element={<LangGate />}>
        <Route index element={<LandingPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="contact" element={<ContactPage />} />
        {/* legal عشان /policies محجوزة لسياسات الـ Dashboard */}
        <Route path="legal" element={<SitePoliciesPage />} />
      </Route>

      <Route path="/signup" element={<SignupPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* ============================================================
          Protected — محتاجة تسجيل دخول (من غير لغة في الرابط)
      ============================================================ */}

      <Route path="/dashboard" element={guard(<DashboardPage />)} />
      <Route path="/servers" element={guard(<ServersPage />)} />
      <Route path="/security-events" element={guard(<SecurityEventsPage />)} />
      <Route path="/reputation" element={guard(<ReputationPage />)} />
      <Route path="/organizations" element={guard(<OrganizationsPage />)} />
      <Route path="/policies" element={guard(<PoliciesPage />)} />
      <Route path="/reports" element={guard(<ReportsPage />)} />
      <Route path="/notifications" element={guard(<NotificationsPage />)} />
      <Route path="/simulation" element={guard(<SimulationPage />)} />
      <Route path="/profile" element={guard(<ProfilePage />)} />

      {/* لما الصفحات دي تجهز:
          <Route path="/live-traffic" element={guard(<LiveTrafficPage />)} />
          <Route path="/threat-intelligence" element={guard(<ThreatIntelligencePage />)} />
      */}

      {/* ============================================================
          Fallback — مسار غير معروف
          (ProtectedRoute يحوّل غير المسجّل لـ /login)
      ============================================================ */}

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}