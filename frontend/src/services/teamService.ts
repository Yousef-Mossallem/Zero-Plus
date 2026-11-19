// frontend/src/services/teamService.ts
// ==================================================================
// Zero Plus - Team Management Service
// يتوافق مع:
//   GET  /team/members
//   GET  /team/members/:userId
//   PATCH /team/members/:userId
//   PUT  /team/members/:userId/groups
//   POST /team/members/:userId/deactivate
//   POST /team/members/:userId/activate
//   PUT  /team/members/:userId/overrides
//   PATCH /team/members/:userId/overrides
//   DELETE /team/members/:userId/overrides
//   POST /team/members/:userId/refresh-token
//   GET  /team/groups
//   GET  /team/groups/:groupId
//   POST /team/groups
//   PATCH /team/groups/:groupId
//   DELETE /team/groups/:groupId
//   POST /team/groups/:groupId/members
//   DELETE /team/groups/:groupId/members
//   GET  /team/invites
//   POST /team/invites
//   POST /team/invites/:inviteId/resend
//   POST /team/invites/:inviteId/revoke
//   GET  /team/permissions-catalog
//   POST /team/ensure-system-groups
// ==================================================================

import api from './api'
import i18n from '../i18n'
import { cleanParams } from './types'

// ==================================================================
// Shared response wrapper
// ==================================================================

interface ApiResponse<T> {
  success: boolean
  message?: string
  data: T
}

interface PaginatedResponse<T> {
  items: T[]
  page: number
  limit: number
  total: number
}

// ==================================================================
// Types — Members
// ==================================================================

export type TeamRole = 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER'
export type EditableRole = 'ADMIN' | 'ANALYST' | 'VIEWER'

export interface GroupSummary {
  id: string
  name: string
}

export interface Override {
  permission: string
  isDeny: boolean
}

export interface TeamMember {
  id: string
  email: string
  fullName: string
  role: TeamRole
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  invitedById: string | null
  groups: GroupSummary[]
  overrides: Override[]
  permissions: string[]
}

export interface ListMembersParams {
  q?: string
  role?: TeamRole
  groupId?: string
  isActive?: boolean
  page?: number
  limit?: number
}

// ==================================================================
// Types — Groups
// ==================================================================

export interface TeamGroup {
  id: string
  name: string
  description: string | null
  permissions: string[]
  isSystem: boolean
  membersCount: number
  createdAt: string
  updatedAt: string
}

export interface TeamGroupDetail extends TeamGroup {
  members: TeamMember[]
}

export interface ListGroupsParams {
  q?: string
  page?: number
  limit?: number
}

export interface CreateGroupBody {
  name: string
  description?: string | null
  permissions: string[]
}

export interface UpdateGroupBody {
  name?: string
  description?: string | null
  permissions?: string[]
}

// ==================================================================
// Types — Invites
// ==================================================================

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED'

export interface TeamInvite {
  id: string
  email: string
  role: EditableRole
  status: InviteStatus
  expiresAt: string
  createdAt: string
  invitedById: string | null
  initialGroupIds?: string[]
  acceptUrl?: string // تظهر في dev لو الإيميل اتعطل
}

export interface ListInvitesParams {
  status?: InviteStatus
  page?: number
  limit?: number
}

export interface CreateInviteBody {
  email: string
  role?: EditableRole
  initialGroupIds?: string[]
  expiresInHours?: number
}

export interface CreateInviteResult {
  invite: TeamInvite
  email: {
    ok: boolean
    skipped?: boolean
    acceptUrl?: string
  }
}

// ==================================================================
// Types — Permissions Catalog
// ==================================================================

export interface PermissionEntry {
  id: string
  en: string
  ar: string
}

export interface SystemGroupTemplate {
  name: string
  description: string
  permissions: string[]
}

export interface PermissionsCatalog {
  permissions: PermissionEntry[]
  systemGroupTemplates: SystemGroupTemplate[]
}

// ==================================================================
// Normalizers — العقد بين الـ Backend والواجهة: أي حقل قائمة ناقص يتحول لمصفوفة فاضية
// ==================================================================

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

