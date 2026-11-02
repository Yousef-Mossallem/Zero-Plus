// frontend/src/services/serversService.ts
// ==================================================================
// Zero Plus - Servers Service
// مربوط بـ backend/modules/servers (servers.routes.ts + servers.schema.ts)
//   GET    /servers            → { success, data[], pagination, summary }
//   POST   /servers            → { success, message, data, dns }       (OWNER/ADMIN)
//   GET    /servers/:id        → { success, data }
//   GET    /servers/:id/dns    → { success, data:{...status}, dns }
//   PATCH  /servers/:id        → { success, message, data, changes, resets, dns? }
//   POST   /servers/:id/verify → { success, message, data: DnsVerificationResult }
//   POST   /servers/:id/probe  → 202 { success, message }              (OWNER/ADMIN)
//   POST   /servers/:id/maintenance → { success, message, data }
//   DELETE /servers/:id?confirmDomain=  → { success, message, data:{id,domain,deletedEvents} }
//
// Socket: server:status  (انظر ServerStatusEvent تحت)
//
// ملاحظات:
//   - /probe بيرد 202 من غير أرقام. النتيجة بتوصل بـ Socket أو GET /servers/:id
//   - أخطاء 409 OWNERSHIP_REQUIRED و 429 PROBE_TOO_FREQUENT بتتعامل معاها
//     الصفحة عن طريق getApiErrorInfo (تحت)
// ==================================================================

import api from './api'
import { cleanParams } from './types'
import type { Pagination, ServerMode, ServerStatus } from './types'

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type ProbeConfidence = 'high' | 'medium' | 'low'
export type ProbeRecommendation = 'excellent' | 'good' | 'fair' | 'poor' | 'down'

export interface Server {
  // ---- أساسي ----
  id: string
  domain: string
  originIp: string
  originPort: number
  status: ServerStatus
  mode: ServerMode
  cpuCores: number | null
  ramMb: number | null
  verificationToken: string
  dnsVerified: boolean
  dnsVerifiedAt: string | null
  gatewayReachable: boolean
  originReachable: boolean
  sslEnabled: boolean
  organizationId: string
  createdAt: string
  updatedAt: string

  // ---- صحة ----
  avgResponseTimeMs: number | null
  currentLoadPercent: number | null
  lastHealthCheckAt: string | null

  // ---- السعة والقياس (Probe) ----
  /** السعة الخام من آخر قياس ناجح */
  maxRequestsPerSecond: number | null
  /** الرقم الآمن للعرض والتسعير (الرقم الرئيسي في الواجهة) */
  safeRequestsPerSecond: number | null
  /** زمن الاستجابة وقت الهدوء */
  p95ResponseTimeMs: number | null
  /** p99 تحت الحمل أثناء القياس */
  loadLatencyP99Ms: number | null
  /** نسبة الأخطاء في آخر قياس (0–100) */
  probeErrorRate: number | null
  probeConfidence: ProbeConfidence | null
  probeRecommendation: ProbeRecommendation | null
  /** آخر مرة اكتمل فيها قياس (null = لم يُقس بعد) */
  lastProbeAt: string | null
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

export interface DnsStatus {
  serverId: string
  status: ServerStatus
  dnsVerified: boolean
  dnsVerifiedAt: string | null
  gatewayReachable: boolean
}

export type VerifyStep = 'ownership' | 'routing' | 'all'

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

export type ServerReset = 'dnsVerification' | 'originReachability'

export interface MutationResult<T> {
  message: string
  data: T
}

// ------------------------------------------------------------------
// Socket: server:status
// ------------------------------------------------------------------

export type ServerStatusAction =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'deleted'
  | 'verified'

export interface ServerStatusEvent {
  id: string
  organizationId: string
  domain: string
  status: ServerStatus
  previousStatus?: ServerStatus
  mode: ServerMode
  dnsVerified: boolean
  gatewayReachable: boolean
  originReachable: boolean
  avgResponseTimeMs: number | null
  currentLoadPercent: number | null

  // السعة (الجديد)
  maxRequestsPerSecond: number | null
  safeRequestsPerSecond: number | null
  p95ResponseTimeMs: number | null
  probeRecommendation: ProbeRecommendation | null
  probeConfidence: ProbeConfidence | null
  lastProbeAt: string | null

