// ======================================================
// ZERO PLUS GATEWAY — Backend Client
// العميل الرسمي للتواصل مع الـ Backend (Internal API)
// ======================================================
//
// المسؤوليات:
// 1. كل الطلبات اللي بتروح للـ Backend تحت /internal/gateway
// 2. إضافة الهيدر X-Gateway-Key تلقائيًا
// 3. التعامل مع الأخطاء الموحدة
// 4. دعم الـ Pagination (cursor)
// 5. مزامنة السيرفرات + السياسات + السمعة + الحظر
// 6. إرسال نتائج Origin Probe الكاملة + Security Events
//
// ملاحظات:
// - الهيدر: X-Gateway-Key = config.backend.internalSecret
// - لازم يطابق GATEWAY_SECRET في .env بتاع الـ Backend
// ======================================================

import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config';
import type { OriginProbeResult } from './origin.probe';

// ======================================================
// الأنواع المشتركة
// ======================================================

export interface BackendSuccess<T> {
  success: true;
  data: T;
}

export interface BackendError {
  success: false;
  code?: string;
  message: string;
  errors?: Array<{ field: string; message: string }>;
  details?: Record<string, unknown>;
}

export type BackendResponse<T> = BackendSuccess<T> | BackendError;

// -------------------- Servers --------------------

export type ServerStatus =
  | 'PENDING'
  | 'ONLINE'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'MAINTENANCE';

export type ServerMode = 'PROTECT' | 'MONITOR_ONLY';

export interface GatewayServer {
  id: string;
  domain: string;
  organizationId: string;
  originIp: string;
  originPort: number;
  sslEnabled: boolean;
  status: ServerStatus;
  mode: ServerMode;
  dnsVerified: boolean;
  gatewayReachable: boolean;
  originReachable: boolean;
  maxRequestsPerSecond: number | null;
  updatedAt: string;
}

export interface ServersListData {
  servers: GatewayServer[];
  nextCursor: string | null;
  serverTime: string;
}

/**
 * تقرير صحة موسّع — يشمل نتائج الـ Origin Probe
 * ملاحظة: الـ Backend لازم يقبل الحقول الجديدة (أو يتجاهل الزيادة لو لسه مش محدّث)
 */
export interface ServerHealthPayload {
  originReachable?: boolean;
  /** لا تُرسل من الـ Probe — تثبتها DNS verify أو الترافيك الحقيقي */
  gatewayReachable?: boolean;
  avgResponseTimeMs?: number;
  p95ResponseTimeMs?: number;
  loadLatencyP99Ms?: number;
  currentLoadPercent?: number;
  maxRequestsPerSecond?: number;
  safeRequestsPerSecond?: number;
  probeErrorRate?: number;
  probeConfidence?: 'high' | 'medium' | 'low';
  probeRecommendation?: 'excellent' | 'good' | 'fair' | 'poor' | 'down';
  probeDetails?: {
    steps: Array<{
      connections: number;
      rps: number;
      p99Ms: number;
      errorRate: number;
    }>;
    runs: Array<{ rps: number }>;
    saturated?: boolean;
    redirected?: boolean;
  };
  lastError?: string;
}

export interface ServerHealthResult {
  id: string;
  status: ServerStatus;
  previousStatus: ServerStatus;
}

// -------------------- Policies --------------------

export interface OrgPolicyFromBackend {
  organizationId: string;
  allowMaxScore: number;
  rateLimitMaxScore: number;
  challengeMaxScore: number;
  enableJsChallenge: boolean;
  challengeAllVisitors: boolean;
  passTokenTtlMinutes: number;
  rateLimitRequests: number;
  rateLimitWindowSec: number;
  maxRequestsPerIp: number;
  maxRequestsWindowSec: number;
  banOnMaxRequests: boolean;
  maxServerRps: number | null;
  capacityWarnPercent: number;
  autoBanAfterFails: number;
  temporaryBanMinutes: number;
  permanentBanScore: number;
  enableAiAnomaly: boolean;
}

export interface PolicyResolveData {
  organizationId: string;
  server: {
    id: string;
    domain: string;
    originIp: string;
    originPort: number;
    status: ServerStatus;
    mode: ServerMode;
    maxRequestsPerSecond: number | null;
  };
  policy: OrgPolicyFromBackend;
  effectiveMaxServerRps: number | null;
  policyVersion: string;
}

export interface PolicyVersionData {
  organizationId: string;
  policyVersion: string;
}

// -------------------- Reputation --------------------

export type BanStatus = 'NONE' | 'TEMPORARY' | 'PERMANENT';
export type SignalSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ReputationEffective {
  score: number;
  scoreBand: string;
  banStatus: BanStatus;
  isCurrentlyBanned: boolean;
  bannedUntil: string | null;
  minutesLeftOnBan: number | null;
  isAllowlisted: boolean;
  isManualBan: boolean;
  isKnownBotnet: boolean;
  failedChecksCount: number;
  reputationRiskPoints: number;
}

