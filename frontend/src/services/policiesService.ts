// frontend/src/services/policiesService.ts
// ==================================================================
// Zero Plus - Policies Service
// مربوط بـ backend/modules/policies (policies.routes.ts)
//   GET   /policies/defaults  → { success, data: defaults }
//   GET   /policies/me        → { success, data: Policy }
//   PATCH /policies/me        → { success, message, data, changes }   (OWNER/ADMIN/ANALYST)
//   POST  /policies/me/reset  → { success, message, data, changes }   body: { confirm:true, fields? }
// ==================================================================

import api from './api'

export interface PolicyValues {
  // حدود الـ Risk Score
  allowMaxScore: number
  rateLimitMaxScore: number
  challengeMaxScore: number
  // الاختبارات
  enableJsChallenge: boolean
  challengeAllVisitors: boolean
  passTokenTtlMinutes: number
  // Rate limit الناعم
  rateLimitRequests: number
  rateLimitWindowSec: number
  // الحد الأقصى لكل IP
  maxRequestsPerIp: number
  maxRequestsWindowSec: number
  banOnMaxRequests: boolean
  // سعة السيرفر
  maxServerRps: number | null
  capacityWarnPercent: number
  // الحظر التلقائي
  autoBanAfterFails: number
  temporaryBanMinutes: number
  permanentBanScore: number
  // AI
  enableAiAnomaly: boolean
}

export type PolicyFieldKey = keyof PolicyValues

export interface Policy extends PolicyValues {
  id: string
  organizationId: string
  createdAt: string
  updatedAt: string
}

export interface PolicyChange {
  field: PolicyFieldKey
  from: number | boolean | null
  to: number | boolean | null
}

export interface PolicyMutation {
  message: string
  policy: Policy
  changes: PolicyChange[]
}

export async function getPolicyDefaults(): Promise<PolicyValues> {
  const { data } = await api.get<{ success: boolean; data: PolicyValues }>('/policies/defaults')
  return data.data
}

export async function getMyPolicy(): Promise<Policy> {
  const { data } = await api.get<{ success: boolean; data: Policy }>('/policies/me')
  return data.data
}

export async function updateMyPolicy(patch: Partial<PolicyValues>): Promise<PolicyMutation> {
  const { data } = await api.patch<{
    message: string
    data: Policy
    changes: PolicyChange[]
  }>('/policies/me', patch)
  return { message: data.message, policy: data.data, changes: data.changes }
}

export async function resetMyPolicy(fields?: PolicyFieldKey[]): Promise<PolicyMutation> {
  const { data } = await api.post<{
    message: string
    data: Policy
    changes: PolicyChange[]
  }>('/policies/me/reset', {
    confirm: true,
    ...(fields && fields.length > 0 && { fields }),
  })
  return { message: data.message, policy: data.data, changes: data.changes }
}
