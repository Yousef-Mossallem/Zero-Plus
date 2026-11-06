// frontend/src/router/AppRouter.tsx
// ==================================================================
// Zero Plus - Application Router
// كل صفحات النظام وتوزيعها على المسارات (Routes) — نسخة مدمجة
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
// Router
// ==================================================================

export default function AppRouter() {
  return (
    <Routes>
      {/* ============================================================
          Public — الموقع العام + المصادقة
      ============================================================ */}

      <Route path="/" element={<LandingPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      {/* /legal عشان /policies محجوزة لسياسات الـ Dashboard */}
      <Route path="/legal" element={<SitePoliciesPage />} />

      <Route path="/signup" element={<SignupPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* ============================================================
          Protected — محتاجة تسجيل دخول
      ============================================================ */}

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />

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

      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <ReportsPage />
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
        path="/simulation"
        element={
          <ProtectedRoute>
            <SimulationPage />
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

      {/*
      <Route
        path="/live-traffic"
        element={
          <ProtectedRoute>
            <LiveTrafficPage />
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
      */}

      {/* ============================================================
          Fallback — مسار غير معروف
          (ProtectedRoute يحوّل غير المسجّل لـ /login)
      ============================================================ */}

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}