export function normalizeMember(raw: Partial<TeamMember> & { permissionOverrides?: Override[] }): TeamMember {
  return {
    ...(raw as TeamMember),
    groups: arr<GroupSummary>(raw.groups),
    overrides: arr<Override>(raw.overrides ?? raw.permissionOverrides),
    permissions: arr<string>(raw.permissions),
  }
}

export function normalizeGroup(raw: Partial<TeamGroup>): TeamGroup {
  return {
    ...(raw as TeamGroup),
    permissions: arr<string>(raw.permissions),
    membersCount: typeof raw.membersCount === 'number' ? raw.membersCount : 0,
  }
}

export function normalizeInvite(raw: Partial<TeamInvite>): TeamInvite {
  return { ...(raw as TeamInvite), initialGroupIds: arr<string>(raw.initialGroupIds) }
}

function normalizePage<R, T>(data: Partial<PaginatedResponse<R>> | undefined, map: (r: R) => T): PaginatedResponse<T> {
  const items = arr<R>(data?.items).map(map)
  return { items, page: data?.page ?? 1, limit: data?.limit ?? items.length, total: data?.total ?? items.length }
}

// ==================================================================
// Members API
// ==================================================================

export async function listMembers(
  params: ListMembersParams = {},
): Promise<PaginatedResponse<TeamMember>> {
  const response = await api.get<ApiResponse<PaginatedResponse<TeamMember>>>(
    '/team/members',
    { params: cleanParams(params) },
  )
  return normalizePage(response.data.data, normalizeMember)
}

export async function getMember(userId: string): Promise<TeamMember> {
  const response = await api.get<ApiResponse<TeamMember>>(
    `/team/members/${userId}`,
  )
  return normalizePage(response.data.data, normalizeMember)
}

export async function updateMemberRole(
  userId: string,
  role: EditableRole,
): Promise<TeamMember> {
  const response = await api.patch<ApiResponse<TeamMember>>(
    `/team/members/${userId}`,
    { role },
  )
  return normalizeMember(response.data.data)
}

export async function setMemberGroups(
  userId: string,
  groupIds: string[],
): Promise<TeamMember> {
  const response = await api.put<ApiResponse<TeamMember>>(
    `/team/members/${userId}/groups`,
    { groupIds },
  )
  return normalizeMember(response.data.data)
}

export async function deactivateMember(userId: string): Promise<void> {
  await api.post(`/team/members/${userId}/deactivate`)
}

export async function activateMember(userId: string): Promise<void> {
  await api.post(`/team/members/${userId}/activate`)
}

/** استبدال كامل للـ overrides */
export async function setMemberOverrides(
  userId: string,
  overrides: Override[],
): Promise<TeamMember> {
  const response = await api.put<ApiResponse<TeamMember>>(
    `/team/members/${userId}/overrides`,
    { overrides },
  )
  return normalizeMember(response.data.data)
}

/** إضافة/تعديل استثناء واحد */
export async function patchMemberOverride(
  userId: string,
  override: Override,
): Promise<TeamMember> {
  const response = await api.patch<ApiResponse<TeamMember>>(
    `/team/members/${userId}/overrides`,
    override,
  )
  return normalizeMember(response.data.data)
}

/** حذف استثناء واحد */
export async function deleteMemberOverride(
  userId: string,
  permission: string,
): Promise<TeamMember> {
  const response = await api.delete<ApiResponse<TeamMember>>(
    `/team/members/${userId}/overrides`,
    { data: { permission } },
  )
  return normalizeMember(response.data.data)
}

/** تجديد توكن عضو بعد تغيير صلاحياته */
export async function refreshMemberToken(userId: string): Promise<{ token: string }> {
  const response = await api.post<ApiResponse<{ token: string }>>(
    `/team/members/${userId}/refresh-token`,
  )
  return normalizeMember(response.data.data)
}

// ==================================================================
// Groups API
// ==================================================================

export async function listGroups(
  params: ListGroupsParams = {},
): Promise<PaginatedResponse<TeamGroup>> {
  const response = await api.get<ApiResponse<PaginatedResponse<TeamGroup>>>(
    '/team/groups',
    { params: cleanParams(params) },
  )
  return normalizePage(response.data.data, normalizeGroup)
}

