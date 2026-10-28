// frontend/src/services/reportsService.ts
// ==================================================================
// Zero Plus - Reports Service
// مربوط بـ backend/modules/reports (reports.routes.ts + reports.service.ts)
// ------------------------------------------------------------------
// Endpoints:
//   POST   /reports              → إنشاء تقرير (PENDING + توليد بالخلفية)
//   GET    /reports              → قائمة + فلاتر + pagination + summary
//   GET    /reports/:id          → تفاصيل تقرير (content كامل)
//   DELETE /reports/:id          → حذف (OWNER / ADMIN)
//   POST   /reports/chat         → محادثة مع Gemini
// ==================================================================

import api from './api'
import { cleanParams } from './types'
import type { Pagination, Report, ReportChatMessage, ReportChatResponse, ReportStatus, ReportType } from './types'

// ------------------------------------------------------------------
// Query & Payload Types
// ------------------------------------------------------------------

export interface ReportsQuery {
  page?: number
  limit?: number
  type?: ReportType
  status?: ReportStatus
  serverId?: string
  search?: string
  sortBy?: 'createdAt' | 'periodStart' | 'title' | 'status'
  sortOrder?: 'asc' | 'desc'
}

export interface CreateReportPayload {
  type: ReportType
  periodStart: string // ISO 8601 UTC
  periodEnd: string   // ISO 8601 UTC
  serverId?: string
  title?: string
  securityEventId?: string
}

export interface ReportChatPayload {
  message: string
  messages?: ReportChatMessage[]
  includeContext?: boolean
  serverId?: string
}

export interface ReportsListResponse {
  success: boolean
  data: Report[]
  pagination: Pagination
  summary?: {
    total: number
    byStatus: Partial<Record<ReportStatus, number>>
    byType: Partial<Record<ReportType, number>>
  }
}

export interface ReportDetailResponse {
  success: boolean
  data: Report
}

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export const reportsService = {
  /** قائمة التقارير مع فلاتر و pagination */
  async list(params: ReportsQuery = {}): Promise<ReportsListResponse> {
    const { data } = await api.get<ReportsListResponse>('/reports', {
      params: cleanParams(params),
    })
    return data
  },

  /** تفاصيل تقرير واحد */
  async getById(id: string): Promise<Report> {
    const { data } = await api.get<ReportDetailResponse>(`/reports/${id}`)
    return data.data
  },

  /** إنشاء تقرير جديد (يُولَّد في الخلفية) */
  async create(payload: CreateReportPayload): Promise<Report> {
    const { data } = await api.post<{ success: boolean; message: string; data: Report }>(
      '/reports',
      payload,
    )
    return data.data
  },

  /** حذف تقرير (OWNER / ADMIN) */
  async remove(id: string): Promise<void> {
    await api.delete(`/reports/${id}`)
  },

  /** محادثة مع Gemini حول التقارير / السياق الأمني */
  async chat(payload: ReportChatPayload): Promise<ReportChatResponse> {
    const { data } = await api.post<{ success: boolean; data: ReportChatResponse }>(
      '/reports/chat',
      payload,
    )
    return data.data
  },
}

export default reportsService
