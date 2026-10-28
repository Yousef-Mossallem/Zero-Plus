// frontend/src/router/AppRouter.tsx

// ==================================================================
// Zero Plus - Application Router
// كل صفحات النظام وتوزيعها على المسارات (Routes)
// ==================================================================

import { Routes, Route, Navigate } from 'react-router-dom'

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
// Core Pages (الصفحات الرئيسية الجاهزة)
// ------------------------------------------------------------------

import SecurityEventsPage from '../pages/SecurityEventsPage'
import ReputationPage from '../pages/ReputationPage'
import ServersPage from '../pages/ServersPage'
import OrganizationsPage from '../pages/OrganizationsPage'
import PoliciesPage from '../pages/PoliciesPage'

// ------------------------------------------------------------------
// Secondary Pages (جاهزة الآن – Simulation مستبعدة مؤقتًا)
// ------------------------------------------------------------------

import DashboardPage from '../pages/DashboardPage'
import LiveTrafficPage from '../pages/LiveTrafficPage'
import ReportsPage from '../pages/ReportsPage'
import ThreatIntelligencePage from '../pages/ThreatIntelligencePage'
import NotificationsPage from '../pages/NotificationsPage'
import ProfilePage from '../pages/ProfilePage'
// import SimulationPage from '../pages/SimulationPage' // مستبعدة مؤقتًا

// ------------------------------------------------------------------
// Protected Route Wrapper
// ------------------------------------------------------------------

import ProtectedRoute from '../components/ProtectedRoute'

// ==================================================================
// Router Component
// ==================================================================

export default function AppRouter() {
  return (
    <Routes>
      {/* ============================================================
          Public Routes (مفتوحة للكل)
      ============================================================ */}

      {/* الصفحة الأولى – اللاندينج */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />  {/* TEMP: skip landing/login */}
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      {/* /legal عشان /policies محجوزة لسياسات الـ Dashboard */}
      <Route path="/legal" element={<SitePoliciesPage />} />

      <Route path="/signup" element={<SignupPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* ============================================================
          Protected Routes (محتاجة تسجيل دخول)
          بعد تسجيل الدخول → صفحة السيرفرات
      ============================================================ */}

      <Route
        path="/servers"
        element={
          <ProtectedRoute>
            <ServersPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/security-events"
        element={
          <ProtectedRoute>
            <SecurityEventsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/reputation"
        element={
          <ProtectedRoute>
            <ReputationPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/organizations"
        element={
          <ProtectedRoute>
            <OrganizationsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/policies"
        element={
          <ProtectedRoute>
            <PoliciesPage />
          </ProtectedRoute>
        }
      />

      {/* الصفحات الرئيسية الجاهزة */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/live-traffic"
        element={
          <ProtectedRoute>
            <LiveTrafficPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <ReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/threat-intelligence"
        element={
          <ProtectedRoute>
            <ThreatIntelligencePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/notifications"
        element={
          <ProtectedRoute>
            <NotificationsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      {/* Simulation مستبعدة مؤقتًا حسب الطلب */}

      {/* ============================================================
          Default Redirect
          أي مسار غير معروف → صفحة السيرفرات
          (ProtectedRoute بيرجّع غير المسجّل لـ /login لوحده)
      ============================================================ */}

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}