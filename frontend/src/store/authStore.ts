// frontend/src/store/auth.store.ts

// ==================================================================
// Zero Plus - Authentication Store
// إدارة حالة المستخدم والـ Authentication على مستوى الـ Frontend
// ==================================================================

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import {
  signup,
  login,
  getMe,
  clearAuthSession,
  getAuthErrorMessage,
  type AuthUser,
  type AuthOrganization,
  type AuthResponseData,
  type SignupRequest,
  type LoginRequest,
} from '../services/authService'

// ==================================================================
// Types
// ==================================================================

// ------------------------------------------------------------------
// Auth Status
// ------------------------------------------------------------------

// idle
// لسه مفيش عملية Authentication بدأت.
//
// loading
// فيه Login / Signup / Restore Session شغال.
//
// authenticated
// المستخدم مسجل دخول.
//
// unauthenticated
// المستخدم مش مسجل دخول.

export type AuthStatus =
  | 'idle'
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'

// ==================================================================
// Store State
// ==================================================================

export interface AuthState {
  // --------------------------------------------------------------
  // Authentication Data
  // --------------------------------------------------------------

  token: string | null

  user: AuthUser | null

  organization: AuthOrganization | null

  // --------------------------------------------------------------
  // Authentication Status
  // --------------------------------------------------------------

  status: AuthStatus

  // --------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------

  // هل الـ Store خلص محاولة استعادة الـ Session؟
  initialized: boolean

  // --------------------------------------------------------------
  // Error
  // --------------------------------------------------------------

  error: string | null

  // ==================================================================
  // Actions
  // ==================================================================

  // --------------------------------------------------------------
  // Signup
  // --------------------------------------------------------------

  signup: (
    data: SignupRequest,
  ) => Promise<{
    success: boolean
    error?: string
  }>

  // --------------------------------------------------------------
  // Login
  // --------------------------------------------------------------

  login: (
    data: LoginRequest,
  ) => Promise<{
    success: boolean
    error?: string
  }>

  // --------------------------------------------------------------
  // Restore Session
  // --------------------------------------------------------------

  initializeAuth: () => Promise<void>

  // --------------------------------------------------------------
  // Refresh User
  // --------------------------------------------------------------

  refreshUser: () => Promise<boolean>

  // --------------------------------------------------------------
  // Logout
  // --------------------------------------------------------------

  logout: () => void

  // --------------------------------------------------------------
  // Error
  // --------------------------------------------------------------

  clearError: () => void
}

// ==================================================================
// Helper
// ==================================================================

/**
 * تطبيق بيانات Authentication على الـ Store.
 *
 * بنستخدمها بعد Login أو Signup.
 */
function applyAuthData(
  data: AuthResponseData,
): Pick<
  AuthState,
  'token' | 'user' | 'organization' | 'status' | 'error'
> {
  return {
    token: data.token,
    user: data.user,
    organization: data.organization,
    status: 'authenticated',
    error: null,
  }
}

