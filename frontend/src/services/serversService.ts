// frontend/src/services/serversService.ts
// ==================================================================
// Zero Plus - Servers Service
// مربوط بـ backend/modules/servers (servers.routes.ts)
//   GET    /servers            → { success, data[], pagination, summary }
//   POST   /servers            → { success, message, data, dns }       (OWNER/ADMIN)
//   GET    /servers/:id        → { success, data }
//   GET    /servers/:id/dns    → { success, data:{...status}, dns }
//   PATCH  /servers/:id        → { success, message, data, changes, resets, dns? }
//   POST   /servers/:id/verify → { success, message, data: DnsVerificationResult }
//   POST   /servers/:id/maintenance → { success, message, data }
//   DELETE /servers/:id?confirmDomain=  → { success, message, data:{id,domain,deletedEvents} }
// ==================================================================

import api from './api'
import { cleanParams } from './types'
import type { Pagination, ServerMode, ServerStatus } from './types'

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface Server {
  id: string
  domain: string
  originIp: string
  originPort: number
  status: ServerStatus
  mode: ServerMode
  maxRequestsPerSecond: number | null
  cpuCores: number | null
  ramMb: number | null
  avgResponseTimeMs: number | null
  currentLoadPercent: number | null
  lastHealthCheckAt: string | null
  verificationToken: string
  dnsVerified: boolean
  dnsVerifiedAt: string | null
  gatewayReachable: boolean
  originReachable: boolean
  sslEnabled: boolean
  organizationId: string
  createdAt: string
  updatedAt: string
}

export interface DnsRecordInstruction {
  purpose: 'OWNERSHIP' | 'ROUTING'
  type: 'TXT' | 'CNAME' | 'A'
  name: string
  value: string
  ttl: number
  note?: string
}

export interface DnsInstructions {
  domain: string
  ownership: DnsRecordInstruction
  routing: DnsRecordInstruction[]
  steps: string[]
  warnings: string[]
}

export interface DnsCheckResult {
  verified: boolean
  expected: string[]
  found: string[]
  checkedAt: string
  message: string
}

export interface DnsVerificationResult {
  ownership?: DnsCheckResult
  routing?: DnsCheckResult
  server: {
    id: string
    status: ServerStatus
    dnsVerified: boolean
    gatewayReachable: boolean
  }
}

export interface ServersQuery {
  page?: number
  limit?: number
  status?: ServerStatus
  mode?: ServerMode
  dnsVerified?: boolean
  search?: string
  sortBy?: 'createdAt' | 'updatedAt' | 'domain' | 'status'
  sortOrder?: 'asc' | 'desc'
}

export interface ServersListResult {
  data: Server[]
  pagination: Pagination
  summary: Record<ServerStatus, number>
}

export interface CreateServerInput {
  domain: string
  originIp: string
  originPort?: number
  sslEnabled?: boolean
  mode?: ServerMode
}

export type UpdateServerInput = Partial<CreateServerInput>

export interface ServerChange {
  field: 'domain' | 'originIp' | 'originPort' | 'sslEnabled' | 'mode'
  from: string | number | boolean
  to: string | number | boolean
}

export interface MutationResult<T> {
  message: string
  data: T
}

// ------------------------------------------------------------------
// Calls
// ------------------------------------------------------------------

export async function listServers(query: ServersQuery = {}): Promise<ServersListResult> {
  const { data } = await api.get<{ success: boolean } & ServersListResult>('/servers', {
    params: cleanParams(query),
  })
  return { data: data.data, pagination: data.pagination, summary: data.summary }
}

export async function createServer(
  input: CreateServerInput,
): Promise<{ message: string; server: Server; dns: DnsInstructions }> {
  const { data } = await api.post<{
    message: string
    data: Server
    dns: DnsInstructions
  }>('/servers', input)
  return { message: data.message, server: data.data, dns: data.dns }
}

export async function getServerDns(id: string): Promise<{
  status: {
    serverId: string
    status: ServerStatus
    dnsVerified: boolean
    dnsVerifiedAt: string | null
    gatewayReachable: boolean
  }
  dns: DnsInstructions
}> {
  const { data } = await api.get(`/servers/${id}/dns`)
  return { status: data.data, dns: data.dns }
}

export async function updateServer(
  id: string,
  input: UpdateServerInput,
): Promise<{
  message: string
  server: Server
  changes: ServerChange[]
  resets: Array<'dnsVerification' | 'originReachability'>
  dns?: DnsInstructions
}> {
  const { data } = await api.patch(`/servers/${id}`, input)
  return {
    message: data.message,
    server: data.data,
    changes: data.changes ?? [],
    resets: data.resets ?? [],
    ...(data.dns && { dns: data.dns as DnsInstructions }),
  }
}

export async function verifyServer(
  id: string,
  step: 'ownership' | 'routing' | 'all' = 'all',
): Promise<MutationResult<DnsVerificationResult>> {
  const { data } = await api.post<{ message: string; data: DnsVerificationResult }>(
    `/servers/${id}/verify`,
    { step },
  )
  return { message: data.message, data: data.data }
}

export async function setMaintenance(
  id: string,
  enabled: boolean,
): Promise<MutationResult<Server>> {
  const { data } = await api.post<{ message: string; data: Server }>(
    `/servers/${id}/maintenance`,
    { enabled },
  )
  return { message: data.message, data: data.data }
}

export async function deleteServer(
  id: string,
  confirmDomain: string,
): Promise<MutationResult<{ id: string; domain: string; deletedEvents: number }>> {
  const { data } = await api.delete<{
    message: string
    data: { id: string; domain: string; deletedEvents: number }
  }>(`/servers/${id}`, { params: { confirmDomain } })
  return { message: data.message, data: data.data }
}
