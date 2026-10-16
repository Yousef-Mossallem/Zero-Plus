// frontend/src/services/eventsService.ts
// ==================================================================
// Zero Plus - Events Service
// مربوط بـ backend/modules/events (events.routes.ts)
//   GET /events        → { success, events, pagination, summary }   (مفيش data wrapper)
//   GET /events/:id    → { success, data }
// organizationId بيتاخد من الـ JWT في الباك، فمبنبعتوش من هنا أبدًا.
// ==================================================================

import api from './api'
import { cleanParams } from './types'
import type { Decision, IpType, Pagination } from './types'

// ------------------------------------------------------------------
// Types (مطابقة لـ model SecurityEvent في schema.prisma)
// ------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

export type EventSortBy = 'createdAt' | 'riskScore' | 'ipAddress' | 'decision' | 'serverId'

export interface SecurityEvent {
  id: string
  ipAddress: string
  path: string
  method: string
  userAgent: string | null
  referer: string | null
  requestId: string | null

  riskScore: number
  anomalyScore: number | null
  confidence: number | null

  decision: Decision
  decidedAtStage: string | null
  reasonSummary: string | null
  reasonDetails: Record<string, unknown> | null
  processingTimeMs: number | null

  countryCode: string | null
  asn: number | null
  ipType: IpType | null
  isChallenged: boolean
  challengeType: string | null
  challengePassed: boolean | null

  serverId: string
  organizationId: string
  reputationEntryId: string | null
  createdAt: string

  /** بيجي من include في الليست والتفاصيل */
  server?: { id: string; domain: string }
}

export interface SecurityEventDetail extends SecurityEvent {
  reputationEntry: {
    id: string
    ipAddress: string
    score: number
    banStatus: string
    ipType: IpType
    countryCode: string | null
    asn: number | null
  } | null
}

export interface EventsQuery {
  page?: number
  limit?: number
  serverId?: string
  decision?: Exclude<Decision, 'MONITOR'> // الباك (zod) مبيقبلش MONITOR كفلتر
  ipAddress?: string
  countryCode?: string
  ipType?: IpType
  method?: HttpMethod
  path?: string
  minRiskScore?: number
  maxRiskScore?: number
  isChallenged?: boolean
  challengePassed?: boolean
  reputationEntryId?: string
  startDate?: string // ISO UTC
  endDate?: string // ISO UTC
  search?: string
  sortBy?: EventSortBy
  sortOrder?: 'asc' | 'desc'
}

export interface EventsListResponse {
  success: boolean
  events: SecurityEvent[]
  pagination: Pagination
  summary: {
    totalEvents: number
    averageRiskScore: number
  }
}

// ------------------------------------------------------------------
// Calls
// ------------------------------------------------------------------

export async function getEvents(query: EventsQuery = {}): Promise<EventsListResponse> {
  const { data } = await api.get<EventsListResponse>('/events', {
    params: cleanParams(query),
  })
  return data
}

export async function getEventById(id: string): Promise<SecurityEventDetail> {
  const { data } = await api.get<{ success: boolean; data: SecurityEventDetail }>(
    `/events/${encodeURIComponent(id)}`,
  )
  return data.data
}
