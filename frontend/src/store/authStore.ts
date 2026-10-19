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

export default useAuthStore