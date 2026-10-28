// frontend/src/services/types.ts
// ==================================================================
// أنواع مشتركة بين كل الـ services
// مطابقة للـ Schemas في الباك إند + كل الـ helpers المشتركة
// ==================================================================

// ==================== Pagination ====================

export interface Pagination {
  total: number
  page: number
  limit: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

// ==================== Decision & IP ====================

export type Decision =
  | 'ALLOW'
  | 'MONITOR'
  | 'RATE_LIMIT'
  | 'CHALLENGE'
  | 'BLOCK'

export type IpType =
  | 'RESIDENTIAL'
  | 'MOBILE'
  | 'DATACENTER'
  | 'VPN_PROXY'
  | 'TOR'
  | 'UNKNOWN'

export type BanStatus = 'NONE' | 'TEMPORARY' | 'PERMANENT'

// ==================== User / Role ====================

export type Role = 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER'

// اسم بديل لـ Role (لو حد بيستخدم UserRole)
export type UserRole = Role

export interface User {
  id: string
  email: string
  name: string
  role: Role
  organizationId: string
  createdAt: string
}

// ==================== Auth Tokens ====================

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

// ==================== Organization ====================

export interface Organization {
  id: string
  name: string
  slug: string
  plan: 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE'
  createdAt: string
}

// ==================== Server ====================

export type ServerStatus =
  | 'PENDING'
  | 'ONLINE'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'MAINTENANCE'

export type ServerMode = 'PROTECT' | 'MONITOR_ONLY'

export type ProbeConfidence = 'high' | 'medium' | 'low' | null

export type ProbeRecommendation =
  | 'excellent'
  | 'good'
  | 'fair'
  | 'poor'
  | 'down'
  | null

export interface Server {
  id: string
  organizationId: string
  domain: string
  originIp: string
  originPort: number
  status: ServerStatus
  mode: ServerMode
  dnsVerified: boolean
  gatewayReachable: boolean
  originReachable: boolean
  sslEnabled: boolean
  avgResponseTimeMs: number | null
  currentLoadPercent: number | null
  // الحقول الجديدة من الـ Probe
  maxRequestsPerSecond: number | null
  safeRequestsPerSecond: number | null
  p95ResponseTimeMs: number | null
  loadLatencyP99Ms: number | null
  probeErrorRate: number | null
  probeConfidence: ProbeConfidence
  probeRecommendation: ProbeRecommendation
  lastProbeAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ServerDnsInstructions {
  domain: string
  gatewayIp: string
  expectedRecords: Array<{
    type: 'A' | 'CNAME' | 'TXT'
    name: string
    value: string
  }>
  verificationToken?: string
}

// ==================== Notifications ====================

export type NotificationType =
  | 'INFO'
  | 'WARNING'
  | 'ERROR'
  | 'SUCCESS'
  | 'SECURITY'
  | 'REPORT_READY'
  | 'SERVER_STATUS'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  read: boolean
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ==================== Reports ====================

export type ReportType = 'PERIODIC' | 'INCIDENT' | 'ON_DEMAND'

export type ReportStatus = 'PENDING' | 'GENERATING' | 'READY' | 'FAILED'

export interface Report {
  id: string
  organizationId: string
  title: string
  type: ReportType
  status: ReportStatus
  periodStart: string
  periodEnd: string
  content: string | null
  summary: string | null
  errorMessage: string | null
  eventCount: number
  blockedCount: number
  tokensUsed: number | null
  modelUsed: string | null
  serverId: string | null
  securityEventId: string | null
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ReportChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ReportChatResponse {
  reply: string
  tokensUsed: number
}

// ==================== Dashboard ====================

export type DashboardRange = '1h' | '24h' | '7d' | '30d'

export interface DashboardOverview {
  total: number
  allowed: number
  blocked: number
  challenged: number
  rateLimited: number
  monitored: number
  avgScore: number
  surgeDetected: boolean
  surgeCount: number
  challengesTotal: number
  challengesPassed: number
  challengesFailed: number
  serversByStatus: Record<ServerStatus, number>
  activeBans: number
  permanentBans: number
  criticalBans: number
  newBansInPeriod: number
  unreadNotifications: number
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

export interface TopEntry {
  value: string
  label: string
  total: number
  blocked: number
  challenged: number
  rateLimited: number
  allowed: number
  avgRiskScore: number
  maxRiskScore: number
}

export type TopBy = 'ip' | 'path' | 'country' | 'asn' | 'ipType' | 'stage'

export interface ThreatCountry {
  code: string
  total: number
  blocked: number
  challenged: number
  blockRate: number
  threatLevel: 'low' | 'medium' | 'high' | 'critical'
}

export interface ThreatMapData {
  countries: ThreatCountry[]
  unknownCountryTotal: number
}

// ==================== Security Events ====================

export interface SecurityEvent {
  id: string
  serverId: string
  ip: string
  path: string
  method: string
  stage: string
  riskScore: number
  action: 'ALLOW' | 'BLOCK' | 'CHALLENGE' | 'RATE_LIMIT'
  reason: string
  country?: string
  userAgent?: string
  createdAt: string
}

// ==================== Socket Payloads ====================

export interface SocketServerStatusPayload {
  id: string
  organizationId: string
  domain: string
  status: ServerStatus
  mode: ServerMode
  dnsVerified: boolean
  gatewayReachable: boolean
  originReachable: boolean
  avgResponseTimeMs: number | null
  currentLoadPercent: number | null
  maxRequestsPerSecond: number | null
  safeRequestsPerSecond: number | null
  p95ResponseTimeMs: number | null
  loadLatencyP99Ms: number | null
  probeErrorRate: number | null
  probeConfidence: ProbeConfidence
  probeRecommendation: ProbeRecommendation
  lastProbeAt: string | null
  previousStatus: ServerStatus
  action: 'created' | 'updated' | 'status_changed' | 'deleted' | 'verified'
  updatedAt: string
}

export interface SocketReportStatusPayload {
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

// ==================== API Errors ====================

export interface ApiError {
  statusCode: number
  error: string
  message: string
  code?: string
  errors?: Array<{ field: string; message: string }>
  details?: { retryAfterSec?: number; [key: string]: unknown }
}

// ==================== Helpers ====================

/** يشيل القيم الفاضية قبل ما نبعت الـ query params للباك (الباك بيرفض '' في بعض الحقول) */
export function cleanParams<T extends object>(params: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return out as Partial<T>
}