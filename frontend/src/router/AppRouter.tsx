// frontend/src/router/AppRouter.tsx

// ==================================================================
// Zero Plus - Application Router
// كل صفحات النظام وتوزيعها على المسارات (Routes)
// ==================================================================

import { Routes, Route, Navigate } from 'react-router-dom'

// ------------------------------------------------------------------
// Auth Pages (شغالة دلوقتي)
// ------------------------------------------------------------------

// TODO: هتتشال الكومنت دي لما SignupPage.tsx يتعمل
import SignupPage from '../pages/SignupPage'

// TODO: هتتشال الكومنت دي لما LoginPage.tsx يتعمل
import LoginPage from '../pages/LoginPage'

// ------------------------------------------------------------------
// Core Pages (المرحلة الجاية)
// ------------------------------------------------------------------

// TODO: هتتشال الكومنت دي لما DashboardPage.tsx يتعمل
// import DashboardPage from '../pages/DashboardPage'

// TODO: هتتشال الكومنت دي لما SimulationPage.tsx يتعمل
// import SimulationPage from '../pages/SimulationPage'

import SecurityEventsPage from '../pages/SecurityEventsPage'

import ReputationPage from '../pages/ReputationPage'

// ------------------------------------------------------------------
// Secondary Pages (تتعمل في أي وقت فاضي، مش على الخط الحرج)
// ------------------------------------------------------------------

// TODO: هتتشال الكومنت دي لما LiveTrafficPage.tsx يتعمل
// import LiveTrafficPage from '../pages/LiveTrafficPage'

// TODO: هتتشال الكومنت دي لما ReportsPage.tsx يتعمل
// import ReportsPage from '../pages/ReportsPage'

// TODO: هتتشال الكومنت دي لما ThreatIntelligencePage.tsx يتعمل
// import ThreatIntelligencePage from '../pages/ThreatIntelligencePage'

import ServersPage from '../pages/ServersPage'

import OrganizationsPage from '../pages/OrganizationsPage'

// TODO: هتتشال الكومنت دي لما NotificationsPage.tsx يتعمل
// import NotificationsPage from '../pages/NotificationsPage'

import PoliciesPage from '../pages/PoliciesPage'

// TODO: هتتشال الكومنت دي لما ProfilePage.tsx يتعمل
// import ProfilePage from '../pages/ProfilePage'

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

      {/* TODO: هتتشال الكومنت دي لما SignupPage.tsx يتعمل */}
      <Route path="/signup" element={<SignupPage />} />

      {/* TODO: هتتشال الكومنت دي لما LoginPage.tsx يتعمل */}
      <Route path="/login" element={<LoginPage />} />

      {/* ============================================================
          Protected Routes (محتاجة تسجيل دخول)
          كل الصفحات دي لازم تتلف بـ <ProtectedRoute> لما يتعمل
      ============================================================ */}

      {/* مؤقتاً: Login/Signup بيوجّهوا لـ /dashboard، فبنحوّله لأول صفحة جاهزة.
          لما DashboardPage يتعمل: امسح الـ Route ده وفعّل الـ Route الأصلي تحت. */}
      <Route path="/dashboard" element={<Navigate to="/security-events" replace />} />

      {/* TODO: هتتشال الكومنت دي لما DashboardPage.tsx يتعمل */}
      {/*
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      */}

      {/* TODO: هتتشال الكومنت دي لما SimulationPage.tsx يتعمل */}
      {/*
      <Route
        path="/simulation"
        element={
          <ProtectedRoute>
            <SimulationPage />
          </ProtectedRoute>
        }
      />
      */}

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

      {/* TODO: هتتشال الكومنت دي لما ReportsPage.tsx يتعمل */}
      {/*
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <ReportsPage />
          </ProtectedRoute>
        }
      />
      */}

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

      {/* TODO: هتتشال الكومنت دي لما NotificationsPage.tsx يتعمل */}
      {/*
      <Route
        path="/notifications"
        element={
          <ProtectedRoute>
            <NotificationsPage />
          </ProtectedRoute>
        }
      />
      */}

      <Route
        path="/policies"
        element={
          <ProtectedRoute>
            <PoliciesPage />
          </ProtectedRoute>
        }
      />

      {/* TODO: هتتشال الكومنت دي لما ProfilePage.tsx يتعمل */}
      {/*
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      */}

      {/* ============================================================
          Default Redirect
          أي مسار غير معروف → أول صفحة جاهزة (ProtectedRoute بيرجّع
          غير المسجّل لـ /login لوحده)
      ============================================================ */}

      <Route path="*" element={<Navigate to="/security-events" replace />} />
    </Routes>
  )
}