export interface ReputationLookupData {
  found: boolean;
  matchedBy: 'IP' | 'DEVICE_FINGERPRINT' | null;
  entry: Record<string, unknown> | null;
  effective: ReputationEffective;
}

export interface ReputationSignal {
  type: string;
  severity: SignalSeverity;
  confidence?: number;
  count?: number;
  anomalyScore?: number;
  note?: string;
}

export interface ReputationApplyPayload {
  organizationId: string;
  serverId?: string;
  ipAddress: string;
  requestCount?: number;
  signals: ReputationSignal[];
  challenge?: {
    type: string;
    passed: boolean;
    durationMs?: number;
    failureReason?: string;
  };
  deviceFingerprint?: string;
  ja3Fingerprint?: string;
  ja4Fingerprint?: string;
  countryCode?: string;
  asn?: number;
  asOrg?: string;
  ipType?: string;
  lastPath?: string;
  lastUserAgent?: string;
  avgRequestRate?: number;
  idempotencyKey?: string;
}

export interface ReputationApplyResult {
  applied: boolean;
  entry: Record<string, unknown> | null;
  change: {
    scoreBefore: number;
    scoreAfter: number;
    pointsRaw: number;
    pointsApplied: number;
    decayApplied: number;
    failedChecksBefore: number;
    failedChecksAfter: number;
    banStatusBefore: BanStatus;
    banStatusAfter: BanStatus;
    newlyBanned: boolean;
    banType: string | null;
    signals: unknown[];
  } | null;
}

export interface ReputationBatchResult {
  results: Array<
    | { index: number; ok: true; result: ReputationApplyResult }
    | { index: number; ok: false; code: string; message: string }
  >;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    newlyBanned: number;
  };
}

export interface BanSyncItem {
  id: string;
  organizationId: string;
  ipAddress: string;
  deviceFingerprint: string | null;
  ja3Fingerprint: string | null;
  ja4Fingerprint: string | null;
  banStatus: BanStatus;
  bannedUntil: string | null;
  isAllowlisted: boolean;
  updatedAt: string;
}

export interface BansSyncData {
  bans: BanSyncItem[];
  nextCursor: string | null;
  serverTime: string;
}

// -------------------- Events --------------------

export type EventDecision =
  | 'ALLOW'
  | 'MONITOR'
  | 'RATE_LIMIT'
  | 'CHALLENGE'
  | 'BLOCK';

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD';

export type IpTypeValue =
  | 'RESIDENTIAL'
  | 'MOBILE'
  | 'DATACENTER'
  | 'VPN_PROXY'
  | 'TOR'
  | 'UNKNOWN';

export type ChallengeTypeValue =
  | 'JS_SILENT'
  | 'TLS_FINGERPRINT'
  | 'RATE_LIMIT_SOFT'
  | 'CAPTCHA_FALLBACK';

export type DetectionStageValue =
  | 'BAN_LIST'
  | 'PASS_TOKEN'
  | 'IP_LOOKUP'
  | 'JS_CHALLENGE'
  | 'HISTORY_MATCH'
  | 'DEEP_COMPARISON'
  | 'TLS_FINGERPRINT'
  | 'AI_ANOMALY'
  | 'HARD_LIMIT'
  | 'POLICY'
  | 'SURGE_DETECTED'
  | 'CLEARANCE_REVOKED';

export interface GatewaySecurityEvent {
  organizationId: string;
  serverId: string;
  ipAddress: string;
  path: string;
  method: HttpMethod;
  riskScore: number;
  decision: EventDecision;
  decidedAtStage?: DetectionStageValue;
  userAgent?: string;
  referer?: string;
  requestId?: string;
  anomalyScore?: number;
  confidence?: number;
  reasonSummary?: string;
  reasonDetails?: Record<string, unknown>;
  processingTimeMs?: number;
  surgeDetected?: boolean;
  pathSensitive?: boolean;
  recommendation?: string;
  countryCode?: string;
  asn?: number;
  ipType?: IpTypeValue;
  isChallenged?: boolean;
  challengeType?: ChallengeTypeValue;
  challengePassed?: boolean;
  reputationEntryId?: string;
}

export interface EventCreated {
  id: string;
  createdAt: string;
}

export interface EventsBatchResult {
  success: boolean;
  summary: { total: number; succeeded: number; failed: number };
  results: Array<
    | { index: number; ok: true; id: string }
    | { index: number; ok: false; code: number; message: string }
  >;
}

// ======================================================
// إنشاء الـ Axios Instance
// ======================================================

