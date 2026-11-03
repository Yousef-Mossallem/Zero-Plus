// frontend/src/services/simulationsService.ts
// ==================================================================
// Zero Plus - Simulations Service (Simulation Lab)
// الـ Contract حسب الـ Frontend Spec (Prefix: /simulations)
//   POST /simulations              → 201 { success, data: Run }
//   POST /simulations/:id/stop     → 200 { success, data: Partial<Run> }
//   GET  /simulations/:id          → { success, data: Run }
//   GET  /simulations?page&limit   → { success, data: { items, pagination } }
//   GET  /events?simulationRunId=  → (موديول الأحداث الحالي)
// organizationId بيتاخد من الـ JWT في الباك، فمبنبعتوش من هنا أبدًا.
// الـ UI بيكلّم الـ Backend فقط (ممنوع استدعاء الـ Gateway من المتصفح).
// ==================================================================

import api from './api'
import { cleanParams } from './types'
import { getEvents, type SecurityEvent } from './eventsService'

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type SimulationPattern =
  | 'realistic_mix'
  | 'legit_only'
  | 'login_focus'
  | 'rate_stress'
  | 'bot_wave'
  | 'ban_recovery'
  | 'full_pipeline'
  | 'custom'

export type RunStatus = 'RUNNING' | 'STOPPED' | 'COMPLETED' | 'FAILED'
export type Intensity = 'low' | 'medium' | 'high'
export type AiMode = 'auto' | 'fixed' | 'off'

export type PersonaKey =
  | 'legit_ok'
  | 'legit_sensitive'
  | 'rate_soft'
  | 'rate_hard'
  | 'bot_ua'
  | 'fail_js'
  | 'pass_js'
  | 'bad_ip'

export type PersonaWeights = Record<PersonaKey, number>

export interface RunTotals {
  sent: number
  allowed: number
  challenged: number
  rateLimited: number
  blocked: number
}

export interface SimulationRun {
  id: string
  status: RunStatus
  serverId: string
  serverDomain: string | null
  pattern: string
  durationSec: number | null
  targetRps: number | null
  maxRps: number | null
  intensity: string | null
  startedAt: string
  stoppedAt: string | null
  /** حقول ناقصة = مش متاحة من الباك (بتتعرض N/A) */
  totals: Partial<RunTotals>
  avgLatencyMs: number | null
  options: Record<string, unknown>
}

export interface StartSimulationOptions {
  personaWeights?: PersonaWeights
  ipPoolLegit?: number
  ipPoolAttack?: number
  enableJaHeaders?: boolean
  aiMode?: AiMode
  aiFixedScore?: number
  paths?: string[]
  seed?: number | null
}

export interface StartSimulationInput {
  serverId: string
  pattern: SimulationPattern
  durationSec: number
  targetRps: number
  maxRps: number
  intensity: Intensity
  options?: StartSimulationOptions
}

export interface SimulationsPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface SimulationsListResult {
  items: SimulationRun[]
  pagination: SimulationsPagination
}

export const TERMINAL_STATUSES: RunStatus[] = ['STOPPED', 'COMPLETED', 'FAILED']

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

