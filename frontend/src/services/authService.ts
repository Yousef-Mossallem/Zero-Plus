
// frontend/src/services/auth.service.ts

// ==================================================================
// Zero Plus - Authentication Service
// كل عمليات Authentication الخاصة بالـ Frontend
// ==================================================================

import api from './api'

// ==================================================================
// Types
// ==================================================================

// ------------------------------------------------------------------
// User
// ------------------------------------------------------------------

export interface AuthUser {
  id: string
  email: string
  fullName: string
  role: string
  organizationId: string
  lastLoginAt?: string | null
  createdAt?: string
}

// ------------------------------------------------------------------
// Organization
// ------------------------------------------------------------------

export interface AuthOrganization {
  id: string
  name: string
  slug: string
  plan?: string
}

// ------------------------------------------------------------------
// Login / Signup Response
// ------------------------------------------------------------------

export interface AuthResponseData {
  token: string
  user: AuthUser
  organization: AuthOrganization
}

// ------------------------------------------------------------------
// API Response Wrapper
// ------------------------------------------------------------------

export interface AuthApiResponse<T> {
  success: boolean
  message?: string
  data: T
}

// ==================================================================
// Request Types
// ==================================================================

// ------------------------------------------------------------------
// Signup
// ------------------------------------------------------------------

export interface SignupRequest {
  organizationName: string
  fullName: string
  email: string
  password: string
}

// ------------------------------------------------------------------
// Login
// ------------------------------------------------------------------

export interface LoginRequest {
  email: string
  password: string
}

// ==================================================================
// Error Types
// ==================================================================

// الشكل المتوقع لأخطاء الـ Backend
//
// مثال:
//
// {
//   success: false,
//   message: "Invalid email or password"
// }
//
// أو:
//
// {
//   success: false,
//   message: "Validation failed",
//   errors: [...]
// }

export interface AuthApiError {
  success?: boolean
  message?: string
  errors?: unknown[]
}

// ==================================================================
// Helpers
// ==================================================================

/**
 * استخراج رسالة الخطأ القادمة من Axios / Backend.
 *
 * الهدف:
 * بدل ما كل Page تعمل نفس كود التعامل مع الأخطاء،
 * يبقى عندنا مكان واحد نستخرج منه الرسالة.
 */
export function getAuthErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  // --------------------------------------------------------------
  // Axios Error
  // --------------------------------------------------------------

  if (typeof error === 'object' && error !== null) {
    const axiosError = error as {
      response?: {
        data?: AuthApiError
      }
      message?: string
    }

    // Backend message
    const backendMessage = axiosError.response?.data?.message

    if (backendMessage) {
      return backendMessage
    }

    // Axios message
    if (axiosError.message) {
      return axiosError.message
    }
  }

  // --------------------------------------------------------------
  // Error عادي
  // --------------------------------------------------------------

  if (error instanceof Error && error.message) {
    return error.message
  }

  // --------------------------------------------------------------
  // Fallback
  // --------------------------------------------------------------

  return fallback
}

// ==================================================================
// Authentication API
// ==================================================================

/**
 * إنشاء حساب جديد.
 *
 * Backend:
 * POST /auth/signup
 *
 * Body:
 * {
 *   organizationName,
 *   fullName,
 *   email,
 *   password
 * }
 *
 * Response:
 * {
 *   success: true,
 *   message: "Account created successfully",
 *   data: {
 *     token,
 *     user,
 *     organization
 *   }
 * }
 */
export async function signup(
  data: SignupRequest,
): Promise<AuthResponseData> {
  const response = await api.post<AuthApiResponse<AuthResponseData>>(
    '/auth/signup',
    data,
  )

  return response.data.data
}

/**
 * تسجيل الدخول.
 *
 * Backend:
 * POST /auth/login
 *
 * Body:
 * {
 *   email,
 *   password
 * }
 *
 * Response:
 * {
 *   success: true,
 *   message: "Logged in successfully",
 *   data: {
 *     token,
 *     user,
 *     organization
 *   }
 * }
 */
