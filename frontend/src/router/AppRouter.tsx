// ==================================================================
// Zero Plus - Application Router
// كل صفحات النظام وتوزيعها على المسارات (Routes) - النسخة الأسطورية المدمجة
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
// Auth Pages (صفحات المصادقة والتسجيل)
// ------------------------------------------------------------------

import SignupPage from '../pages/SignupPage'
import LoginPage from '../pages/LoginPage'

// ------------------------------------------------------------------
// Core Pages & Active Pages (الصفحات الرئيسية والجاهزة)
// ------------------------------------------------------------------

import DashboardPage from '../pages/DashboardPage'
import ServersPage from '../pages/ServersPage'
import SecurityEventsPage from '../pages/SecurityEventsPage'
import ReputationPage from '../pages/ReputationPage'
import OrganizationsPage from '../pages/OrganizationsPage'
import PoliciesPage from '../pages/PoliciesPage'
import ReportsPage from '../pages/ReportsPage'
import NotificationsPage from '../pages/NotificationsPage'

// ------------------------------------------------------------------
// Secondary Pages (المعلقة / هتتفعل فور توفر ملفاتها)
// ------------------------------------------------------------------

// import SimulationPage from '../pages/SimulationPage'
// import LiveTrafficPage from '../pages/LiveTrafficPage'
// import ThreatIntelligencePage from '../pages/ThreatIntelligencePage'
// import ProfilePage from '../pages/ProfilePage'

// ------------------------------------------------------------------
// Protected Route Wrapper (حماية المسارات)
// ------------------------------------------------------------------

import ProtectedRoute from '../components/ProtectedRoute'

// ==================================================================
// Router Component
// ==================================================================

export default function AppRouter() {
  return (
    <Routes>
      {/* ============================================================
          Public Routes (مفتوحة للكل بدون تسجيل دخول)
      ============================================================ */}

      <Route path="/" element={<LandingPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      {/* /legal عشان /policies محجوزة لسياسات الـ Dashboard */}
      <Route path="/legal" element={<SitePoliciesPage />} />

      <Route path="/signup" element={<SignupPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* ============================================================
          Protected Routes (محتاجة تسجيل دخول وتحقق من الـ Token)
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

      {/* الصفحات المستقبلية / المعلقة حالياً (تتم إزالة التعليق عنها عند جاهزيتها) */}
      {/*
      <Route
        path="/simulation"
        element={
          <ProtectedRoute>
            <SimulationPage />
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
        path="/threat-intelligence"
        element={
          <ProtectedRoute>
            <ThreatIntelligencePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }1
      />
      */}

      {/* ============================================================
          Default Redirect
          أي مسار غير معروف → تحويل تلقائي لصفحة السيرفرات أو الداشبورد
          (ProtectedRoute سيتكفل بتحويل غير المسجل لصفحة الـ login تلقائياً)
      ============================================================ */}

      <Route path="*" element={<Navigate to="/servers" replace />} />
    </Routes>
  )
}