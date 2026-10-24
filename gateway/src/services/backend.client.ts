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
// 5. دعم مزامنة السيرفرات + السياسات + السمعة + الحظر
//
// ملاحظات مهمة:
// - الـ Backend بيستنى الهيدر: X-Gateway-Key
// - القيمة لازم تبقى نفس GATEWAY_SECRET اللي في .env بتاع الـ Backend
// - في الـ Gateway بنقراها من config.backend.internalSecret
//   (لازم تحط نفس القيمة في الاتنين)
//
// ======================================================

import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config';

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

export type ServerStatus = 'PENDING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'MAINTENANCE';
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

export interface ServerHealthPayload {
  originReachable?: boolean;
  gatewayReachable?: boolean;
  avgResponseTimeMs?: number;
  currentLoadPercent?: number;
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

  // Interceptor للأخطاء
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError<BackendError>) => {
      if (error.response) {
        const data = error.response.data;
        const message =
          data?.message ||
          `Backend error ${error.response.status}`;
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

/**
 * مزامنة كل السيرفرات (مع دعم Pagination)
 */
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

/**
 * بيجيب كل السيرفرات مرة واحدة (بيلف على الـ cursor لوحده)
 */
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

/**
 * جلب سيرفر واحد من الـ Host
 */
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
 * تبليغ صحة السيرفر (بعد Origin Probe)
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
// Policies API
// ======================================================

/**
 * الراوت الأساسي: سيرفر + شركة + Policy في رد واحد
 * (مستحسن تستخدمه مع Redis cache)
 */
export async function resolvePolicyByHost(
  host: string
): Promise<PolicyResolveData> {
  const response = await api.get<BackendSuccess<PolicyResolveData>>(
    '/internal/gateway/policies/resolve',
    { params: { host } }
  );
  return response.data.data;
}

/**
 * نفس النتيجة من serverId
 */
export async function resolvePolicyByServerId(
  serverId: string
): Promise<PolicyResolveData> {
  const response = await api.get<BackendSuccess<PolicyResolveData>>(
    `/internal/gateway/policies/by-server/${serverId}`
  );
  return response.data.data;
}

/**
 * الـ Policy فقط من organizationId
 */
export async function getPolicyByOrg(
  organizationId: string
): Promise<OrgPolicyFromBackend> {
  const response = await api.get<BackendSuccess<OrgPolicyFromBackend>>(
    `/internal/gateway/policies/by-org/${organizationId}`
  );
  return response.data.data;
}

/**
 * فحص نسخة الـ Policy (خفيف)
 */
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

/**
 * الاستعلام عن السمعة قبل اتخاذ القرار
 */
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

/**
 * تسجيل أدلة تقرير واحد
 */
export async function applyReputation(
  payload: ReputationApplyPayload
): Promise<ReputationApplyResult> {
  const response = await api.post<BackendSuccess<ReputationApplyResult>>(
    '/internal/gateway/reputation/apply',
    payload
  );
  return response.data.data;
}

/**
 * دفعة تقارير (مستحسن مع BullMQ)
 */
export async function applyReputationBatch(
  reports: ReputationApplyPayload[]
): Promise<ReputationBatchResult> {
  const response = await api.post<BackendSuccess<ReputationBatchResult>>(
    '/internal/gateway/reputation/apply-batch',
    { reports }
  );
  return response.data.data;
}

/**
 * مزامنة الحظر لـ Redis
 */
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

/**
 * بيجيب كل الحظر مرة واحدة (بيلف على الـ cursor)
 */
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
// Origin Probe Result (من الملف السابق)
// ======================================================

/**
 * إرسال نتيجة الـ Origin Probe
 * (الراوت ده افترضناه /internal/origin-probe أو تقدر تغيره حسب الـ Backend)
 * لو الـ Backend بيستخدم reportServerHealth بس، استخدم reportServerHealth مباشرة.
 */
export async function sendOriginProbeResult(payload: {
  orgId: string;
  serverId?: string;
  originUrl: string;
  probedAt: string;
  health: {
    alive: boolean;
    statusCode: number | null;
    responseTimeMs: number | null;
    error: string | null;
  };
  latency: {
    avgResponseTimeMs: number;
    minResponseTimeMs: number;
    maxResponseTimeMs: number;
    p95ResponseTimeMs: number;
  } | null;
  load: {
    estimatedRps: number;
    avgResponseTimeMs: number;
    successfulRequests: number;
    failedRequests: number;
  } | null;
  summary: {
    isHealthy: boolean;
    avgLatencyMs: number | null;
    estimatedMaxRps: number | null;
    recommendation: string;
  };
}): Promise<void> {
  // لو عندك راوت مخصص للـ probe استخدمه،
  // وإلا حوّل النتيجة لـ reportServerHealth
  if (payload.serverId) {
    await reportServerHealth(payload.serverId, {
      originReachable: payload.health.alive,
      gatewayReachable: true,
      avgResponseTimeMs: payload.summary.avgLatencyMs ?? undefined,
      currentLoadPercent: undefined,
      lastError: payload.health.error ?? undefined,
    });
  }
}

// ======================================================
// Utility
// ======================================================

/**
 * اختبار سريع إن الـ Backend بيستقبل المفتاح صح
 */
export async function pingBackend(): Promise<boolean> {
  try {
    // نجرب راوت خفيف
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

export default {
  // Servers
  fetchServers,
  fetchAllServers,
  resolveServerByHost,
  reportServerHealth,

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

  // Probe
  sendOriginProbeResult,

  // Utility
  pingBackend,
};