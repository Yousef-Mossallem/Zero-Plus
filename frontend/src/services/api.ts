// frontend/src/services/api.ts
// ==================================================================
// Zero Plus - Frontend API Client
// Central Axios Instance
// ==================================================================
//
// متوافق مع:
//   - Zustand persist تحت المفتاح: zero-plus-auth
//   - auth.service (مفتاح zp_token كـ fallback)
//   - WebAuthn routes: /auth/register/* و /auth/login/*
//
// مهم:
//   لو 401 حصل أثناء login/register → مش بنمسح الجلسة
//   ولا بنبعت SESSION_EXPIRED (عشان منبوظش باقي الصفحات)
// ==================================================================

import axios, { type InternalAxiosRequestConfig } from 'axios'

// ------------------------------------------------------------------
// Environment
// ------------------------------------------------------------------

const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  throw new Error('❌ VITE_API_URL is missing in environment variables')
}

// ------------------------------------------------------------------
// Storage keys
// ------------------------------------------------------------------

/** مفتاح Zustand persist في auth.store.ts → name: 'zero-plus-auth' */
const AUTH_STORAGE_KEY = 'zero-plus-auth'

/**
 * مفتاح احتياطي لو auth.service حفظ التوكن مباشرة
 * (saveToken / saveAuthSession)
 */
const LEGACY_TOKEN_KEY = 'zp_token'

// ------------------------------------------------------------------
// Session expired event
// ------------------------------------------------------------------

/**
 * AppRouter (أو Layout) يسمع الحدث ده ويعمل redirect لـ /login
 * لما الجلسة تنتهي أثناء استخدام التطبيق — مش أثناء محاولة دخول فاشلة.
 */
export const SESSION_EXPIRED_EVENT = 'zp:session-expired'

// ------------------------------------------------------------------
// Read token
// ------------------------------------------------------------------

/**
 * 1) من Zustand persist: { state: { token, user, organization } }
 * 2) fallback: zp_token
 */
function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)

    if (raw) {
      const parsed = JSON.parse(raw) as {
        state?: { token?: string | null }
      }

      const fromStore = parsed?.state?.token
      if (fromStore) {
        return fromStore
      }
    }
  } catch {
    // JSON تالف — نكمل على الـ fallback
  }

  try {
    return localStorage.getItem(LEGACY_TOKEN_KEY)
  } catch {
    return null
  }
}

// ------------------------------------------------------------------
// Clear auth storage (الاتنين عشان متفضلش بقايا)
// ------------------------------------------------------------------

function clearStoredAuth(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // ignore
  }

  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    localStorage.removeItem('zp_user')
    localStorage.removeItem('zp_organization')
  } catch {
    // ignore
  }
}

// ------------------------------------------------------------------
// هل الطلب من مسارات المصادقة العامة؟
// لو 401 عليها = فشل دخول/تسجيل، مش انتهاء جلسة
// ------------------------------------------------------------------

function isPublicAuthRequest(url?: string): boolean {
  if (!url) return false

  // url ممكن يكون نسبي: /auth/login/start
  const path = url.replace(/^https?:\/\/[^/]+/i, '')

  const publicPaths = [
    '/auth/register/start',
    '/auth/register/finish',
    '/auth/login/start',
    '/auth/login/finish',
    // لو لسه فيه مسارات قديمة في مكان ما
    '/auth/signup',
    '/auth/login',
  ]

  return publicPaths.some(
    (p) => path === p || path.startsWith(`${p}?`) || path.endsWith(p),
  )
}

// ------------------------------------------------------------------
// Axios instance
// ------------------------------------------------------------------

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // WebAuthn finish ممكن ياخد لحظة على أجهزة بطيئة
  timeout: 20000,
})

// ------------------------------------------------------------------
// Request: Bearer token
// ------------------------------------------------------------------

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getStoredToken()

    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    return config
  },
  (error) => Promise.reject(error),
)

// ------------------------------------------------------------------
// Response: 401 handling
// ------------------------------------------------------------------

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const requestUrl =
      (error.config?.url as string | undefined) ??
      (error.config?.baseURL as string | undefined)

    if (status === 401) {
      // فشل login/register بالبصمة → متعملش clear ولا redirect
      if (!isPublicAuthRequest(requestUrl)) {
        clearStoredAuth()
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
      }
    }

    return Promise.reject(error)
  },
)

// ------------------------------------------------------------------
// Export
// ------------------------------------------------------------------

export default api