// frontend/src/store/auth.store.ts
// ==================================================================
// Zero Plus - Authentication Store (WebAuthn / Passkeys)
// ==================================================================
//
// التدفق الجديد (مش إيميل+باسورد):
//
//   Signup:
//     1) registerStart(org, name, email) → options من الباك
//     2) navigator / @simplewebauthn → المستخدم يحط بصمته
//     3) registerFinish(email, credential) → JWT + User + Org
//
//   Login:
//     1) loginStart(email) → options
//     2) المستخدم يحط بصمته
//     3) loginFinish(email, credential) → JWT
//
// الـ Store هنا بيلف الخطوات دي عشان الصفحات تفضل بسيطة:
//   await signup({ organizationName, fullName, email, sizeProfile })
//   await login({ email })
//
// ==================================================================

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser'

import {
  registerStart,
  registerFinish,
  loginStart,
  loginFinish,
  getMe,
  clearAuthSession,
  getAuthErrorMessage,
  startTeamInvite,
  finishTeamInvite,
  type AuthUser,
  type AuthOrganization,
  type AuthResponseData,
  type RegisterStartRequest,
  type LoginStartRequest,
} from '../services/authService'

// ==================================================================
// Types
// ==================================================================

/**
 * idle            → لسه مفيش عملية
 * loading         → start / finish / restore شغال
 * authenticated   → معاه JWT صالح
 * unauthenticated → مش داخل
 */
export type AuthStatus =
  | 'idle'
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'

export interface AuthState {
  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------

  /** JWT بعد register/finish أو login/finish */
  token: string | null

  user: AuthUser | null

  organization: AuthOrganization | null

  status: AuthStatus

  /**
   * هل خلصنا محاولة استعادة الجلسة من localStorage + /auth/me؟
   * الصفحات المحمية تستنى initialized === true قبل ما تقرر redirect.
   */
  initialized: boolean

  /** آخر رسالة خطأ للعرض في الـ UI */
  error: string | null

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  /**
   * إنشاء حساب كامل:
   * register/start → WebAuthn create → register/finish
   *
   * بيرجع success:false لو المستخدم لغى نافذة البصمة أو فشل التحقق.
   */
  signup: (
    data: RegisterStartRequest,
  ) => Promise<{ success: boolean; error?: string }>

  /**
   * تسجيل دخول كامل:
   * login/start → WebAuthn get → login/finish
   */
  login: (
    data: LoginStartRequest,
  ) => Promise<{ success: boolean; error?: string }>

  /**
   * عند فتح التطبيق: لو فيه token → GET /auth/me
   * لو فشل → نمسح الجلسة
   */
  initializeAuth: () => Promise<void>

  /** إعادة جلب /auth/me */
  refreshUser: () => Promise<boolean>

  logout: () => void

  clearError: () => void

  /**
   * قبول دعوة فريق:
   * start → WebAuthn create → finish → حفظ JWT → authenticated
   */
  acceptTeamInvite: (
    token: string,
    opts?: { fullName?: string; deviceName?: string },
  ) => Promise<{ success: boolean; error?: string }>

  /** تحديث التوكن محلياً (مثلاً من X-Access-Token header) */
  updateToken: (newToken: string) => void

  /** هل لدى المستخدم صلاحية معينة */
  hasPermission: (permission: string) => boolean
}

// ==================================================================
// Helpers
// ==================================================================

/**
 * بعد ما الباك يرجع token + user + organization
 * نحدّث الـ state دفعة واحدة.
 */
function applyAuthData(
  data: AuthResponseData,
): Pick<AuthState, 'token' | 'user' | 'organization' | 'status' | 'error'> {
  return {
    token: data.token,
    user: data.user,
    organization: data.organization,
    status: 'authenticated',
    error: null,
  }
}

/**
 * رسائل WebAuthn الشائعة من المتصفح (إلغاء المستخدم، مفيش authenticator...)
 */
function getWebAuthnErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const name = error.name
    const msg = error.message.toLowerCase()

    if (name === 'NotAllowedError') {
      return 'تم إلغاء التحقق بالبصمة أو انتهت المهلة'
    }
    if (name === 'InvalidStateError') {
      return 'هذا المفتاح مسجّل بالفعل على هذا الجهاز'
    }
    if (name === 'NotSupportedError') {
      return 'جهازك أو متصفحك لا يدعم Passkeys'
    }
    if (name === 'SecurityError') {
      return 'بيئة غير آمنة — WebAuthn يحتاج HTTPS أو localhost'
    }
    if (msg.includes('timed out') || msg.includes('timeout')) {
      return 'انتهت مهلة التحقق بالبصمة — حاول مرة أخرى'
    }

    return error.message || fallback
  }

  return fallback
}

