// backend/src/modules/servers/servers.schema.ts
// ==================================================================
// Zero Plus - Servers Validation Schemas
// ==================================================================

import { z } from 'zod'

// ------------------------------------------------------------------
// Regex Patterns
// ------------------------------------------------------------------

// Domain بسيط وقوي (مثال: example.com أو sub.example.com)
const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/

// IPv4 فقط (للـ MVP)
const ipv4Regex =
  /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

// ------------------------------------------------------------------
// Create Server Schema
// ------------------------------------------------------------------
export const createServerSchema = z.object({
  domain: z
    .string({ required_error: 'النطاق مطلوب' })
    .min(3, { message: 'النطاق قصير جدًا' })
    .max(255, { message: 'النطاق طويل جدًا' })
    .regex(domainRegex, { message: 'صيغة النطاق غير صحيحة' })
    .transform((val) => val.toLowerCase().trim()),

  ip: z
    .string({ required_error: 'عنوان IP مطلوب' })
    .regex(ipv4Regex, { message: 'صيغة عنوان IP غير صحيحة' }),

  port: z
    .number({ required_error: 'المنفذ مطلوب' })
    .int()
    .min(1, { message: 'المنفذ يجب أن يكون بين 1 و 65535' })
    .max(65535, { message: 'المنفذ يجب أن يكون بين 1 و 65535' })
    .default(443),
})

// ------------------------------------------------------------------
// Update Server Schema
// ------------------------------------------------------------------
export const updateServerSchema = z
  .object({
    domain: z
      .string()
      .min(3)
      .max(255)
      .regex(domainRegex, { message: 'صيغة النطاق غير صحيحة' })
      .transform((val) => val.toLowerCase().trim())
      .optional(),

    ip: z
      .string()
      .regex(ipv4Regex, { message: 'صيغة عنوان IP غير صحيحة' })
      .optional(),

    port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional(),
  })
  .refine((data) => data.domain || data.ip || data.port, {
    message: 'يجب إرسال حقل واحد على الأقل للتعديل',
  })

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
export type CreateServerInput = z.infer<typeof createServerSchema>
export type UpdateServerInput = z.infer<typeof updateServerSchema>
