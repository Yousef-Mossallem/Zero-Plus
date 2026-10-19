// frontend/src/services/auth.service.ts
// ==================================================================
// Zero Plus - Authentication Service (WebAuthn / Passkeys)
// ==================================================================
//
// يتوافق مع الباك:
//   POST /auth/register/start
//   POST /auth/register/finish
//   POST /auth/login/start
//   POST /auth/login/finish
//   GET  /auth/me
//
// ومع الـ Store:
//   registerStart → startRegistration (browser) → registerFinish
//   loginStart    → startAuthentication (browser) → loginFinish
//
// ملاحظة:
//   استدعاء WebAuthn نفسه (نافذة البصمة) في الـ Store عبر
//   @simplewebauthn/browser — الملف ده مسؤول عن HTTP فقط.
// ==================================================================

import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import api from './api'

// ==================================================================
// Types — User / Organization / Response
// ==================================================================

export interface AuthUser {
  id: string
  email: string
  fullName: string
  role: string
  organizationId: string
  lastLoginAt?: string | null
  createdAt?: string
  uiPreferences?: unknown
}

export interface AuthOrganization {
  id: string
  name: string
  slug: string
  plan?: string
  sizeProfile?: string
}

export interface AuthPasskeySummary {
  id: string
  deviceName?: string | null
  transports?: string[]
  lastUsedAt?: string | null
  createdAt?: string
}

/**
 * الشكل اللي بيرجع بعد register/finish أو login/finish
 * (وده اللي الـ Store بيحطه في state)
 */
export interface AuthResponseData {
  token: string
  user: AuthUser
  organization: AuthOrganization
  passkey?: AuthPasskeySummary
}

/**
 * غلاف استجابة الباك الموحّد
 */
export interface AuthApiResponse<T> {
  success: boolean
  message?: string
  data: T
  errors?: unknown[]
}

export interface AuthApiError {
  success?: boolean
  message?: string
  errors?: unknown[]
}

// ==================================================================
// Request Types — متوافقة مع auth.schema في الباك
// ==================================================================

/** POST /auth/register/start */
export interface RegisterStartRequest {
  organizationName: string
  fullName: string
  email: string
  sizeProfile?: 'small' | 'medium' | 'large'
  /** اختياري تمامًا — مش للدخول */
  password?: string
}

/** رد register/start */
export interface RegisterStartResult {
  options: PublicKeyCredentialCreationOptionsJSON
  rpId: string
}

/** POST /auth/register/finish */
export interface RegisterFinishRequest {
  email: string
  deviceName?: string
  credential: RegistrationResponseJSON
}

/** POST /auth/login/start */
export interface LoginStartRequest {
  email: string
}

/** رد login/start */
export interface LoginStartResult {
  options: PublicKeyCredentialRequestOptionsJSON
  rpId: string
}

/** POST /auth/login/finish */
export interface LoginFinishRequest {
  email: string
  credential: AuthenticationResponseJSON
}

/** aliases لو الـ Store بيستخدم الأسماء دي */
export type SignupRequest = RegisterStartRequest
export type LoginRequest = LoginStartRequest

// ==================================================================
// Error helper
// ==================================================================

/**
 * يستخرج رسالة مفهومة من Axios أو Error عادي
 */
export function getAuthErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (typeof error === 'object' && error !== null) {
    const axiosError = error as {
      response?: { data?: AuthApiError; status?: number }
      message?: string
    }

    const backendMessage = axiosError.response?.data?.message
    if (backendMessage) return backendMessage

    if (axiosError.message) return axiosError.message
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

// ==================================================================
// Token keys — لازم تطابق api.ts interceptor
// ==================================================================

export const AUTH_TOKEN_KEY = 'zp_token'
const USER_KEY = 'zp_user'
const ORG_KEY = 'zp_organization'

export function saveToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export function getToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function removeToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

export function hasToken(): boolean {
  return Boolean(getToken())
}

// ==================================================================
// Session helpers
// ==================================================================

export function saveAuthSession(data: AuthResponseData): void {
  saveToken(data.token)
  localStorage.setItem(USER_KEY, JSON.stringify(data.user))
  localStorage.setItem(ORG_KEY, JSON.stringify(data.organization))
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    localStorage.removeItem(USER_KEY)
    return null
  }
}

export function getStoredOrganization(): AuthOrganization | null {
  const raw = localStorage.getItem(ORG_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthOrganization
  } catch {
    localStorage.removeItem(ORG_KEY)
    return null
  }
}

/**
 * مسح الجلسة محليًا (Logout أو توكن باطل)
 */
