// frontend/src/services/dashboardService.ts
// ==================================================================
// Zero Plus - Dashboard Service (قراءة فقط)
// مربوط بـ backend/modules/dashboard (dashboard.routes.ts / dashboard.schema.ts)
// كل الردود: { success: true, data } • الصلاحيات: OWNER / ADMIN / ANALYST (VIEWER ← 403)
//   GET /dashboard/overview    ?range&serverId
//   GET /dashboard/timeline    ?range&serverId
//   GET /dashboard/top         ?by&range&limit&serverId
//   GET /dashboard/servers
//   GET /dashboard/threat-map  ?range   (الباك مبيقبلش serverId هنا: schema strict)
// ==================================================================

import api from './api'
import { cleanParams } from './types'

export type DashboardRange = '1h' | '24h' | '7d' | '30d'
export type TopBy = 'ip' | 'path' | 'country' | 'asn' | 'ipType' | 'stage'
export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical'

export interface OverviewData {
  range: DashboardRange
  rangeLabel: string
  periodStart: string
  periodEnd: string
  traffic: { total: number; allowed: number; blocked: number; challenged: number; rateLimited: number; monitored: number }
  risk: { avgScore: number; surgeDetected: boolean; surgeCount: number }
  challenges: { total: number; passed: number; failed: number }
  servers: { ONLINE: number; DEGRADED: number; OFFLINE: number; PENDING: number; MAINTENANCE: number }
  reputation: { activeBans: number; permanentBans: number; criticalEntries: number; newBansInRange: number }
  unreadNotifications: number
  serverId: string | null
  generatedAt: string
}

export interface TimelinePoint {
  time: string
  total: number
  blocked: number
  challenged: number
  rateLimited: number
  allowed: number
  monitored: number
  avgRiskScore: number
}

export interface TimelineData {
  range: DashboardRange
  interval: string
  periodStart: string
  periodEnd: string
  serverId: string | null
  points: TimelinePoint[]
  generatedAt: string
}

export interface TopItem {
  value: string
  label?: string | null
  total: number
  blocked: number
  challenged: number
  rateLimited?: number
  allowed?: number
  avgRiskScore: number
  maxRiskScore?: number
}

export interface TopData {
  by: TopBy
  range: DashboardRange
  limit: number
  serverId: string | null
  items: TopItem[]
  generatedAt: string
}

export interface ServerSummaryItem {
  id: string
  domain: string
  status: string
  mode: string
  dnsVerified: boolean
  gatewayReachable: boolean
  originReachable: boolean
  avgResponseTimeMs: number | null
  currentLoadPercent: number | null
  maxRequestsPerSecond: number | null
  safeRequestsPerSecond: number | null
  p95ResponseTimeMs: number | null
  probeRecommendation: string | null
  probeConfidence: string | null
  lastProbeAt: string | null
  eventsLastHour: number
  blockedLastHour: number
  lastHealthCheckAt: string | null
  lastEventAt: string | null
}

export interface ServersSummaryData {
  servers: ServerSummaryItem[]
  totals: { count: number; online: number; degraded: number; offline: number; pending: number; maintenance: number }
  generatedAt: string
}

export interface ThreatCountry {
  code: string
  total: number
  blocked: number
  challenged: number
  blockRate: number
  threatLevel: ThreatLevel
}

export interface ThreatMapData {
  range: DashboardRange
  periodStart: string
  periodEnd: string
  countries: ThreatCountry[]
  unknownCountryTotal: number
  generatedAt: string
}

/** بيفك الـ wrapper { success, data } */
async function get<T>(path: string, params?: object): Promise<T> {
  const { data } = await api.get<{ success: boolean; data: T }>(path, {
    ...(params && { params: cleanParams(params) }),
  })
  return data.data
}

export const getOverview = (range: DashboardRange, serverId?: string) =>
  get<OverviewData>('/dashboard/overview', { range, serverId })

export const getTimeline = (range: DashboardRange, serverId?: string) =>
  get<TimelineData>('/dashboard/timeline', { range, serverId })

export const getTop = (by: TopBy, range: DashboardRange, limit = 10, serverId?: string) =>
  get<TopData>('/dashboard/top', { by, range, limit, serverId })

export const getServersSummary = () => get<ServersSummaryData>('/dashboard/servers')

export const getThreatMap = (range: DashboardRange) =>
  get<ThreatMapData>('/dashboard/threat-map', { range })
