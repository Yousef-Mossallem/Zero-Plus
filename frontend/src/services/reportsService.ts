// frontend/src/services/reportsService.ts
// ==================================================================
// Zero Plus - Reports Service
// مربوط بـ backend/modules/reports (reports.routes.ts / reports.schema.ts)
//   POST   /reports        → 201 { success, message, data:{id,title,type,status,...} }
//   GET    /reports        → { success, data[], pagination, summary:{[status]:count} } (من غير content)
//   GET    /reports/:id    → { success, data: Report كامل }
//   DELETE /reports/:id    → { success, message, data }          (OWNER/ADMIN)
//   POST   /reports/chat   → { success, data:{ reply, model, tokensUsed } }
// قيود الباك: periodEnd بعد periodStart • الفترة ≤ 31 يوم • مش أقدم من 365 يوم
// والتواريخ ISO UTC بتنتهي بـ Z.
// ==================================================================

import api from './api'
import { cleanParams } from './types'
import type { Pagination } from './types'

export type ReportType = 'PERIODIC' | 'INCIDENT' | 'ON_DEMAND'
export type ReportStatus = 'PENDING' | 'GENERATING' | 'READY' | 'FAILED'

export interface Report {
  id: string
  title: string
  type: ReportType
  status: ReportStatus
  periodStart: string
  periodEnd: string
  /** مش بيجي في القائمة، بيجي من GET /reports/:id بس */
  content?: string | null
  summary: string | null
  errorMessage: string | null
  eventCount: number
  blockedCount: number
  tokensUsed: number | null
  modelUsed: string | null
  metadata?: Record<string, unknown> | null
  serverId: string | null
  securityEventId: string | null
  organizationId: string
  createdAt: string
  updatedAt: string
}

/** رد POST /reports (مختصر) */
export interface CreatedReport {
  id: string
  title: string
  type: ReportType
  status: ReportStatus
  periodStart: string
  periodEnd: string
  serverId: string | null
  createdAt: string
}

/** Payload حدث السوكيت report:status (ReportRealtimePayload في الباك) */
export interface ReportSocketPayload {
  id: string
  organizationId: string
  title: string
  type: ReportType
  status: ReportStatus
  serverId: string | null
  errorMessage: string | null
  action: 'created' | 'status_changed' | 'deleted'
  updatedAt: string
}

export interface ReportsQuery {
  page?: number
  limit?: number
  status?: ReportStatus
  type?: ReportType
  serverId?: string
  startDate?: string
  endDate?: string
  sortBy?: 'createdAt' | 'updatedAt' | 'periodStart' | 'status' | 'type'
  sortOrder?: 'asc' | 'desc'
}

export interface CreateReportInput {
  type: ReportType
  periodStart: string
  periodEnd: string
  serverId?: string
  title?: string
  securityEventId?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function listReports(query: ReportsQuery = {}): Promise<{
  data: Report[]
  pagination: Pagination
  summary: Partial<Record<ReportStatus, number>>
}> {
  const { data } = await api.get<{
    data: Report[]
    pagination: Pagination
    summary: Partial<Record<ReportStatus, number>>
  }>('/reports', { params: cleanParams(query) })
  return { data: data.data, pagination: data.pagination, summary: data.summary ?? {} }
}

export async function getReport(id: string): Promise<Report> {
  const { data } = await api.get<{ data: Report }>(`/reports/${encodeURIComponent(id)}`)
  return data.data
}

export async function createReport(
  input: CreateReportInput,
): Promise<{ message: string; report: CreatedReport }> {
  const { data } = await api.post<{ message: string; data: CreatedReport }>('/reports', input)
  return { message: data.message, report: data.data }
}

export async function deleteReport(id: string): Promise<{ message: string }> {
  const { data } = await api.delete<{ message: string }>(`/reports/${encodeURIComponent(id)}`)
  return { message: data.message }
}

export async function chatWithReports(input: {
  message: string
  messages: ChatMessage[]
  includeContext: boolean
  serverId?: string
}): Promise<{ reply: string; model: string; tokensUsed: number | null }> {
  const { data } = await api.post<{
    data: { reply: string; model: string; tokensUsed: number | null }
  }>('/reports/chat', input)
  return data.data
}