export function clearAuthSession(): void {
  removeToken()
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(ORG_KEY)
}

/**
 * بعد أي finish ناجح: نحفظ التوكن + cache للـ UI
 */
function persistAfterAuth(data: AuthResponseData): AuthResponseData {
  saveAuthSession(data)
  return data
}

// ==================================================================
// API — Registration (إنشاء حساب)
// ==================================================================

/**
 * الخطوة 1: إرسال بيانات الشركة والمستخدم
 * الباك يرجع PublicKeyCredentialCreationOptionsJSON (challenge)
 *
 * POST /auth/register/start
 */
export async function registerStart(
  data: RegisterStartRequest,
): Promise<RegisterStartResult> {
  const response = await api.post<AuthApiResponse<RegisterStartResult>>(
    '/auth/register/start',
    {
      organizationName: data.organizationName.trim(),
      fullName: data.fullName.trim(),
      email: data.email.trim().toLowerCase(),
      ...(data.sizeProfile ? { sizeProfile: data.sizeProfile } : {}),
      ...(data.password ? { password: data.password } : {}),
    },
  )

  return response.data.data
}

/**
 * الخطوة 3: بعد ما المستخدم خلّص navigator.credentials.create
 * نبعِت الـ credential → الباك يتحقق ويحفظ Public Key ويصدر JWT
 *
 * POST /auth/register/finish
 */
export async function registerFinish(
  data: RegisterFinishRequest,
): Promise<AuthResponseData> {
  const response = await api.post<AuthApiResponse<AuthResponseData>>(
    '/auth/register/finish',
    {
      email: data.email.trim().toLowerCase(),
      ...(data.deviceName ? { deviceName: data.deviceName } : {}),
      credential: data.credential,
    },
  )

  return persistAfterAuth(response.data.data)
}

// ==================================================================
// API — Login
// ==================================================================

/**
 * الخطوة 1: بالإيميل نجيب authentication options
 *
 * POST /auth/login/start
 */
export async function loginStart(
  data: LoginStartRequest,
): Promise<LoginStartResult> {
  const response = await api.post<AuthApiResponse<LoginStartResult>>(
    '/auth/login/start',
    {
      email: data.email.trim().toLowerCase(),
    },
  )

  return response.data.data
}

/**
 * الخطوة 3: بعد navigator.credentials.get
 * تحقق من التوقيع + JWT
 *
 * POST /auth/login/finish
 */
export async function loginFinish(
  data: LoginFinishRequest,
): Promise<AuthResponseData> {
  const response = await api.post<AuthApiResponse<AuthResponseData>>(
    '/auth/login/finish',
    {
      email: data.email.trim().toLowerCase(),
      credential: data.credential,
    },
  )

  return persistAfterAuth(response.data.data)
}

// ==================================================================
// API — Current user
// ==================================================================

/**
 * GET /auth/me
 * الـ api interceptor بيضيف Authorization: Bearer <token>
 */
export async function getMe(): Promise<
  AuthUser & {
    organization: AuthOrganization
    passkeys?: AuthPasskeySummary[]
  }
> {
  const response = await api.get<
    AuthApiResponse<
      AuthUser & {
        organization: AuthOrganization
        passkeys?: AuthPasskeySummary[]
      }
    >
  >('/auth/me')

  return response.data.data
}

// ==================================================================
// API — Passkeys management (اختياري للـ Profile)
// ==================================================================

export async function listPasskeys(): Promise<AuthPasskeySummary[]> {
  const response = await api.get<AuthApiResponse<AuthPasskeySummary[]>>(
    '/auth/passkeys',
  )
  return response.data.data
}

export async function addPasskeyStart(): Promise<RegisterStartResult> {
  const response = await api.post<AuthApiResponse<RegisterStartResult>>(
    '/auth/passkeys/register/start',
  )
  return response.data.data
}

export async function addPasskeyFinish(data: {
  deviceName?: string
  credential: RegistrationResponseJSON
}): Promise<AuthPasskeySummary> {
  const response = await api.post<AuthApiResponse<AuthPasskeySummary>>(
    '/auth/passkeys/register/finish',
    data,
  )
  return response.data.data
}

export async function revokePasskey(passkeyId: string): Promise<void> {
  await api.delete('/auth/passkeys', {
    data: { passkeyId },
  })
}

// ==================================================================
// Default export
// ==================================================================

const authService = {
  registerStart,
  registerFinish,
  loginStart,
  loginFinish,
  getMe,
  listPasskeys,
  addPasskeyStart,
  addPasskeyFinish,
  revokePasskey,

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