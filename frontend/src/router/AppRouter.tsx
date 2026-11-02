// frontend/src/router/AppRouter.tsx

// ==================================================================
// Zero Plus - Application Router
// كل صفحات النظام وتوزيعها على المسارات (Routes)
// ==================================================================

import { Routes, Route, Navigate } from 'react-router-dom'

// ------------------------------------------------------------------
// Auth Pages
// ------------------------------------------------------------------

import SignupPage from '../pages/SignupPage'
import LoginPage from '../pages/LoginPage'

// ------------------------------------------------------------------
// Core Pages
// ------------------------------------------------------------------

import DashboardPage from '../pages/DashboardPage'
import SimulationPage from '../pages/SimulationPage'
import SecurityEventsPage from '../pages/SecurityEventsPage'
import ReputationPage from '../pages/ReputationPage'

// ------------------------------------------------------------------
// Secondary Pages
// ------------------------------------------------------------------

// TODO: هتتشال الكومنت دي لما LiveTrafficPage.tsx يتعمل
// import LiveTrafficPage from '../pages/LiveTrafficPage'

import ReportsPage from '../pages/ReportsPage'

// TODO: هتتشال الكومنت دي لما ThreatIntelligencePage.tsx يتعمل
// import ThreatIntelligencePage from '../pages/ThreatIntelligencePage'

import ServersPage from '../pages/ServersPage'
import OrganizationsPage from '../pages/OrganizationsPage'
import NotificationsPage from '../pages/NotificationsPage'
import PoliciesPage from '../pages/PoliciesPage'
import ProfilePage from '../pages/ProfilePage'

// ------------------------------------------------------------------
// Protected Route Wrapper (يحمي أي صفحة محتاجة تسجيل دخول)
// ------------------------------------------------------------------

// بيتأكد إن فيه token قبل ما يعرض الصفحة
import ProtectedRoute from '../components/ProtectedRoute'

// ==================================================================
// Router Component
// ==================================================================

export default function AppRouter() {
  return (
    <Routes>
      {/* ============================================================
          Public Routes (مفتوحة للكل، من غير تسجيل دخول)
      ============================================================ */}

      <Route path="/signup" element={<SignupPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* ============================================================
          Protected Routes (محتاجة تسجيل دخول)
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
        path="/simulation"
        element={
          <ProtectedRoute>
            <SimulationPage />
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

      {/* TODO: هتتشال الكومنت دي لما LiveTrafficPage.tsx يتعمل */}
      {/*
      <Route
        path="/live-traffic"
        element={
          <ProtectedRoute>
            <LiveTrafficPage />
          </ProtectedRoute>
        }
      />
      */}

      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <ReportsPage />
          </ProtectedRoute>
        }
      />

      {/* TODO: هتتشال الكومنت دي لما ThreatIntelligencePage.tsx يتعمل */}
      {/*
      <Route
        path="/threat-intelligence"
        element={
          <ProtectedRoute>
            <ThreatIntelligencePage />
          </ProtectedRoute>
        }
      />
      */}

      <Route
        path="/servers"
        element={
          <ProtectedRoute>
            <ServersPage />
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
        path="/notifications"
        element={
          <ProtectedRoute>
            <NotificationsPage />
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
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />

      {/* ============================================================
          Default Redirect
          أي مسار غير معروف → أول صفحة جاهزة (ProtectedRoute بيرجّع
          غير المسجّل لـ /login لوحده)
      ============================================================ */}

      <Route path="*" element={<Navigate to="/security-events" replace />} />
    </Routes>
  )
}