// ==================================================================
// Zustand Store
// ==================================================================

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // ==============================================================
      // Initial State
      // ==============================================================

      token: null,

      user: null,

      organization: null,

      status: 'idle',

      initialized: false,

      error: null,

      // ==============================================================
      // Signup
      // ==============================================================

      signup: async (data: SignupRequest) => {
        // ------------------------------------------------------------
        // Start Loading
        // ------------------------------------------------------------

        set({
          status: 'loading',
          error: null,
        })

        try {
          // ----------------------------------------------------------
          // Call Backend
          // ----------------------------------------------------------

          const result = await signup(data)

          // ----------------------------------------------------------
          // Save Authentication Data
          // ----------------------------------------------------------

          set({
            ...applyAuthData(result),
          })

          // ----------------------------------------------------------
          // Success
          // ----------------------------------------------------------

          return {
            success: true,
          }
        } catch (error: unknown) {
          // ----------------------------------------------------------
          // Extract Backend Error
          // ----------------------------------------------------------

          const message = getAuthErrorMessage(
            error,
            'Account creation failed. Please try again.',
          )

          // ----------------------------------------------------------
          // Reset Authentication State
          // ----------------------------------------------------------

          set({
            token: null,
            user: null,
            organization: null,
            status: 'unauthenticated',
            error: message,
          })

          // ----------------------------------------------------------
          // Return Failure
          // ----------------------------------------------------------

          return {
            success: false,
            error: message,
          }
        }
      },

      // ==============================================================
      // Login
      // ==============================================================

      login: async (data: LoginRequest) => {
        // ------------------------------------------------------------
        // Start Loading
        // ------------------------------------------------------------

        set({
          status: 'loading',
          error: null,
        })

        try {
          // ----------------------------------------------------------
          // Call Backend
          // ----------------------------------------------------------

          const result = await login(data)

          // ----------------------------------------------------------
          // Save Authentication Data
          // ----------------------------------------------------------

          set({
            ...applyAuthData(result),
          })

          // ----------------------------------------------------------
          // Success
          // ----------------------------------------------------------

          return {
            success: true,
          }
        } catch (error: unknown) {
          // ----------------------------------------------------------
          // Extract Backend Error
          // ----------------------------------------------------------

          const message = getAuthErrorMessage(
            error,
            'Login failed. Please try again.',
          )

          // ----------------------------------------------------------
          // Reset Authentication State
          // ----------------------------------------------------------

          set({
            token: null,
            user: null,
            organization: null,
            status: 'unauthenticated',
            error: message,
          })

          // ----------------------------------------------------------
          // Return Failure
          // ----------------------------------------------------------

          return {
            success: false,
            error: message,
          }
        }
      },

      // ==============================================================
      // Initialize Authentication
      // ==============================================================

      /**
       * دي أهم function عند بداية تشغيل التطبيق.
       *
       * السيناريو:
       *
       * 1. Zustand يحاول يسترجع الـ persisted state.
       *
       * 2. لو مفيش Token:
       *    المستخدم غير مسجل دخول.
       *
       * 3. لو فيه Token:
       *    نبعت GET /auth/me للـ Backend.
       *
       * 4. لو الـ Token صالح:
       *    نحدث بيانات المستخدم.
       *
       * 5. لو الـ Token غير صالح:
       *    نمسح الـ Session.
       */
      initializeAuth: async () => {
        // ------------------------------------------------------------
        // Prevent Duplicate Initialization
        // ------------------------------------------------------------

        if (get().initialized) {
          return
        }

        const currentToken = get().token

        // ------------------------------------------------------------
        // No Token
        // ------------------------------------------------------------

        if (!currentToken) {
          set({
            status: 'unauthenticated',
            initialized: true,
            error: null,
          })

          return
        }

        // ------------------------------------------------------------
        // Verify Token With Backend
        // ------------------------------------------------------------

        set({
          status: 'loading',
          error: null,
        })

        try {
          const currentUser = await getMe()

          // ----------------------------------------------------------
          // Update User
          // ----------------------------------------------------------

          set({
            user: currentUser,
            organization: currentUser.organization,
            status: 'authenticated',
            initialized: true,
            error: null,
          })
        } catch {
          // ----------------------------------------------------------
          // Token Invalid / Expired / User Not Found
          // ----------------------------------------------------------

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

      // ==============================================================
      // Refresh Current User
      // ==============================================================

      /**
       * إعادة جلب بيانات المستخدم من:
       *
       * GET /auth/me
       *
       * مفيدة لو بيانات المستخدم تغيرت من Backend
       * ونحتاج أحدث نسخة.
       */
      refreshUser: async () => {
        const currentToken = get().token

        // ------------------------------------------------------------
        // No Token
        // ------------------------------------------------------------

        if (!currentToken) {
          set({
            status: 'unauthenticated',
          })

          return false
        }

        try {
          const currentUser = await getMe()

          set({
            user: currentUser,
            organization: currentUser.organization,
            status: 'authenticated',
            error: null,
          })

          return true
        } catch (error: unknown) {
          // ----------------------------------------------------------
          // Session Became Invalid
          // ----------------------------------------------------------

          const message = getAuthErrorMessage(
            error,
            'Your session is no longer valid.',
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

      // ==============================================================
      // Logout
      // ==============================================================

      logout: () => {
        // ------------------------------------------------------------
        // Clear Local Authentication Session
        // ------------------------------------------------------------

        clearAuthSession()

        // ------------------------------------------------------------
        // Reset Store
        // ------------------------------------------------------------

        set({
          token: null,
          user: null,
          organization: null,
          status: 'unauthenticated',
          initialized: true,
          error: null,
        })
      },

      // ==============================================================
      // Clear Error
      // ==============================================================

      clearError: () => {
        set({
          error: null,
        })
      },
    }),

    // ==================================================================
    // Zustand Persist Configuration
    // ==================================================================

    {
      name: 'zero-plus-auth',

      storage: createJSONStorage(() => localStorage),

      // --------------------------------------------------------------
      // Persist Only Authentication Data
      // --------------------------------------------------------------

      partialize: (state) => ({
        token: state.token,
        user: state.user,
        organization: state.organization,
      }),

      // --------------------------------------------------------------
      // After Zustand Restores Data
      // --------------------------------------------------------------

      onRehydrateStorage: () => {
        return (state) => {
          if (!state) {
            return
          }

          // الـ persisted data اتقرأت من localStorage.
          //
          // لسه لازم initializeAuth() يتصل بالـ Backend
          // للتأكد إن الـ Token مازال صالحًا.
          state.initialized = false
        }
      },
    },
  ),
)

// ==================================================================
// Selectors
// ==================================================================

/**
 * هل المستخدم مسجل دخول؟
 */
export const selectIsAuthenticated = (
  state: AuthState,
): boolean => {
  return state.status === 'authenticated'
}

/**
 * هل Authentication لسه بيجهز؟
 */
export const selectIsLoading = (
  state: AuthState,
): boolean => {
  return state.status === 'loading'
}

/**
 * المستخدم الحالي.
 */
export const selectCurrentUser = (
  state: AuthState,
): AuthUser | null => {
  return state.user
}

/**
 * الـ Organization الحالية.
 */
export const selectCurrentOrganization = (
  state: AuthState,
): AuthOrganization | null => {
  return state.organization
}

/**
 * User Role.
 */
export const selectUserRole = (
  state: AuthState,
): string | null => {
  return state.user?.role ?? null
}

/**
 * Organization ID.
 */
export const selectOrganizationId = (
  state: AuthState,
): string | null => {
  return state.user?.organizationId ?? null
}

/**
 * هل الـ Store خلص Initialization؟
 */
export const selectIsInitialized = (
  state: AuthState,
): boolean => {
  return state.initialized
}

// ==================================================================
// Default Export
// ==================================================================

export default useAuthStore