export async function login(
  data: LoginRequest,
): Promise<AuthResponseData> {
  const response = await api.post<AuthApiResponse<AuthResponseData>>(
    '/auth/login',
    data,
  )

  return response.data.data
}

/**
 * جلب بيانات المستخدم الحالي.
 *
 * Backend:
 * GET /auth/me
 *
 * الـ api.ts بيضيف الـ JWT تلقائيًا في:
 *
 * Authorization: Bearer <token>
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     id,
 *     email,
 *     fullName,
 *     role,
 *     organizationId,
 *     lastLoginAt,
 *     createdAt,
 *     organization
 *   }
 * }
 */
export async function getMe(): Promise<AuthUser & {
  organization: AuthOrganization
}> {
  const response = await api.get<
    AuthApiResponse<
      AuthUser & {
        organization: AuthOrganization
      }
    >
  >('/auth/me')

  return response.data.data
}

// ==================================================================
// Token Management
// ==================================================================

// اسم الـ Token داخل localStorage.
//
// مهم جدًا:
// api.ts بيستخدم نفس الاسم:
//
// localStorage.getItem('zp_token')
//
export const AUTH_TOKEN_KEY = 'zp_token'

/**
 * حفظ JWT Token.
 */
export function saveToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

/**
 * جلب JWT Token.
 */
export function getToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

/**
 * حذف JWT Token.
 */
export function removeToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

/**
 * معرفة هل يوجد Token حاليًا.
 *
 * ملاحظة:
 * وجود Token لا يعني بالضرورة أنه صالح.
 * التحقق الحقيقي يتم عن طريق /auth/me.
 */
export function hasToken(): boolean {
  return Boolean(getToken())
}

// ==================================================================
// Auth Session Helpers
// ==================================================================

/**
 * حفظ بيانات Session كاملة بعد Login / Signup.
 *
 * الـ Token هو العنصر الأساسي للمصادقة.
 *
 * بيانات user و organization بنخزنها بشكل منفصل
 * عشان الـ UI يقدر يعرضها بسرعة بدون طلب API إضافي.
 */
export function saveAuthSession(data: AuthResponseData): void {
  saveToken(data.token)

  localStorage.setItem(
    'zp_user',
    JSON.stringify(data.user),
  )

  localStorage.setItem(
    'zp_organization',
    JSON.stringify(data.organization),
  )
}

/**
 * جلب المستخدم المخزن محليًا.
 *
 * دي بيانات Cache للـ UI،
 * وليست بديلًا عن /auth/me.
 */
export function getStoredUser(): AuthUser | null {
  const rawUser = localStorage.getItem('zp_user')

  if (!rawUser) {
    return null
  }

  try {
    return JSON.parse(rawUser) as AuthUser
  } catch {
    localStorage.removeItem('zp_user')
    return null
  }
}

/**
 * جلب Organization المخزنة محليًا.
 */
export function getStoredOrganization(): AuthOrganization | null {
  const rawOrganization = localStorage.getItem('zp_organization')

  if (!rawOrganization) {
    return null
  }

  try {
    return JSON.parse(rawOrganization) as AuthOrganization
  } catch {
    localStorage.removeItem('zp_organization')
    return null
  }
}

/**
 * مسح الـ Session بالكامل.
 *
 * بنستخدمها عند Logout أو لما الـ Token يبقى غير صالح.
 */
export function clearAuthSession(): void {
  removeToken()

  localStorage.removeItem('zp_user')
  localStorage.removeItem('zp_organization')
}

// ==================================================================
// Default Export
// ==================================================================

const authService = {
  signup,
  login,
  getMe,

  saveToken,
  getToken,
  removeToken,
  hasToken,

  saveAuthSession,
  getStoredUser,
  getStoredOrganization,
  clearAuthSession,

  getAuthErrorMessage,
}

export default authService