function createClient(): AxiosInstance {
  const client = axios.create({
    baseURL: config.backend.url,
    timeout: config.backend.timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Key': config.backend.internalSecret,
      'User-Agent': 'ZeroPlus-Gateway/1.0',
    },
  });

  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError<BackendError>) => {
      if (error.response) {
        const data = error.response.data;
        const message =
          data?.message || `Backend error ${error.response.status}`;
        const code = data?.code || `HTTP_${error.response.status}`;

        const err = new Error(`[Backend] ${code}: ${message}`) as Error & {
          status?: number;
          code?: string;
          details?: unknown;
        };
        err.status = error.response.status;
        err.code = code;
        err.details = data;
        return Promise.reject(err);
      }

      if (error.code === 'ECONNABORTED') {
        return Promise.reject(new Error('[Backend] Request timeout'));
      }

      return Promise.reject(
        new Error(`[Backend] Network error: ${error.message}`)
      );
    }
  );

  return client;
}

const api = createClient();

// ======================================================
// Servers API
// ======================================================

export async function fetchServers(params?: {
  limit?: number;
  cursor?: string;
  updatedSince?: string;
}): Promise<ServersListData> {
  const response = await api.get<BackendSuccess<ServersListData>>(
    '/internal/gateway/servers',
    { params }
  );
  return response.data.data;
}

export async function fetchAllServers(
  updatedSince?: string
): Promise<{ servers: GatewayServer[]; serverTime: string }> {
  const all: GatewayServer[] = [];
  let cursor: string | undefined;
  let serverTime = new Date().toISOString();

  do {
    const page = await fetchServers({
      limit: 500,
      cursor,
      updatedSince,
    });
    all.push(...page.servers);
    cursor = page.nextCursor ?? undefined;
    serverTime = page.serverTime;
  } while (cursor);

  return { servers: all, serverTime };
}

export async function resolveServerByHost(
  host: string
): Promise<GatewayServer> {
  const response = await api.get<BackendSuccess<GatewayServer>>(
    '/internal/gateway/servers/resolve',
    { params: { host } }
  );
  return response.data.data;
}

/**
 * تبليغ صحة السيرفر (بعد Origin Probe أو health دوري)
 */
export async function reportServerHealth(
  serverId: string,
  payload: ServerHealthPayload
): Promise<ServerHealthResult> {
  const response = await api.post<BackendSuccess<ServerHealthResult>>(
    `/internal/gateway/servers/${serverId}/health`,
    payload
  );
  return response.data.data;
}

// ======================================================
// Origin Probe → Backend
// ======================================================

/**
 * يرسل نتيجة الـ Origin Probe الكاملة إلى reportServerHealth
 * - لا يضبط gatewayReachable (ده من DNS verify / ترافيك حقيقي)
 * - يرسل RPS + latency + step history + confidence
 */
export async function sendOriginProbeResult(
  r: OriginProbeResult
): Promise<void> {
  if (!r.serverId) return;

  const steps =
    r.load?.stepHistory?.map((s) => ({
      connections: s.connections,
      rps: s.rps,
      p99Ms: s.p99,
      errorRate: s.errRate,
    })) ?? [];

  const runs =
    r.runs?.map((run) => ({ rps: run.sustainedRps })) ??
    (r.load ? [{ rps: r.load.sustainedRps }] : []);

  // saturated = آخر مرحلة في الـ step history مش healthy
  const saturated =
    r.load?.stepHistory?.length
      ? r.load.stepHistory[r.load.stepHistory.length - 1]?.healthy === false
      : undefined;

  const note =
    r.summary.notes?.length > 0 ? r.summary.notes.join(' | ') : undefined;

  const lastErrorRaw = r.health.error ?? note ?? undefined;
  const lastError =
    typeof lastErrorRaw === 'string'
      ? lastErrorRaw.slice(0, 500)
      : undefined;

  await reportServerHealth(r.serverId, {
    originReachable: r.health.alive,
    // ❌ لا نرسل gatewayReachable من هنا

    avgResponseTimeMs: r.latency?.avgResponseTimeMs,
    p95ResponseTimeMs: r.latency?.p95ResponseTimeMs,
    loadLatencyP99Ms: r.load?.latency?.p99,

    // السعة: sustained من الـ summary / load — للتسعير
    maxRequestsPerSecond:
      r.summary.estimatedMaxRps ?? r.load?.sustainedRps ?? undefined,
    safeRequestsPerSecond: r.summary.safeRps ?? undefined,

    probeErrorRate: r.load?.errorRate,
    probeConfidence: r.summary.confidence,
    probeRecommendation: r.summary.recommendation,

    probeDetails: r.load
      ? {
          steps,
          runs,
          saturated,
          redirected: r.health.redirected === true,
        }
      : {
          steps: [],
          runs,
          redirected: r.health.redirected === true,
        },

    lastError,
  });
}