// ==================================================================
// Store
// ==================================================================

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // ================================================================
      // Initial State
      // ================================================================

      token: null,
      user: null,
      organization: null,
      status: 'idle',
      initialized: false,
      error: null,

      // ================================================================
      // Signup = register/start → create() → register/finish
      // ================================================================

      signup: async (data: RegisterStartRequest) => {
        set({ status: 'loading', error: null })

        try {
          // ----------------------------------------------------------
          // 1) الباك يجهّز challenge + options
          // ----------------------------------------------------------
          const startResult = await registerStart(data)
          // متوقع: { options, rpId }

          // ----------------------------------------------------------
          // 2) المتصفح يطلب البصمة / الوجه
          //    startRegistration من @simplewebauthn/browser
          // ----------------------------------------------------------
          const credential = await startRegistration({
            optionsJSON: startResult.options,
          })

          // ----------------------------------------------------------
          // 3) نبعِت الـ credential للباك عشان يتحقق ويحفظ Public Key
          // ----------------------------------------------------------
          const finishResult = await registerFinish({
            email: data.email.trim().toLowerCase(),
            deviceName: undefined, // ممكن الفرونت يخمّن اسم الجهاز لاحقًا
            credential,
          })

          set({ ...applyAuthData(finishResult) })

          return { success: true }
        } catch (error: unknown) {
          // لو الخطأ من WebAuthn (إلغاء المستخدم) ولا من الـ API
          const message =
            error &&
            typeof error === 'object' &&
            'name' in error &&
            typeof (error as { name: string }).name === 'string' &&
            [
              'NotAllowedError',
              'InvalidStateError',
              'NotSupportedError',
              'SecurityError',
              'AbortError',
            ].includes((error as { name: string }).name)
              ? getWebAuthnErrorMessage(
                  error,
                  'فشل إنشاء الحساب بالبصمة',
                )
              : getAuthErrorMessage(
                  error,
                  'فشل إنشاء الحساب. حاول مرة أخرى.',
                )

          set({
            token: null,
            user: null,
            organization: null,
            status: 'unauthenticated',
            error: message,
          })

          return { success: false, error: message }
        }
      },

      // ================================================================
      // Login = login/start → get() → login/finish
      // ================================================================

      login: async (data: LoginStartRequest) => {
        set({ status: 'loading', error: null })

        try {
          const email = data.email.trim().toLowerCase()

          // ----------------------------------------------------------
          // 1) options من الباك (فيها allowCredentials)
          // ----------------------------------------------------------
          const startResult = await loginStart({ email })

          // ----------------------------------------------------------
          // 2) نافذة البصمة
          // ----------------------------------------------------------
          const credential = await startAuthentication({
            optionsJSON: startResult.options,
          })

          // ----------------------------------------------------------
          // 3) تحقق + JWT
          // ----------------------------------------------------------
          const finishResult = await loginFinish({
            email,
            credential,
          })

          set({ ...applyAuthData(finishResult) })

          return { success: true }
        } catch (error: unknown) {
          const message =
            error &&
            typeof error === 'object' &&
            'name' in error &&
            typeof (error as { name: string }).name === 'string' &&
            [
              'NotAllowedError',
              'InvalidStateError',
              'NotSupportedError',
              'SecurityError',
              'AbortError',
            ].includes((error as { name: string }).name)
              ? getWebAuthnErrorMessage(
                  error,
                  'فشل تسجيل الدخول بالبصمة',
                )
              : getAuthErrorMessage(
                  error,
                  'فشل تسجيل الدخول. حاول مرة أخرى.',
                )

          set({
            token: null,
            user: null,
            organization: null,
            status: 'unauthenticated',
            error: message,
          })

          return { success: false, error: message }
        }
      },

      // ================================================================
      // Initialize — أول ما التطبيق يفتح
      // ================================================================

      initializeAuth: async () => {
        if (get().initialized) return

        const currentToken = get().token

        if (!currentToken) {
          set({
            status: 'unauthenticated',
            initialized: true,
            error: null,
          })
          return
        }

        set({ status: 'loading', error: null })

        try {
          const currentUser = await getMe()

          set({
            user: currentUser,
            organization: currentUser.organization ?? get().organization,
            status: 'authenticated',
            initialized: true,
            error: null,
          })
        } catch {
          // التوكن باطل أو منتهي
          clearAuthSession()

          set({
            token: null,
            user: null,
            organization: null,
            status: 'unauthenticated',
            initialized: true,
            error: null,
          })
        }
      },

      // ================================================================
      // Refresh User
      // ================================================================

      refreshUser: async () => {
        if (!get().token) {
          set({ status: 'unauthenticated' })
          return false
        }

        try {
          const currentUser = await getMe()

          set({
            user: currentUser,
            organization: currentUser.organization ?? get().organization,
            status: 'authenticated',
            error: null,
          })

          return true
        } catch (error: unknown) {
          const message = getAuthErrorMessage(
            error,
            'انتهت صلاحية الجلسة.',
          )

          clearAuthSession()

          set({
            token: null,
            user: null,
            organization: null,
            status: 'unauthenticated',
            error: message,
          })

          return false
        }
      },

      // ================================================================
      // Logout
      // ================================================================

      logout: () => {
        clearAuthSession()

        set({
          token: null,
          user: null,
          organization: null,
          status: 'unauthenticated',
          initialized: true,
          error: null,
        })
      },

      clearError: () => {
        set({ error: null })
      },

      // ================================================================
      // Accept Team Invite
      // ================================================================

      acceptTeamInvite: async (inviteToken, opts = {}) => {
        set({ status: 'loading', error: null })
        try {
          // 1) start → WebAuthn options
          const startResult = await startTeamInvite(inviteToken, opts.fullName)

          // 2) navigator.credentials.create
          const { startRegistration: webauthnCreate } = await import(
            '@simplewebauthn/browser'
          )
          const credential = await webauthnCreate({ optionsJSON: startResult.options })

          // 3) finish → JWT
          const finishResult = await finishTeamInvite(inviteToken, {
            fullName: opts.fullName,
            deviceName: opts.deviceName,
            credential,
          })

          // 4) حفظ الجلسة
          clearAuthSession()
          const { saveToken } = await import('../services/authService')
          saveToken(finishResult.token)

          set({
            token: finishResult.token,
            user: finishResult.user,
            organization: finishResult.organization,
            status: 'authenticated',
            initialized: true,
            error: null,
          })

          return { success: true }
        } catch (error: unknown) {
          const isWebAuthn =
            error instanceof Error &&
            (error.name === 'NotAllowedError' ||
              error.name === 'InvalidStateError' ||
              error.name === 'NotSupportedError' ||
              error.name === 'SecurityError' ||
              error.name === 'AbortError')

          const message = isWebAuthn
            ? getWebAuthnErrorMessage(error, 'فشل تسجيل بصمة الدعوة')
            : getAuthErrorMessage(error, 'فشل قبول الدعوة. حاول مرة أخرى.')

          set({
            token: null,
            user: null,
            organization: null,
            status: 'unauthenticated',
            error: message,
          })

          return { success: false, error: message }
        }
      },

      // ================================================================
      // Update Token (تجديد صامت من X-Access-Token header)
      // ================================================================

      updateToken: (newToken: string) => {
        // نحدّث Zustand persist مباشرة عبر localStorage
        try {
          const raw = localStorage.getItem('zero-plus-auth')
          if (raw) {
            const parsed = JSON.parse(raw) as { state?: Record<string, unknown> }
            if (parsed.state) {
              parsed.state.token = newToken
              localStorage.setItem('zero-plus-auth', JSON.stringify(parsed))
            }
          }
        } catch {
          // ignore
        }
        set({ token: newToken })
      },

      // ================================================================
      // Has Permission
      // ================================================================

      hasPermission: (permission: string) => {
        const user = get().user
        return user?.permissions?.includes(permission) ?? false
      },
    }),

    // ==================================================================
    // Persist — نخزّن التوكن وبيانات العرض فقط
    // ==================================================================

    {
      name: 'zero-plus-auth',

      storage: createJSONStorage(() => localStorage),

      partialize: (state) => ({
        token: state.token,
        user: state.user,
        organization: state.organization,
      }),

      onRehydrateStorage: () => {
        return (state) => {
          if (!state) return
          // بعد ما نقرأ من localStorage لسه محتاجين /auth/me
          state.initialized = false
        }
      },
    },
  ),
)

