// frontend/src/services/api.ts

// ==================================================================
// Zero Plus - Frontend API Client
// Central Axios Instance
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
// Auth Storage Key
// ------------------------------------------------------------------

// لازم يكون نفس القيمة بالظبط اللي في auth.store.ts
// (السطر: name: 'zero-plus-auth' جوه إعدادات persist)
//
// لو غيّرت الاسم هناك، لازم تغيّره هنا كمان.

const AUTH_STORAGE_KEY = 'zero-plus-auth'

// ------------------------------------------------------------------
// Custom Event Name
// ------------------------------------------------------------------

// بنبعت الإشارة دي لما الـ Token يبقى غير صالح (401).
// أي مكون في التطبيق (زي AppRouter لاحقًا) يقدر يسمعها
// ويوجّه المستخدم لصفحة تسجيل الدخول.

export const SESSION_EXPIRED_EVENT = 'zp:session-expired'

// ------------------------------------------------------------------
// Read Token From Persisted Store
// ------------------------------------------------------------------

// Zustand persist بيحفظ الـ state كله كـ JSON string تحت المفتاح ده،
// بالشكل: { "state": { "token": "...", "user": {...}, ... }, "version": 0 }
//
// إحنا محتاجين الـ token بس، فبنستخرجه من جوه الـ JSON ده.

function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw)

    return parsed?.state?.token ?? null
  } catch {
    // لو الـ JSON اتبعتر أو اتلخبط لأي سبب، نتعامل معاه
    // كأنه مفيش token خالص، بدل ما نكسر التطبيق كله.
    return null
  }
}

// ------------------------------------------------------------------
// Clear Persisted Auth Data
// ------------------------------------------------------------------

// بنمسح بيانات الجلسة مباشرة من localStorage.
// مش بنستخدم useAuthStore.getState().logout() هنا عمداً،
// عشان نتجنب أي احتمال لـ Circular Import بين api.ts و auth.store.ts.

function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY)
}

// ------------------------------------------------------------------
// Axios Instance
// ------------------------------------------------------------------

// كل طلبات الـ Frontend للـ Backend هتستخدم الـ instance ده.
// بدل ما نكرر:
// axios.get('http://localhost:4000/...')
// في كل ملف، هنستخدم:
// api.get('/events')
// api.post('/auth/login')
// وهكذا.

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
})

// ------------------------------------------------------------------
// Request Interceptor
// ------------------------------------------------------------------

// قبل ما أي Request يطلع للـ Backend، بنضيف JWT Token
// لو موجود عندنا في localStorage (جوه بيانات الـ Store المحفوظة).
//
// مثال:
// Authorization: Bearer eyJhbGciOi...

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getStoredToken()

    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    return config
  },
  (error) => {
    return Promise.reject(error)
  },
)

// ------------------------------------------------------------------
// Response Interceptor
// ------------------------------------------------------------------

// هنا بنتعامل مع أخطاء الـ Authentication بشكل موحّد.
//
// لو الـ Backend رجع 401، معناه الـ Token انتهى أو غير صالح.
// بنعمل حاجتين:
//   1. نمسح بيانات الجلسة القديمة من localStorage
//   2. نبعت Custom Event عشان أي جزء تاني في التطبيق
//      (زي AppRouter) يقدر يوجّه المستخدم لصفحة تسجيل الدخول
//
// إحنا مش بنعمل redirect مباشر من هنا، عشان api.ts
// ملوش أي علاقة بالـ Router — ده مش شغله.

api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    if (error.response?.status === 401) {
      clearStoredAuth()

      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
    }

    return Promise.reject(error)
  },
)

// ------------------------------------------------------------------
// Export
// ------------------------------------------------------------------

// تقدر تستخدم api من أي Service:
//
// import { api } from './api'
//
// await api.get('/events')
// await api.post('/servers', data)
// await api.post('/auth/login', data)

export default api