export async function getGroup(groupId: string): Promise<TeamGroupDetail> {
  const response = await api.get<ApiResponse<TeamGroupDetail>>(
    `/team/groups/${groupId}`,
  )
  return response.data.data
}

export async function createGroup(body: CreateGroupBody): Promise<TeamGroup> {
  const response = await api.post<ApiResponse<TeamGroup>>('/team/groups', body)
  return normalizeGroup(response.data.data)
}

export async function updateGroup(
  groupId: string,
  body: UpdateGroupBody,
): Promise<TeamGroup> {
  const response = await api.patch<ApiResponse<TeamGroup>>(
    `/team/groups/${groupId}`,
    body,
  )
  return normalizeGroup(response.data.data)
}

export async function deleteGroup(groupId: string): Promise<void> {
  await api.delete(`/team/groups/${groupId}`)
}

export async function addGroupMembers(
  groupId: string,
  userIds: string[],
): Promise<void> {
  await api.post(`/team/groups/${groupId}/members`, { userIds })
}

export async function removeGroupMembers(
  groupId: string,
  userIds: string[],
): Promise<void> {
  await api.delete(`/team/groups/${groupId}/members`, { data: { userIds } })
}

// ==================================================================
// Invites API
// ==================================================================

export async function listInvites(
  params: ListInvitesParams = {},
): Promise<PaginatedResponse<TeamInvite>> {
  const response = await api.get<ApiResponse<PaginatedResponse<TeamInvite>>>(
    '/team/invites',
    { params: cleanParams(params) },
  )
  return normalizePage(response.data.data, normalizeInvite)
}

export async function createInvite(
  body: CreateInviteBody,
): Promise<CreateInviteResult> {
  const response = await api.post<ApiResponse<CreateInviteResult>>(
    '/team/invites',
    body,
  )
  return response.data.data
}

export async function resendInvite(
  inviteId: string,
  expiresInHours?: number,
): Promise<TeamInvite> {
  const response = await api.post<ApiResponse<TeamInvite>>(
    `/team/invites/${inviteId}/resend`,
    expiresInHours !== undefined ? { expiresInHours } : {},
  )
  return response.data.data
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await api.post(`/team/invites/${inviteId}/revoke`)
}

// ==================================================================
// Permissions Catalog & System Groups
// ==================================================================

export async function getPermissionsCatalog(): Promise<PermissionsCatalog> {
  const response = await api.get<ApiResponse<PermissionsCatalog>>(
    '/team/permissions-catalog',
  )
  const d = response.data.data
  return {
    permissions: arr<PermissionEntry>(d?.permissions),
    systemGroupTemplates: arr<SystemGroupTemplate>(d?.systemGroupTemplates),
  }
}

export async function ensureSystemGroups(): Promise<{ created: number }> {
  const response = await api.post<ApiResponse<{ created: number }>>(
    '/team/ensure-system-groups',
  )
  return response.data.data
}

// ==================================================================
// Error helper — يفضّل الرسالة العربية لو موجودة
// ==================================================================

export function getTeamErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const e = error as {
      response?: {
        data?: {
          error?: { messageAr?: string; message?: string }
          message?: string
        }
      }
    }
    const lang = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0]
    const err = e.response?.data?.error
    if (lang === 'ar' && err?.messageAr) return err.messageAr
    const msg = err?.message ?? e.response?.data?.message
    if (msg && lang !== 'ar') return msg
    if (msg && !err?.messageAr) return fallback
  }
  return fallback
}

// ==================================================================
// Default export
// ==================================================================

const teamService = {
  listMembers,
  getMember,
  updateMemberRole,
  setMemberGroups,
  deactivateMember,
  activateMember,
  setMemberOverrides,
  patchMemberOverride,
  deleteMemberOverride,
  refreshMemberToken,
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  addGroupMembers,
  removeGroupMembers,
  listInvites,
  createInvite,
  resendInvite,
  revokeInvite,
  getPermissionsCatalog,
  ensureSystemGroups,
  getTeamErrorMessage,
}

export default teamService