// ==================================================================
// Selectors
// ==================================================================

export const selectIsAuthenticated = (state: AuthState): boolean =>
  state.status === 'authenticated'

export const selectIsLoading = (state: AuthState): boolean =>
  state.status === 'loading'

export const selectCurrentUser = (state: AuthState): AuthUser | null =>
  state.user

export const selectCurrentOrganization = (
  state: AuthState,
): AuthOrganization | null => state.organization

export const selectUserRole = (state: AuthState): string | null =>
  state.user?.role ?? null

export const selectOrganizationId = (state: AuthState): string | null =>
  state.user?.organizationId ?? null

export const selectIsInitialized = (state: AuthState): boolean =>
  state.initialized

export const selectUserPermissions = (state: AuthState): string[] =>
  state.user?.permissions ?? []

/**
 * هل المستخدم عنده الصلاحية؟ المصدر: user.permissions من GET /auth/me.
 * OWNER عنده كل الصلاحيات (نفس منطق الباك). لو permissions مش متاحة بترجع false.
 */
export const selectHasPermission =
  (permission: string) =>
  (state: AuthState): boolean => {
    const user = state.user
    if (!user) return false
    if (user.role === 'OWNER') return true
    return Array.isArray(user.permissions) && user.permissions.includes(permission)
  }

export default useAuthStore