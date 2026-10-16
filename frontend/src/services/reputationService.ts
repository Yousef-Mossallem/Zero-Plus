// frontend/src/services/reputationService.ts
// ==================================================================
// Zero Plus - Reputation Service
// مربوط بـ backend/modules/reputation (reputation.routes.ts)
//   GET  /reputation                → { success, data[], pagination }
//   GET  /reputation/stats          → { success, data: stats }
//   GET  /reputation/:id            → { success, data }
//   GET  /reputation/:id/challenges → { success, data[], pagination }
//   POST /reputation/:id/ban        → body { type, minutes?, reason }      (OWNER/ADMIN/ANALYST)
//   POST /reputation/:id/unban      → body { reason?, resetScore? }
//   POST /reputation/:id/allowlist  → body { enabled, reason? }
//   POST /reputation/:id/reset      → body { confirm:true, reason? }
// ==================================================================

import api from './api'
import { cleanParams } from './types'
import type { BanStatus, IpType, Pagination } from './types'

export type ScoreBand = 'CLEAN' | 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL'

export interface ReputationEntry {
  id: string
  organizationId: string
  ipAddress: string
  deviceFingerprint: string | null
  ja3Fingerprint: string | null
  ja4Fingerprint: string | null
  countryCode: string | null
  asn: number | null
  asOrg: string | null
  ipType: IpType
  score: number
  scoreBand: ScoreBand
  banStatus: BanStatus
  bannedUntil: string | null
  bannedAt: string | null
  banReason: string | null
  isManualBan: boolean
  isAllowlisted: boolean
  failedChecksCount: number
  successfulChecks: number
  totalRequests: number
  lastFailedAt: string | null
  lastPath: string | null
  lastUserAgent: string | null
  avgRequestRate: number | null
  isKnownBotnet: boolean
  firstSeenAt: string
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

export interface ReputationStats {
  total: number
  byBanStatus: Record<BanStatus, number>
  byBand: Record<ScoreBand, number>
  allowlisted: number
  knownBotnets: number
}

export interface ChallengeLog {
  id: string
  challengeType: string
  passed: boolean
  durationMs: number | null
  failureReason: string | null
  serverId: string | null
  createdAt: string
}

export type ReputationSortBy =
  | 'score'
  | 'lastSeenAt'
  | 'firstSeenAt'
  | 'failedChecksCount'
  | 'totalRequests'
  | 'bannedUntil'
  | 'createdAt'

export interface ReputationQuery {
  page?: number
  limit?: number
  banStatus?: BanStatus
  ipType?: IpType
  countryCode?: string
  asn?: number
  minScore?: number // 1..10
  maxScore?: number // 1..10
  isAllowlisted?: boolean
  isManualBan?: boolean
  isKnownBotnet?: boolean
  search?: string
  sortBy?: ReputationSortBy
  sortOrder?: 'asc' | 'desc'
}

export interface ReputationListResult {
  data: ReputationEntry[]
  pagination: Pagination
}

export type BanInput =
  | { type: 'TEMPORARY'; minutes: number; reason: string }
  | { type: 'PERMANENT'; reason: string }

export interface ActionResult {
  message: string
  entry: ReputationEntry
  /** false = الحالة المطلوبة كانت موجودة أصلًا */
  changed: boolean | undefined
}

// ------------------------------------------------------------------
// Reads
// ------------------------------------------------------------------

export async function listReputation(
  query: ReputationQuery = {},
): Promise<ReputationListResult> {
  const { data } = await api.get<{ success: boolean } & ReputationListResult>('/reputation', {
    params: cleanParams(query),
  })
  return { data: data.data, pagination: data.pagination }
}

export async function getReputationStats(): Promise<ReputationStats> {
  const { data } = await api.get<{ success: boolean; data: ReputationStats }>(
    '/reputation/stats',
  )
  return data.data
}

export async function listChallenges(
  id: string,
  query: { page?: number; limit?: number; passed?: boolean } = {},
): Promise<{ data: ChallengeLog[]; pagination: Pagination }> {
  const { data } = await api.get(`/reputation/${id}/challenges`, {
    params: cleanParams(query),
  })
  return { data: data.data, pagination: data.pagination }
}

// ------------------------------------------------------------------
// Actions (محتاجة OWNER / ADMIN / ANALYST)
// ------------------------------------------------------------------

async function action(path: string, body: object): Promise<ActionResult> {
  const { data } = await api.post<{
    message: string
    data: ReputationEntry
    changed?: boolean
  }>(path, body)
  return { message: data.message, entry: data.data, changed: data.changed }
}

export const banEntry = (id: string, input: BanInput) =>
  action(`/reputation/${id}/ban`, input)

export const unbanEntry = (id: string, input: { reason?: string; resetScore?: boolean } = {}) =>
  action(`/reputation/${id}/unban`, input)

export const setAllowlist = (id: string, enabled: boolean, reason?: string) =>
  action(`/reputation/${id}/allowlist`, { enabled, ...(reason && { reason }) })

export const resetEntry = (id: string, reason?: string) =>
  action(`/reputation/${id}/reset`, { confirm: true, ...(reason && { reason }) })
