// ==================================================================
// Zero Plus - Policies Validation Schemas
// ==================================================================

import { z } from 'zod'

export const DEFAULT_POLICY = {
  allowMaxScore: 30,
  rateLimitMaxScore: 60,
  challengeMaxScore: 80,
  rateLimitRequests: 30,
  rateLimitWindowSec: 60,
  rateLimitRps: 100,
  autoBanAfterFails: 2,
  temporaryBanMinutes: 120,
  permanentBanMinScore: 9,
  enableJsChallenge: true,
  enableAiAnomaly: true,
} as const

export const updatePolicySchema = z
  .object({
    allowMaxScore: z.number().int().min(0).max(100).optional(),
    rateLimitMaxScore: z.number().int().min(0).max(100).optional(),
    challengeMaxScore: z.number().int().min(0).max(100).optional(),
    rateLimitRequests: z.number().int().min(1).max(100000).optional(),
    rateLimitWindowSec: z.number().int().min(1).max(3600).optional(),
    rateLimitRps: z.number().int().min(1).max(10000).optional(),
    autoBanAfterFails: z.number().int().min(1).max(20).optional(),
    temporaryBanMinutes: z.number().int().min(1).max(10080).optional(),
    permanentBanMinScore: z.number().int().min(1).max(10).optional(),
    enableJsChallenge: z.boolean().optional(),
    enableAiAnomaly: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'يجب إرسال حقل واحد على الأقل للتعديل',
  })
  .refine(
    (data) => {
      const a = data.allowMaxScore
      const r = data.rateLimitMaxScore
      const c = data.challengeMaxScore
      if (a !== undefined && r !== undefined && a > r) return false
      if (r !== undefined && c !== undefined && r > c) return false
      if (a !== undefined && c !== undefined && a > c) return false
      return true
    },
    {
      message:
        'يجب أن يتحقق: allowMaxScore ≤ rateLimitMaxScore ≤ challengeMaxScore',
    }
  )

export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>