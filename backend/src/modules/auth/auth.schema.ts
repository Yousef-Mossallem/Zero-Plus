
// ==================================================================
// Zero Plus - Auth Validation Schemas (Zod)
// كل البيانات اللي بتدخل نظام المصادقة بتتحقق هنا أولاً
// ==================================================================

import { z } from 'zod'

// ------------------------------------------------------------------
// قواعد مشتركة قابلة لإعادة الاستخدام
// ------------------------------------------------------------------

const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Invalid email format')
  .min(5, 'Email is too short')
  .max(255, 'Email is too long')
  .transform((val) => val.toLowerCase().trim())

const passwordSchema = z
  .string()
  .min(1, 'Password is required')
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')

const fullNameSchema = z
  .string()
  .min(1, 'Full name is required')
  .min(2, 'Full name must be at least 2 characters')
  .max(100, 'Full name is too long')
  .trim()

const organizationNameSchema = z
  .string()
  .min(1, 'Organization name is required')
  .min(2, 'Organization name must be at least 2 characters')
  .max(100, 'Organization name is too long')
  .trim()

// ------------------------------------------------------------------
// 1. Signup Schema (إنشاء حساب شركة جديدة)
// ------------------------------------------------------------------

// لما حد يعمل Signup بنعمل:
// - Organization جديدة
// - User جديد بدور OWNER مربوط بالشركة دي

export const signupSchema = z
  .object({
    organizationName: organizationNameSchema,

    fullName: fullNameSchema,

    email: emailSchema,

    password: passwordSchema,

    // لو حابب تضيف confirmPassword بعدين:
    // confirmPassword: z.string(),
  })
  .strict() // مش بنقبل أي حقول زيادة

// ------------------------------------------------------------------
// 2. Login Schema
// ------------------------------------------------------------------

export const loginSchema = z
  .object({
    email: emailSchema,

    password: z
      .string()
      .min(1, 'Password is required'),
  })
  .strict()

// ------------------------------------------------------------------
// 3. (اختياري) تحديث البروفايل - جاهز لو احتجناه بعدين
// ------------------------------------------------------------------

export const updateProfileSchema = z
  .object({
    fullName: fullNameSchema.optional(),

    // ممكن نضيف حقول تانية بعدين زي avatar أو phone
  })
  .strict()

// ------------------------------------------------------------------
// 4. (اختياري) تغيير كلمة المرور
// ------------------------------------------------------------------

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, 'Current password is required'),

    newPassword: passwordSchema,
  })
  .strict()

// ------------------------------------------------------------------
// Types المستخرجة من الـSchemas
// عشان نستخدمها في الـService والـRoutes
// ------------------------------------------------------------------

export type SignupInput = z.infer<typeof signupSchema>

export type LoginInput = z.infer<typeof loginSchema>

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