// ------------------------------------------------------------------
// Normalizers (الباك هو مصدر الحقيقة، بس بنتحمّل الحقول الناقصة)
// ------------------------------------------------------------------

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function numOrNull(v: unknown): number | null {
  return numOrUndef(v) ?? null
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function normalizeStatus(v: unknown): RunStatus {
  const s = typeof v === 'string' ? v.toUpperCase() : ''
  return s === 'RUNNING' || s === 'STOPPED' || s === 'COMPLETED' || s === 'FAILED' ? s : 'FAILED'
}

function normalizeTotals(v: unknown): Partial<RunTotals> {
  if (!isObject(v)) return {}
  const out: Partial<RunTotals> = {}
  const keys: Array<keyof RunTotals> = ['sent', 'allowed', 'challenged', 'rateLimited', 'blocked']
  for (const key of keys) {
    const n = numOrUndef(v[key])
    if (n !== undefined) out[key] = n
  }
  return out
}

export function normalizeRun(raw: unknown): SimulationRun {
  const r: Json = isObject(raw) ? raw : {}
  return {
    id: String(r['id'] ?? ''),
    status: normalizeStatus(r['status']),
    serverId: String(r['serverId'] ?? ''),
    serverDomain: strOrNull(r['serverDomain']),
    pattern: String(r['pattern'] ?? ''),
    durationSec: numOrNull(r['durationSec']),
    targetRps: numOrNull(r['targetRps']),
    maxRps: numOrNull(r['maxRps']),
    intensity: strOrNull(r['intensity']),
    startedAt: String(r['startedAt'] ?? ''),
    stoppedAt: strOrNull(r['stoppedAt']),
    totals: normalizeTotals(r['totals']),
    avgLatencyMs: numOrNull(r['avgLatencyMs']),
    options: isObject(r['options']) ? r['options'] : {},
  }
}

/** دمج رد الـ Stop (حقول جزئية) فوق الـ Run الحالي */
export function mergeRun(prev: SimulationRun, partial: unknown): SimulationRun {
  const p: Json = isObject(partial) ? partial : {}
  return {
    ...prev,
    status: p['status'] !== undefined ? normalizeStatus(p['status']) : prev.status,
    stoppedAt: p['stoppedAt'] !== undefined ? strOrNull(p['stoppedAt']) : prev.stoppedAt,
    totals: p['totals'] !== undefined ? { ...prev.totals, ...normalizeTotals(p['totals']) } : prev.totals,
    avgLatencyMs: p['avgLatencyMs'] !== undefined ? numOrNull(p['avgLatencyMs']) : prev.avgLatencyMs,
  }
}

// ------------------------------------------------------------------
// Calls
// ------------------------------------------------------------------

export async function startSimulation(input: StartSimulationInput): Promise<SimulationRun> {
  const { data } = await api.post<{ success: boolean; data: unknown }>('/simulations', input)
  return normalizeRun(data.data)
}

/** بيرجع الرد الجزئي كما هو (الـ Hook بيدمجه مع الـ Run الحالي) */
export async function stopSimulation(id: string): Promise<unknown> {
  const { data } = await api.post<{ success: boolean; data: unknown }>(
    `/simulations/${encodeURIComponent(id)}/stop`,
  )
  return data.data
}

export async function getSimulation(id: string): Promise<SimulationRun> {
  const { data } = await api.get<{ success: boolean; data: unknown }>(
    `/simulations/${encodeURIComponent(id)}`,
  )
  return normalizeRun(data.data)
}

export async function listSimulations(
  query: { page?: number; limit?: number } = {},
): Promise<SimulationsListResult> {
  const { data } = await api.get<{ success: boolean; data: unknown }>('/simulations', {
    params: cleanParams(query),
  })
  const d: Json = isObject(data.data) ? data.data : {}
  const rawItems = Array.isArray(d['items']) ? d['items'] : []
  const pg: Json = isObject(d['pagination']) ? d['pagination'] : {}

  const page = numOrUndef(pg['page']) ?? query.page ?? 1
  const limit = numOrUndef(pg['limit']) ?? query.limit ?? 20
  const total = numOrUndef(pg['total']) ?? rawItems.length

  return {
    items: rawItems.map(normalizeRun),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / Math.max(1, limit))) },
  }
}

/**
 * أحداث Run معيّن من موديول الأحداث الحالي.
 * بنفلتر على reasonDetails.simulationRunId في الفرونت لتجنب عرض أحداث Runs تانية.
 */
export async function getRunEvents(runId: string, limit = 100): Promise<SecurityEvent[]> {
  const res = await getEvents({
    limit,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  })
  return res.events.filter((e) => e.reasonDetails?.['simulationRunId'] === runId)
}