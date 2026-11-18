/**
 * ==================================================================
 * Zero Plus - Auth Validation Schemas (Zod)
 * ==================================================================
 * نظام المصادقة: WebAuthn / Passkeys
 *
 * الفكرة:
 *   - المستخدم يعمل حساب بـ (اسم الشركة + الاسم + الإيميل)
 *   - ثم يسجّل Passkey على جهازه (بصمة إصبع / وجه / Windows Hello)
 *   - السيرفر يخزّن Public Key فقط داخل PasskeyCredential
 *   - Private Key ما بيسيبش جهاز المستخدم أبدًا
 *
 * التدفق:
 *   Signup:
 *     1) POST /auth/register/start
 *     2) navigator.credentials.create(...)
 *     3) POST /auth/register/finish → JWT + permissions
 *
 *   Login:
 *     1) POST /auth/login/start
 *     2) navigator.credentials.get(...)
 *     3) POST /auth/login/finish → JWT + permissions
 *
 *   إضافة جهاز (QR) لمستخدم موجود:
 *     POST /auth/passkeys/invite
 *     GET  /auth/passkeys/invite/:token
 *     POST /auth/passkeys/invite/:token/finish
 *
 *   قبول دعوة فريق (عضو جديد):
 *     GET  /auth/team-invite/:token
 *     POST /auth/team-invite/:token/start
 *     POST /auth/team-invite/:token/finish → User + Passkey + JWT
 *
 * معتمد على Prisma:
 *   User, Organization, PasskeyCredential, Policy,
 *   PasskeyInvite, TeamInvite, PermissionGroup, GroupMembership
 * ==================================================================
 */

import { z } from 'zod'

// ------------------------------------------------------------------
// قواعد مشتركة قابلة لإعادة الاستخدام
// ------------------------------------------------------------------

/** البريد: للعرض والتواصل وربط الحساب — مش سر الدخول */
const emailSchema = z
  .string()
  .min(1, 'البريد الإلكتروني مطلوب')
  .email('صيغة البريد غير صحيحة')
  .min(5, 'البريد قصير جدًا')
  .max(255, 'البريد طويل جدًا')
  .transform((val) => val.toLowerCase().trim())

/** الاسم الكامل لصاحب الحساب */
const fullNameSchema = z
  .string()
  .min(1, 'الاسم الكامل مطلوب')
  .min(2, 'الاسم يجب ألا يقل عن حرفين')
  .max(100, 'الاسم طويل جدًا')
  .trim()

/** اسم الشركة / المنظمة */
const organizationNameSchema = z
  .string()
  .min(1, 'اسم الشركة مطلوب')
  .min(2, 'اسم الشركة يجب ألا يقل عن حرفين')
  .max(100, 'اسم الشركة طويل جدًا')
  .trim()

/**
 * حجم الترافيك التقريبي
 * يُستخدم لتوجيه نقطة بداية موديل الـ AI (Organization.sizeProfile)
 */
const sizeProfileSchema = z
  .enum(['small', 'medium', 'large'], {
    message: 'حجم الترافيك يجب أن يكون small أو medium أو large',
  })
  .default('medium')

/**
 * اسم الجهاز للعرض في Profile
 * مثال: "iPhone Face ID" / "Windows Hello" / "Android Fingerprint"
 */
const deviceNameSchema = z
  .string()
  .max(120, 'اسم الجهاز طويل جدًا')
  .trim()
  .optional()

/**
 * Base64URL string — الشكل اللي WebAuthn بيبعت بيه
 */
const base64UrlSchema = z
  .string()
  .min(1, 'قيمة WebAuthn فارغة')
  .max(8192, 'قيمة WebAuthn طويلة جدًا')
  .regex(/^[A-Za-z0-9_-]+$/, 'صيغة Base64URL غير صحيحة')

/**
 * كلمة مرور اختيارية تمامًا
 * مش وسيلة الدخول — احتياطي لحالات نادرة (أدمن / استعادة)
 */
const optionalPasswordSchema = z
  .string()
  .min(8, 'كلمة المرور يجب ألا تقل عن 8 أحرف')
  .max(128, 'كلمة المرور طويلة جدًا')
  .regex(/[a-z]/, 'يجب أن تحتوي على حرف صغير')
  .regex(/[A-Z]/, 'يجب أن تحتوي على حرف كبير')
  .regex(/[0-9]/, 'يجب أن تحتوي على رقم')
  .optional()

// ------------------------------------------------------------------
// WebAuthn — أشكال الـ Client Responses
// ------------------------------------------------------------------

/**
 * بعد navigator.credentials.create() — Registration
 */