  action: ServerStatusAction
  updatedAt: string
}

// ------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------

export interface ApiErrorInfo {
  status: number | null
  code: string | null
  message: string
  /** من details.retryAfterSec أو هيدر Retry-After (للـ 429) */
  retryAfterSec: number | null
  /** أخطاء الحقول (400 VALIDATION_ERROR) */
  fieldErrors: Array<{ field: string; message: string }>
}

/**
 * يستخرج معلومات الخطأ الموحّد من الباك:
 * { success:false, code, message, details?, errors? } + هيدر Retry-After
 * بدون الاعتماد على نوع مكتبة معينة (axios وغيره).
 */
export function getApiErrorInfo(error: unknown): ApiErrorInfo {
  const err = error as {
    response?: {
      status?: number
      data?: {
        code?: string
        message?: string
        details?: { retryAfterSec?: number }
        errors?: Array<{ field: string; message: string }>
      }
      headers?: Record<string, string | undefined>
    }
    message?: string
  }

  const res = err?.response
  const body = res?.data

  const headerRetry = Number(res?.headers?.['retry-after'])
  const retryAfterSec =
    body?.details?.retryAfterSec ??
    (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : null)

  return {
    status: res?.status ?? null,
    code: body?.code ?? null,
    message: body?.message ?? err?.message ?? 'حدث خطأ غير متوقع',
    retryAfterSec,
    fieldErrors: body?.errors ?? [],
  }
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** كل حقول الـ probe اللي بتتصفّر لما يتغيّر Origin IP أو Port */
export const EMPTY_PROBE_FIELDS = {
  maxRequestsPerSecond: null,
  safeRequestsPerSecond: null,
  p95ResponseTimeMs: null,
  loadLatencyP99Ms: null,
  probeErrorRate: null,
  probeConfidence: null,
  probeRecommendation: null,
  lastProbeAt: null,
} as const satisfies Partial<Server>

/** هل السيرفر اتقاس قبل كده؟ (لو false اعرض "لم يُقس بعد" أو "جاري القياس…") */
export function hasProbeData(server: Pick<Server, 'lastProbeAt' | 'safeRequestsPerSecond'>): boolean {
  return server.lastProbeAt !== null || server.safeRequestsPerSecond !== null
}

/** هل مسموح تطلب إعادة قياس؟ (الباك بيرجع 409 لو الملكية مش مثبتة) */
export function canRequestProbe(server: Pick<Server, 'dnsVerified'>): boolean {
  return server.dnsVerified
}

/**
 * دمج payload الـ Socket في السيرفر الموجود في الـ store.
 * الحقول اللي مش في الـ event بتفضل زي ما هي.
 */
export function mergeServerStatusEvent(server: Server, event: ServerStatusEvent): Server {
  return {
    ...server,
    domain: event.domain,
    status: event.status,
    mode: event.mode,
    dnsVerified: event.dnsVerified,
    gatewayReachable: event.gatewayReachable,
    originReachable: event.originReachable,
    avgResponseTimeMs: event.avgResponseTimeMs,
    currentLoadPercent: event.currentLoadPercent,
    maxRequestsPerSecond: event.maxRequestsPerSecond,
    safeRequestsPerSecond: event.safeRequestsPerSecond,
    p95ResponseTimeMs: event.p95ResponseTimeMs,
    probeRecommendation: event.probeRecommendation,
    probeConfidence: event.probeConfidence,
    lastProbeAt: event.lastProbeAt,
    updatedAt: event.updatedAt,
  }
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

export async function getServer(id: string): Promise<Server> {
  const { data } = await api.get<{ success: boolean; data: Server }>(`/servers/${id}`)
  return data.data
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
  status: DnsStatus
  dns: DnsInstructions
}> {
  const { data } = await api.get<{ data: DnsStatus; dns: DnsInstructions }>(
    `/servers/${id}/dns`,
  )
  return { status: data.data, dns: data.dns }
}

export async function updateServer(
  id: string,
  input: UpdateServerInput,
): Promise<{
  message: string
  server: Server
  changes: ServerChange[]
  resets: ServerReset[]
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
  step: VerifyStep = 'all',
): Promise<MutationResult<DnsVerificationResult>> {
  const { data } = await api.post<{ message: string; data: DnsVerificationResult }>(
    `/servers/${id}/verify`,
    { step },
  )
  return { message: data.message, data: data.data }
}

/**
 * إعادة قياس السعة (Origin Probe).
 * الباك بيرد 202 من غير أرقام؛ النتيجة بتوصل بـ Socket (server:status)
 * أو GET /servers/:id بعد دقيقتين تقريباً.
 *
 * أخطاء متوقعة (استخدم getApiErrorInfo):
 *   409 OWNERSHIP_REQUIRED  → لازم إثبات ملكية الدومين الأول
 *   429 PROBE_TOO_FREQUENT  → اقرأ retryAfterSec واعرض عدّاد
 *   404 SERVER_NOT_FOUND
 */
export async function requestProbe(id: string): Promise<{ message: string }> {
  const { data } = await api.post<{ success: boolean; message: string }>(
    `/servers/${id}/probe`,
  )
  return { message: data.message }
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