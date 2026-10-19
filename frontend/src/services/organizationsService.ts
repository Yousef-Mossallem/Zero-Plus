// frontend/src/services/organizationsService.ts
// ==================================================================
// Zero Plus - Organizations Service
// مربوط بـ backend/modules/organizations (organizations.routes.ts)
//   GET   /organizations/me → { success, data: Organization + _count }
//   PATCH /organizations/me → { success, message, data }  body: { name?, slug? }
// ==================================================================

import api from './api'

export interface Organization {
  id: string
  name: string
  slug: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  /** بيجي من GET بس (مش من PATCH) */
  _count?: {
    users: number
    servers: number
  }
}

export interface UpdateOrganizationInput {
  name?: string
  slug?: string
}

export async function getMyOrganization(): Promise<Organization> {
  const { data } = await api.get<{ success: boolean; data: Organization }>('/organizations/me')
  return data.data
}

export async function updateMyOrganization(
  input: UpdateOrganizationInput,
): Promise<{ message: string; organization: Organization }> {
  const { data } = await api.patch<{ message: string; data: Organization }>(
    '/organizations/me',
    input,
  )
  return { message: data.message, organization: data.data }
}