const registrationResponseSchema = z
  .object({
    id: z.string().min(1),
    rawId: base64UrlSchema,
    type: z.literal('public-key'),
    authenticatorAttachment: z
      .enum(['platform', 'cross-platform'])
      .optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
    response: z.object({
      clientDataJSON: base64UrlSchema,
      attestationObject: base64UrlSchema,
      transports: z
        .array(
          z.enum(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card']),
        )
        .optional(),
      publicKeyAlgorithm: z.number().optional(),
      publicKey: base64UrlSchema.optional(),
      authenticatorData: base64UrlSchema.optional(),
    }),
  })
  .strict()

/**
 * بعد navigator.credentials.get() — Authentication
 */
const authenticationResponseSchema = z
  .object({
    id: z.string().min(1),
    rawId: base64UrlSchema,
    type: z.literal('public-key'),
    authenticatorAttachment: z
      .enum(['platform', 'cross-platform'])
      .optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
    response: z.object({
      clientDataJSON: base64UrlSchema,
      authenticatorData: base64UrlSchema,
      signature: base64UrlSchema,
      userHandle: z.string().nullable().optional(),
    }),
  })
  .strict()

// ==================================================================
// 1) REGISTER START
//    POST /auth/register/start
// ==================================================================

export const registerStartSchema = z
  .object({
    organizationName: organizationNameSchema,
    fullName: fullNameSchema,
    email: emailSchema,
    sizeProfile: sizeProfileSchema,
    password: optionalPasswordSchema,
  })
  .strict()

// ==================================================================
// 2) REGISTER FINISH
//    POST /auth/register/finish
// ==================================================================

export const registerFinishSchema = z
  .object({
    email: emailSchema,
    deviceName: deviceNameSchema,
    credential: registrationResponseSchema,
  })
  .strict()

// ==================================================================
// 3) LOGIN START
//    POST /auth/login/start
// ==================================================================

export const loginStartSchema = z
  .object({
    email: emailSchema,
  })
  .strict()

// ==================================================================
// 4) LOGIN FINISH
//    POST /auth/login/finish
// ==================================================================

export const loginFinishSchema = z
  .object({
    email: emailSchema,
    credential: authenticationResponseSchema,
  })
  .strict()

// ==================================================================
// 5) ADD PASSKEY START (قديم — إن وُجدت routes)
//    POST /auth/passkeys/register/start
// ==================================================================

export const addPasskeyStartSchema = z
  .object({})
  .strict()
  .optional()
  .default({})

// ==================================================================
// 6) ADD PASSKEY FINISH (قديم)
//    POST /auth/passkeys/register/finish
// ==================================================================

export const addPasskeyFinishSchema = z
  .object({
    deviceName: deviceNameSchema,
    credential: registrationResponseSchema,
  })
  .strict()

// ==================================================================
// 7) REVOKE PASSKEY
//    DELETE /auth/passkeys
// ==================================================================

export const revokePasskeySchema = z
  .object({
    passkeyId: z.string().uuid('معرّف الـ Passkey غير صالح'),
  })
  .strict()

// ==================================================================
// 8) UPDATE PROFILE
//    PATCH /auth/profile
// ==================================================================

export const updateProfileSchema = z
  .object({
    fullName: fullNameSchema.optional(),
  })
  .strict()

// ==================================================================
// 9) SET OPTIONAL PASSWORD
//    POST /auth/password
// ==================================================================

export const setPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'كلمة المرور يجب ألا تقل عن 8 أحرف')
      .max(128)
      .regex(/[a-z]/, 'يجب أن تحتوي على حرف صغير')
      .regex(/[A-Z]/, 'يجب أن تحتوي على حرف كبير')
      .regex(/[0-9]/, 'يجب أن تحتوي على رقم'),
  })
  .strict()

// ==================================================================
// 10) CREATE PASSKEY INVITE (جهاز إضافي)
//     POST /auth/passkeys/invite
// ==================================================================

export const createPasskeyInviteSchema = z
  .object({})
  .strict()
  .optional()
  .default({})

// ==================================================================
// 11) FINISH PASSKEY INVITE
//     POST /auth/passkeys/invite/:token/finish
// ==================================================================

export const finishPasskeyInviteSchema = z
  .object({
    deviceName: deviceNameSchema,
    credential: registrationResponseSchema,
  })
  .strict()

// ==================================================================
// 12) ✅ جديد — TEAM INVITE ACCEPT
//     عضو جديد يدخل المنظمة عبر لينك الإيميل
// ==================================================================

/**
 * GET  /auth/team-invite/:token          → مفيش body
 * POST /auth/team-invite/:token/start
 */
export const teamInviteRegisterStartSchema = z
  .object({
    /** الاسم اللي هيظهر على الحساب (اختياري — الافتراضي من الإيميل) */
    fullName: fullNameSchema.optional(),
  })
  .strict()

/**
 * POST /auth/team-invite/:token/finish
 * نفس credential بتاع التسجيل + اسم اختياري
 */
export const teamInviteRegisterFinishSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    deviceName: deviceNameSchema,
    credential: registrationResponseSchema,
  })
  .strict()

// ==================================================================
// Types — للاستخدام في Service و Routes
// ==================================================================

export type RegisterStartInput = z.infer<typeof registerStartSchema>
export type RegisterFinishInput = z.infer<typeof registerFinishSchema>
export type LoginStartInput = z.infer<typeof loginStartSchema>
export type LoginFinishInput = z.infer<typeof loginFinishSchema>
export type AddPasskeyFinishInput = z.infer<typeof addPasskeyFinishSchema>
export type RevokePasskeyInput = z.infer<typeof revokePasskeySchema>
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type SetPasswordInput = z.infer<typeof setPasswordSchema>
export type CreatePasskeyInviteInput = z.infer<typeof createPasskeyInviteSchema>
export type FinishPasskeyInviteInput = z.infer<typeof finishPasskeyInviteSchema>

/** ✅ جديد */
export type TeamInviteRegisterStartInput = z.infer<
  typeof teamInviteRegisterStartSchema
>
export type TeamInviteRegisterFinishInput = z.infer<
  typeof teamInviteRegisterFinishSchema
>

/** أشكال WebAuthn بعد التحويل من الفرونت */
export type RegistrationCredentialJSON = z.infer<
  typeof registrationResponseSchema
>
export type AuthenticationCredentialJSON = z.infer<
  typeof authenticationResponseSchema
>