// ======================================================
// Policies API
// ======================================================

export async function resolvePolicyByHost(
  host: string
): Promise<PolicyResolveData> {
  const response = await api.get<BackendSuccess<PolicyResolveData>>(
    '/internal/gateway/policies/resolve',
    { params: { host } }
  );
  return response.data.data;
}

export async function resolvePolicyByServerId(
  serverId: string
): Promise<PolicyResolveData> {
  const response = await api.get<BackendSuccess<PolicyResolveData>>(
    `/internal/gateway/policies/by-server/${serverId}`
  );
  return response.data.data;
}

export async function getPolicyByOrg(
  organizationId: string
): Promise<OrgPolicyFromBackend> {
  const response = await api.get<BackendSuccess<OrgPolicyFromBackend>>(
    `/internal/gateway/policies/by-org/${organizationId}`
  );
  return response.data.data;
}

export async function getPolicyVersion(
  organizationId: string
): Promise<PolicyVersionData> {
  const response = await api.get<BackendSuccess<PolicyVersionData>>(
    `/internal/gateway/policies/version/${organizationId}`
  );
  return response.data.data;
}

// ======================================================
// Reputation API
// ======================================================

export async function lookupReputation(params: {
  organizationId: string;
  ipAddress: string;
  deviceFingerprint?: string;
  ja3Fingerprint?: string;
  ja4Fingerprint?: string;
}): Promise<ReputationLookupData> {
  const response = await api.get<BackendSuccess<ReputationLookupData>>(
    '/internal/gateway/reputation/lookup',
    { params }
  );
  return response.data.data;
}

export async function applyReputation(
  payload: ReputationApplyPayload
): Promise<ReputationApplyResult> {
  const response = await api.post<BackendSuccess<ReputationApplyResult>>(
    '/internal/gateway/reputation/apply',
    payload
  );
  return response.data.data;
}

export async function applyReputationBatch(
  reports: ReputationApplyPayload[]
): Promise<ReputationBatchResult> {
  const response = await api.post<BackendSuccess<ReputationBatchResult>>(
    '/internal/gateway/reputation/apply-batch',
    { reports }
  );
  return response.data.data;
}

export async function syncBans(params?: {
  limit?: number;
  cursor?: string;
  updatedSince?: string;
  organizationId?: string;
}): Promise<BansSyncData> {
  const response = await api.get<BackendSuccess<BansSyncData>>(
    '/internal/gateway/reputation/bans',
    { params }
  );
  return response.data.data;
}

export async function syncAllBans(params?: {
  updatedSince?: string;
  organizationId?: string;
}): Promise<{ bans: BanSyncItem[]; serverTime: string }> {
  const all: BanSyncItem[] = [];
  let cursor: string | undefined;
  let serverTime = new Date().toISOString();

  do {
    const page = await syncBans({
      limit: 500,
      cursor,
      updatedSince: params?.updatedSince,
      organizationId: params?.organizationId,
    });
    all.push(...page.bans);
    cursor = page.nextCursor ?? undefined;
    serverTime = page.serverTime;
  } while (cursor);

  return { bans: all, serverTime };
}

// ======================================================
// Security Events API
// ======================================================

export async function sendSecurityEvent(
  event: GatewaySecurityEvent
): Promise<EventCreated> {
  const response = await api.post<BackendSuccess<EventCreated>>(
    '/internal/gateway/events',
    event
  );
  return response.data.data;
}

/** مجموعة أحداث (حتى 100). الرد قد يكون 207 */
export async function sendSecurityEventsBatch(
  events: GatewaySecurityEvent[]
): Promise<EventsBatchResult> {
  const response = await api.post<EventsBatchResult>(
    '/internal/gateway/events/batch',
    { events },
    { validateStatus: (s) => s === 200 || s === 207 }
  );
  return response.data;
}

// ======================================================
// Utility
// ======================================================

export async function pingBackend(): Promise<boolean> {
  try {
    await api.get('/internal/gateway/servers', {
      params: { limit: 1 },
      timeout: 3000,
    });
    return true;
  } catch (err) {
    console.error('[BackendClient] Ping failed:', (err as Error).message);
    return false;
  }
}

// ======================================================
// Default export
// ======================================================

export default {
  // Servers
  fetchServers,
  fetchAllServers,
  resolveServerByHost,
  reportServerHealth,
  sendOriginProbeResult,

  // Policies
  resolvePolicyByHost,
  resolvePolicyByServerId,
  getPolicyByOrg,
  getPolicyVersion,

  // Reputation
  lookupReputation,
  applyReputation,
  applyReputationBatch,
  syncBans,
  syncAllBans,

  // Events
  sendSecurityEvent,
  sendSecurityEventsBatch,

  // Utility
  pingBackend,
};