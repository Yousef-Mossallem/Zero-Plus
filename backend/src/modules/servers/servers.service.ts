// backend/src/modules/servers/servers.service.ts
// ==================================================================
// Zero Plus - Servers Service
// ------------------------------------------------------------------
// مسؤول عن:
//   - إنشاء/عرض/تعديل/حذف السيرفرات المحمية (معزولة بالـ organizationId)
//   - مسارين منفصلين تمامًا حسب setupMode (بيتحدد عند الإنشاء فقط):
//       ORIGIN → دومين + originIp + DNS (TXT/CNAME/A) + verify + Origin Probe
//       GUARD  → دومين فقط + Agent/نفق (من غير originIp ولا DNS ولا Probe)
//   - وضع الصيانة وحساب حالة السيرفر (status) من الصحة الفعلية
//       ORIGIN: gateway/origin reachability + latency
//       GUARD : tunnelUp + نبضة Agent حديثة + latency   (طبقتين منفصلتين)
//   - خدمة الـ Gateway: مزامنة + resolve + استقبال تقارير الصحة/الـ Probe
//   - تشغيل Origin Probe (light/full) + تاريخ القياسات (ORIGIN فقط)
//   - بث Socket.IO للداشبورد عند تغيّر الحالة أو نتائج الـ Probe
//
// قواعد وضع الربط (مصدرها servers.schema.ts):
//   - إنشاء Guard لا يستدعي probeGateway نهائيًا، ولا يفرض originIp
//   - requestProbe / verifyServer / getDnsInstructions مرفوضين لـ Guard (409)
//   - updateServer لا يشغّل re-probe ولا يصفّر حقول أصل على Guard
//   - تقارير الصحة لـ Guard بتتنضف من حقول الأصل/الـ Probe قبل التخزين
//
// ⚠ قرار منتج (التوجيه): toGatewayPayload بيبعت setupMode + حالة النفق
//   للـ Gateway. سيرفر Guard بيطلع originIp = null. لو الـ Gateway لسه
//   بيوجّه بـ originIp فقط، يا إما يفهم setupMode ويتوجه للنفق، أو Guard
//   يتسجّل في الداشبورد والـ Agent بس (التوجيه الكامل مرحلة لاحقة).
//   ونفس الكلام على مسار policies/resolve (بيرجّع server جواه originIp).
// ==================================================================

import { randomUUID } from "node:crypto";
import { Resolver } from "node:dns/promises";
import {
  Prisma,
  type Server,
  type ServerSetupMode,
  type ServerStatus,
} from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { SocketEvents } from "../../plugins/socket.plugin.js";
import {
  SETUP_MODE_ERRORS,
  buildDnsInstructions,
  buildSetupInstructions,
  dnsTxtRecordName,
  dnsTxtRecordValue,
  getServerCapabilities,
  hasHealthValues,
  normalizeHostHeader,
  readDnsConfig,
  resolveServerUpdate,
  sanitizeHealthReportForSetupMode,
  supportsFeature,
} from "./servers.schema.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import type {
  CreateServerInput,
  DnsCheckResult,
  DnsConfig,
  DnsInstructions,
  DnsVerificationResult,
  GatewayHealthReport,
  GatewayServerPayload,
  GatewayServersListResult,
  GatewayServersQuery,
  GuardInstructions,
  ListServersQuery,
  ResolvedServerUpdate,
  ServerFeature,
  SetupModeErrorCode,
  UpdateServerInput,
  VerifyServerInput,
} from "./servers.schema.js";

// ==================================================================
// Config
// ==================================================================

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const MAX_SERVERS_PER_ORG = envInt("MAX_SERVERS_PER_ORG", 25);
const DEGRADED_RESPONSE_MS = envInt("SERVER_DEGRADED_RESPONSE_MS", 2000);
const VERIFY_COOLDOWN_MS = envInt("DNS_VERIFY_COOLDOWN_SEC", 10) * 1000;
const DNS_TIMEOUT_MS = envInt("DNS_TIMEOUT_MS", 3000);
const DEFAULT_CAPACITY_WARN_PERCENT = 80;

/** full probe فقط بعد إثبات الملكية (إلا لو PROBE_REQUIRE_OWNERSHIP=false) — ORIGIN فقط */
const PROBE_REQUIRE_OWNERSHIP = process.env.PROBE_REQUIRE_OWNERSHIP !== "false";
/** تبريد بين قياسات يدوية (ثواني → ms) */
const PROBE_COOLDOWN_MS = envInt("PROBE_COOLDOWN_SEC", 600) * 1000;

/**
 * GUARD: أقصى مدة من آخر نبضة Agent قبل ما السيرفر يتحسب OFFLINE
 * (حتى لو tunnelUp لسه true في القاعدة).
 */
const GUARD_HEARTBEAT_STALE_MS = envInt("GUARD_HEARTBEAT_STALE_SEC", 120) * 1000;

/** عنوان الـ Gateway الداخلي: localhost في التطوير، gateway داخل Docker */
function gatewayInternalUrl(): string {
  return (
    process.env.GATEWAY_INTERNAL_URL ??
    (process.env.NODE_ENV === "production"
      ? "http://gateway:3000"
      : "http://localhost:3000")
  );
}

// ==================================================================
// Types & Errors
// ==================================================================

export class ServerServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ServerServiceError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface ServerChange {
  field: "domain" | "originIp" | "originPort" | "sslEnabled" | "mode";
  from: string | number | boolean | null;
  to: string | number | boolean;
}

/** (للتوافق) سيرفر + تعليمات DNS — لمسار ORIGIN فقط */
export interface ServerWithDns {
  server: Server;
  dns: DnsInstructions;
}

/**
 * رد الإنشاء / الـ setup حسب وضع الربط.
 *   ORIGIN → dns موجود، guard = null
 *   GUARD  → dns = null،  guard فيه خطوات تفعيل النفق
 * (dns بيفضل مفتاح في الرد للتوافق، بس قيمته null لـ Guard)
 */
export interface ServerWithSetup {
  server: Server;
  setupMode: ServerSetupMode;
  dns: DnsInstructions | null;
  guard: GuardInstructions | null;
  capabilities: ReturnType<typeof getServerCapabilities>;
  message: string;
}

export interface UpdateServerResult {
  server: Server;
  changes: ServerChange[];
  resets: Array<"dnsVerification" | "originReachability">;
  dns?: DnsInstructions;
}

export interface ListServersResult {
  servers: Server[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  summary: Record<ServerStatus, number>;
  /** عدد السيرفرات لكل وضع ربط (للفلتر في الواجهة) */
  setupSummary: Record<ServerSetupMode, number>;
}

export interface DeleteServerResult {
  id: string;
  domain: string;
  deletedEvents: number;
}

export interface HealthReportResult {
  id: string;
  status: ServerStatus;
  previousStatus: ServerStatus;
}

/** Payload خفيف للـ Dashboard عبر Socket */
export interface ServerRealtimePayload {
  id: string;
  organizationId: string;
  domain: string;
  setupMode: ServerSetupMode;
  status: ServerStatus;
  mode: Server["mode"];
  dnsVerified: boolean;
  gatewayReachable: boolean;
  originReachable: boolean;
  /** GUARD: حالة النفق وآخر نبضة (ORIGIN: false / null) */
  tunnelUp: boolean;
  lastAgentAt: string | null;
  avgResponseTimeMs: number | null;
  currentLoadPercent: number | null;
  maxRequestsPerSecond: number | null;
  safeRequestsPerSecond: number | null;
  p95ResponseTimeMs: number | null;
  probeRecommendation: string | null;
  probeConfidence: string | null;
  lastProbeAt: string | null;
  previousStatus?: ServerStatus;
  action: "created" | "updated" | "status_changed" | "deleted" | "verified";
  updatedAt: string;
}

type Broadcaster = (
  organizationId: string,
  event: string,
  payload: unknown,
) => void;

// ==================================================================
// Helpers
// ==================================================================

function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function domainExistsError(sameOrganization: boolean) {
  return new ServerServiceError(
    sameOrganization
      ? "هذا الدومين مضاف بالفعل في حسابك"
      : "هذا الدومين مسجل بالفعل ولا يمكن إضافته",
    409,
    "DOMAIN_ALREADY_EXISTS",
  );
}

const serverNotFound = () =>
  new ServerServiceError("السيرفر غير موجود", 404, "SERVER_NOT_FOUND");

/**
 * خطأ "الميزة مش متاحة لوضع الربط ده".
 * الـ Probe له كود مميز عشان زر القياس في الداشبورد يتعامل معاه.
 */
function featureNotAvailable(
  feature: ServerFeature,
  setupMode: ServerSetupMode,
): ServerServiceError {
  if (feature === "ORIGIN_PROBE") {
    return new ServerServiceError(
      "قياس السعة التقليدي (Origin Probe) غير متاح لسيرفرات Guard، سعة سيرفر Guard بتيجي من الـ Agent",
      409,
      "PROBE_NOT_AVAILABLE_FOR_GUARD",
      { setupMode, feature },
    );
  }

  const info = SETUP_MODE_ERRORS.FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE;
  return new ServerServiceError(info.messageAr, info.status, info.code, {
    setupMode,
    feature,
  });
}

/** يحوّل أخطاء قواعد وضع الربط (Error(code)) لـ ServerServiceError */
function translateSetupModeError(error: unknown): unknown {
  if (
    error instanceof Error &&
    Object.prototype.hasOwnProperty.call(SETUP_MODE_ERRORS, error.message)
  ) {
    const info = SETUP_MODE_ERRORS[error.message as SetupModeErrorCode];
    return new ServerServiceError(info.messageAr, info.status, info.code);
  }
  return error;
}

// ------------------------------------------------------------------
// حساب الحالة — طبقتين منفصلتين (ما بيتخلطوش)
// ------------------------------------------------------------------

type OriginStatusSource = Pick<
  Server,
  "gatewayReachable" | "originReachable" | "avgResponseTimeMs"
>;

type GuardStatusSource = Pick<
  Server,
  "tunnelUp" | "lastAgentAt" | "avgResponseTimeMs"
>;

export type StatusSource = OriginStatusSource &
  GuardStatusSource &
  Pick<Server, "setupMode">;

/**
 * ORIGIN: توجيه الـ Gateway + وصول الأصل + زمن الاستجابة.
 */
export function computeOriginStatus(s: OriginStatusSource): ServerStatus {
  if (!s.gatewayReachable) return "PENDING";
  if (!s.originReachable) return "OFFLINE";
  if (
    s.avgResponseTimeMs !== null &&
    s.avgResponseTimeMs >= DEGRADED_RESPONSE_MS
  ) {
    return "DEGRADED";
  }
  return "ONLINE";
}

/**
 * GUARD: النفق + نبضة Agent حديثة + زمن الاستجابة.
 * ما بتعتمدش على originReachable ولا gatewayReachable (دول لمسار الأورجن).
 *   - عمره ما بعت نبضة      → PENDING
 *   - النفق واقع أو النبضة قديمة → OFFLINE
 *   - بطيء                   → DEGRADED
 *   - غير كده                → ONLINE
 */
export function computeGuardStatus(
  s: GuardStatusSource,
  now: number = Date.now(),
): ServerStatus {
  if (!s.lastAgentAt) return "PENDING";

  const heartbeatFresh =
    now - s.lastAgentAt.getTime() <= GUARD_HEARTBEAT_STALE_MS;

  if (!s.tunnelUp || !heartbeatFresh) return "OFFLINE";

  if (
    s.avgResponseTimeMs !== null &&
    s.avgResponseTimeMs >= DEGRADED_RESPONSE_MS
  ) {
    return "DEGRADED";
  }
  return "ONLINE";
}

/** المُوزّع: يختار الطبقة المناسبة حسب setupMode */
export function computeServerStatus(s: StatusSource): ServerStatus {
  return s.setupMode === "GUARD" ? computeGuardStatus(s) : computeOriginStatus(s);
}

function toGatewayPayload(s: Server): GatewayServerPayload {
  return {
    id: s.id,
    domain: s.domain,
    organizationId: s.organizationId,

    // ORIGIN = توجيه مباشر للأصل | GUARD = توجيه عبر النفق
    setupMode: s.setupMode,

    // null لسيرفرات GUARD
    originIp: s.originIp,
    originPort: s.originPort,
    sslEnabled: s.sslEnabled,

    status: s.status,
    mode: s.mode,
    dnsVerified: s.dnsVerified,
    gatewayReachable: s.gatewayReachable,
    originReachable: s.originReachable,

    // GUARD: حالة النفق + عنوان الـ peer اللي الـ Gateway يوجّه عليه
    tunnelUp: s.tunnelUp,
    tunnelPeerIp: s.tunnelPeerIp ?? null,
    lastAgentAt: s.lastAgentAt ? s.lastAgentAt.toISOString() : null,

    maxRequestsPerSecond: s.maxRequestsPerSecond,
    safeRequestsPerSecond: s.safeRequestsPerSecond ?? null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

type RealtimeSource = Pick<
  Server,
  | "id"
  | "organizationId"
  | "domain"
  | "setupMode"
  | "status"
  | "mode"
  | "dnsVerified"
  | "gatewayReachable"
  | "originReachable"
  | "tunnelUp"
  | "lastAgentAt"
  | "avgResponseTimeMs"
  | "currentLoadPercent"
  | "maxRequestsPerSecond"
  | "safeRequestsPerSecond"
  | "p95ResponseTimeMs"
  | "probeRecommendation"
  | "probeConfidence"
  | "lastProbeAt"
  | "updatedAt"
>;

function toRealtimePayload(
  s: RealtimeSource,
  action: ServerRealtimePayload["action"],
  previousStatus?: ServerStatus,
): ServerRealtimePayload {
  return {
    id: s.id,
    organizationId: s.organizationId,
    domain: s.domain,
    setupMode: s.setupMode,
    status: s.status,
    mode: s.mode,
    dnsVerified: s.dnsVerified,
    gatewayReachable: s.gatewayReachable,
    originReachable: s.originReachable,
    tunnelUp: s.tunnelUp,
    lastAgentAt: s.lastAgentAt ? s.lastAgentAt.toISOString() : null,
    avgResponseTimeMs: s.avgResponseTimeMs,
    currentLoadPercent: s.currentLoadPercent,
    maxRequestsPerSecond: s.maxRequestsPerSecond,
    safeRequestsPerSecond: s.safeRequestsPerSecond,
    p95ResponseTimeMs: s.p95ResponseTimeMs,
    probeRecommendation: s.probeRecommendation,
    probeConfidence: s.probeConfidence,
    lastProbeAt: s.lastProbeAt ? s.lastProbeAt.toISOString() : null,
    ...(previousStatus !== undefined ? { previousStatus } : {}),
    action,
    updatedAt:
      s.updatedAt instanceof Date
        ? s.updatedAt.toISOString()
        : String(s.updatedAt),
  };
}

type LookupResult<T> =
  | { ok: true; value: T }
  | { ok: false; notFound: boolean };

async function lookup<T>(fn: () => Promise<T>): Promise<LookupResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    return { ok: false, notFound: code === "ENODATA" || code === "ENOTFOUND" };
  }
}

const cleanDnsName = (value: string) =>
  value.trim().toLowerCase().replace(/\.$/, "");
const cleanTxt = (value: string) =>
  value
    .trim()
    .replace(/^"+|"+$/g, "")
    .trim();

const verifyCooldown = new Map<string, number>();

// ==================================================================
// Service
// ==================================================================

export class ServersService {
  private readonly resolver: Resolver;

  constructor(private readonly fastify: FastifyInstance) {
    this.resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
    const servers = (process.env.DNS_RESOLVERS ?? "1.1.1.1,8.8.8.8")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (servers.length > 0) {
      try {
        this.resolver.setServers(servers);
      } catch {
        this.fastify.log.warn(
          { servers },
          "DNS_RESOLVERS غير صالح، هنستخدم الـ resolver الافتراضي للنظام",
        );
      }
    }
  }

  // ================================================================
  // Socket helper
  // ================================================================

  private emitServerStatus(payload: ServerRealtimePayload) {
    try {
      const broadcast = (
        this.fastify as unknown as { broadcastToOrg?: Broadcaster }
      ).broadcastToOrg;

      if (typeof broadcast === "function") {
        broadcast.call(
          this.fastify,
          payload.organizationId,
          SocketEvents.SERVER_STATUS,
          payload,
        );
      }
    } catch (err) {
      this.fastify.log.warn(
        { err, serverId: payload.id },
        "Failed to broadcast server:status",
      );
    }
  }

  private notifications() {
    return new NotificationsService(this.fastify);
  }

  /** الإشعار ما يفشلش العملية الأساسية */
  private async safeNotify(
    input: Parameters<NotificationsService["create"]>[0],
  ) {
    try {
      await this.notifications().create(input);
    } catch (err) {
      this.fastify.log.warn({ err }, "Failed to create notification");
    }
  }

  // ================================================================
  // Origin Probe helpers (ORIGIN فقط)
  // ================================================================

  /**
   * ينادي الـ Gateway لبدء قياس غير متزامن (يتوقع 202)
   * light = health+latency | full = step test كامل
   *
   * حماية على أدنى مستوى: لو السيرفر Guard (أو مفيش originIp) ما نعملش
   * أي قياس خالص، حتى لو حد نادى الدالة بالغلط من مكان تاني.
   */
  private async probeGateway(
    server: Server,
    mode: "light" | "full" = "full",
  ): Promise<void> {
    if (!supportsFeature(server.setupMode, "ORIGIN_PROBE") || !server.originIp) {
      this.fastify.log.debug(
        { serverId: server.id, setupMode: server.setupMode },
        "probeGateway تم تجاهله (السيرفر ملوش أصل للقياس)",
      );
      return;
    }

    const secret = process.env.GATEWAY_SECRET;

    if (!secret) {
      this.fastify.log.warn("GATEWAY_SECRET مش مضبوط، الـ probe اتلغى");
      return;
    }

    const scheme = server.sslEnabled ? "https" : "http";

    const res = await fetch(`${gatewayInternalUrl()}/internal/probe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Key": secret,
      },
      body: JSON.stringify({
        url: `${scheme}://${server.originIp}:${server.originPort}`,
        orgId: server.organizationId,
        serverId: server.id,
        mode,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 409) return; // قياس شغال بالفعل
    if (res.status !== 202) {
      throw new Error(`Gateway probe responded ${res.status}`);
    }
  }

  private probeModeFor(server: Pick<Server, "dnsVerified">): "light" | "full" {
    return !PROBE_REQUIRE_OWNERSHIP || server.dnsVerified ? "full" : "light";
  }

  /**
   * طلب قياس يدوي من الداشبورد (بعد الملكية + cooldown)
   * GUARD → مرفوض (409 PROBE_NOT_AVAILABLE_FOR_GUARD)
   */
  async requestProbe(organizationId: string, serverId: string): Promise<void> {
    const server = await this.findOwned(organizationId, serverId);

    // أول حاجة: وضع الربط (عشان زر القياس ما يشتغلش بالغلط على Guard)
    this.requireFeature(server, "ORIGIN_PROBE");

    if (PROBE_REQUIRE_OWNERSHIP && !server.dnsVerified) {
      throw new ServerServiceError(
        "لازم تثبت ملكية الدومين الأول قبل قياس السعة",
        409,
        "OWNERSHIP_REQUIRED",
      );
    }

    const last = server.lastProbeAt?.getTime() ?? 0;
    const waitSec = Math.ceil((last + PROBE_COOLDOWN_MS - Date.now()) / 1000);
    if (waitSec > 0) {
      throw new ServerServiceError(
        `انتظر ${waitSec} ثانية قبل إعادة القياس`,
        429,
        "PROBE_TOO_FREQUENT",
        { retryAfterSec: waitSec },
      );
    }

    await this.probeGateway(server, "full");
  }

  // ================================================================
  // Private helpers
  // ================================================================

  private assertOriginIsNotGateway(originIp: string) {
    if (readDnsConfig().gatewayIps.includes(originIp)) {
      throw new ServerServiceError(
        "عنوان الـ Origin لا يمكن أن يكون عنوان الـ Gateway نفسه (سيحدث loop)",
        400,
        "ORIGIN_IS_GATEWAY",
      );
    }
  }

  /** يرمي 409 لو الميزة مش متاحة لوضع ربط السيرفر ده */
  private requireFeature(
    server: Pick<Server, "setupMode">,
    feature: ServerFeature,
  ): void {
    if (!supportsFeature(server.setupMode, feature)) {
      throw featureNotAvailable(feature, server.setupMode);
    }
  }

  private async findOwned(organizationId: string, serverId: string) {
    const server = await this.fastify.prisma.server.findFirst({
      where: { id: serverId, organizationId },
    });
    if (!server) throw serverNotFound();
    return server;
  }

  /** رد الإعداد حسب الوضع (dns لـ ORIGIN | guard لـ GUARD) */
  private buildSetupPayload(server: Server, message: string): ServerWithSetup {
    const setup = buildSetupInstructions(server, readDnsConfig());

    return {
      server,
      setupMode: setup.setupMode,
      dns: setup.dns,
      guard: setup.guard,
      capabilities: getServerCapabilities(server.setupMode),
      message,
    };
  }

  // ================================================================
  // Dashboard: CRUD
  // ================================================================

  /**
   * إنشاء سيرفر.
   *
   * ORIGIN:
   *   - originIp إلزامي (الـ schema بتضمنه) + assertOriginIsNotGateway
   *   - إنشاء الصف بحقول الأصل + setupMode = ORIGIN
   *   - probeGateway تلقائي (light قبل الملكية / full بعدها)
   *   - الرد فيه تعليمات DNS
   *
   * GUARD:
   *   - مفيش probeGateway نهائيًا، ولا فرض originIp (بيتخزن null)
   *   - مفيش اعتماد على أي قياس أورجن
   *   - setupMode = GUARD، والرد فيه خطوات تفعيل النفق (dns = null)
   */
  async createServer(
    organizationId: string,
    input: CreateServerInput,
  ): Promise<ServerWithSetup> {
    if (input.setupMode === "ORIGIN") {
      this.assertOriginIsNotGateway(input.originIp);
    }

    const prisma = this.fastify.prisma;

    const count = await prisma.server.count({ where: { organizationId } });
    if (count >= MAX_SERVERS_PER_ORG) {
      throw new ServerServiceError(
        `وصلت للحد الأقصى من السيرفرات (${MAX_SERVERS_PER_ORG})`,
        403,
        "SERVER_LIMIT_REACHED",
      );
    }

    const existing = await prisma.server.findUnique({
      where: { domain: input.domain },
      select: { organizationId: true },
    });
    if (existing) {
      throw domainExistsError(existing.organizationId === organizationId);
    }

    try {
      const server = await prisma.server.create({
        data: {
          organizationId,
          domain: input.domain,
          setupMode: input.setupMode,
          // GUARD: originIp = null دايمًا (الـ schema بتضمن ده)
          originIp: input.originIp,
          originPort: input.originPort,
          sslEnabled: input.sslEnabled,
          ...(input.mode !== undefined && { mode: input.mode }),
        },
      });

      if (server.setupMode === "ORIGIN") {
        // قياس الأصل تلقائي (مش بينتظر نتيجته)
        this.probeGateway(server, this.probeModeFor(server)).catch((err) => {
          this.fastify.log.warn(
            { err, serverId: server.id },
            "Gateway probe failed to start",
          );
        });
      }
      // GUARD: لا probeGateway هنا إطلاقًا — التفعيل بعدين عن طريق enable-tunnel

      this.emitServerStatus(toRealtimePayload(server, "created"));

      return this.buildSetupPayload(
        server,
        server.setupMode === "GUARD"
          ? "تم إضافة السيرفر. الخطوة التالية: فعّل الـ Guard (النفق) لتوليد توكن الـ Agent وأمر التثبيت."
          : "تم إضافة السيرفر. اتبع تعليمات الـ DNS لتفعيل الحماية.",
      );
    } catch (error) {
      if (isPrismaError(error, "P2002")) throw domainExistsError(false);
      throw error;
    }
  }

  async listServers(
    organizationId: string,
    query: ListServersQuery,
  ): Promise<ListServersResult> {
    const prisma = this.fastify.prisma;
    const where: Prisma.ServerWhereInput = { organizationId };

    if (query.status) where.status = query.status;
    if (query.mode) where.mode = query.mode;
    if (query.setupMode) where.setupMode = query.setupMode;
    if (query.dnsVerified !== undefined) where.dnsVerified = query.dnsVerified;
    if (query.tunnelUp !== undefined) where.tunnelUp = query.tunnelUp;
    if (query.search) {
      where.domain = { contains: query.search, mode: "insensitive" };
    }

    const skip = (query.page - 1) * query.limit;

    const [servers, total, grouped, groupedSetup] = await Promise.all([
      prisma.server.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: {
          [query.sortBy]: query.sortOrder,
        } as Prisma.ServerOrderByWithRelationInput,
      }),
      prisma.server.count({ where }),
      prisma.server.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
      prisma.server.groupBy({
        by: ["setupMode"],
        where: { organizationId },
        _count: { _all: true },
      }),
    ]);

    const summary: Record<ServerStatus, number> = {
      PENDING: 0,
      ONLINE: 0,
      DEGRADED: 0,
      OFFLINE: 0,
      MAINTENANCE: 0,
    };
    for (const row of grouped) {
      summary[row.status] = row._count._all;
    }

    const setupSummary: Record<ServerSetupMode, number> = {
      ORIGIN: 0,
      GUARD: 0,
    };
    for (const row of groupedSetup) {
      setupSummary[row.setupMode] = row._count._all;
    }

    const totalPages = Math.ceil(total / query.limit);

    return {
      servers,
      pagination: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
      summary,
      setupSummary,
    };
  }

  async getServerById(
    organizationId: string,
    serverId: string,
  ): Promise<Server> {
    return this.findOwned(organizationId, serverId);
  }

  /**
   * تعليمات DNS — ORIGIN فقط (GUARD → 409).
   * لو عايز رد يناسب الوضعين استخدم getSetupInstructions.
   */
  async getDnsInstructions(
    organizationId: string,
    serverId: string,
  ): Promise<ServerWithDns> {
    const server = await this.findOwned(organizationId, serverId);
    this.requireFeature(server, "DNS_INSTRUCTIONS");

    return { server, dns: buildDnsInstructions(server, readDnsConfig()) };
  }

  /**
   * خطوات الإعداد حسب وضع السيرفر (GET /servers/:id/setup):
   *   ORIGIN → dns | GUARD → guard (خطوات النفق)
   */
  async getSetupInstructions(
    organizationId: string,
    serverId: string,
  ): Promise<ServerWithSetup> {
    const server = await this.findOwned(organizationId, serverId);

    return this.buildSetupPayload(
      server,
      server.setupMode === "GUARD"
        ? "خطوات تفعيل الـ Guard (النفق)."
        : "تعليمات الـ DNS.",
    );
  }

  /**
   * تعديل سيرفر.
   *
   * - setupMode ما يتغيرش (resolveServerUpdate بيرفض لو مختلف)
   * - GUARD: حقول الأصل مرفوضة، وما فيش re-probe ولا تصفير أصل
   * - ORIGIN: نفس السلوك القديم (re-probe عند تغيير الأصل/الـ SSL)
   */
  async updateServer(
    organizationId: string,
    serverId: string,
    input: UpdateServerInput,
  ): Promise<UpdateServerResult> {
    const current = await this.findOwned(organizationId, serverId);

    // قواعد وضع الربط (setupMode immutable / origin fields / empty)
    let fields: ResolvedServerUpdate;
    try {
      fields = resolveServerUpdate(current, input);
    } catch (error) {
      throw translateSetupModeError(error);
    }

    const isOrigin = supportsFeature(current.setupMode, "ORIGIN_FIELDS");

    const changes: ServerChange[] = [];
    const track = <K extends ServerChange["field"]>(
      field: K,
      from: ServerChange["from"],
      to: ServerChange["to"] | undefined,
    ) => {
      if (to !== undefined && to !== from) changes.push({ field, from, to });
    };

    track("domain", current.domain, fields.domain);
    track("originIp", current.originIp, fields.originIp);
    track("originPort", current.originPort, fields.originPort);
    track("sslEnabled", current.sslEnabled, fields.sslEnabled);
    track("mode", current.mode, fields.mode);

    if (changes.length === 0) {
      return { server: current, changes, resets: [] };
    }

    const changed = new Set(changes.map((c) => c.field));
    const domainChanged = changed.has("domain");
    // حقول الأصل ما بتوصلش هنا لـ GUARD (اترفضت فوق)، والـ isOrigin حماية إضافية
    const originChanged =
      isOrigin && (changed.has("originIp") || changed.has("originPort"));
    const sslChanged = isOrigin && changed.has("sslEnabled");

    if (isOrigin && fields.originIp !== undefined && changed.has("originIp")) {
      this.assertOriginIsNotGateway(fields.originIp);
    }

    if (domainChanged && fields.domain) {
      const existing = await this.fastify.prisma.server.findUnique({
        where: { domain: fields.domain },
        select: { id: true, organizationId: true },
      });
      if (existing && existing.id !== serverId) {
        throw domainExistsError(existing.organizationId === organizationId);
      }
    }

    const data: Prisma.ServerUpdateInput = {};
    const resets: UpdateServerResult["resets"] = [];

    for (const change of changes) {
      (data as Record<string, unknown>)[change.field] = change.to;
    }

    // تغيير الدومين: DNS بيتصفّر لـ ORIGIN بس (Guard مالوش DNS/توجيه)
    if (domainChanged && isOrigin) {
      data.verificationToken = randomUUID();
      data.dnsVerified = false;
      data.dnsVerifiedAt = null;
      data.gatewayReachable = false;
      resets.push("dnsVerification");
    }

    // تغيير الأصل: تصفير قياسات الأصل لـ ORIGIN بس
    if (originChanged) {
      data.originReachable = false;
      data.avgResponseTimeMs = null;
      data.currentLoadPercent = null;
      data.maxRequestsPerSecond = null;
      data.safeRequestsPerSecond = null;
      data.p95ResponseTimeMs = null;
      data.loadLatencyP99Ms = null;
      data.probeErrorRate = null;
      data.probeConfidence = null;
      data.probeRecommendation = null;
      data.lastProbeAt = null;
      resets.push("originReachability");
    }

    // الحالة ترجع PENDING بس لو في إعادة ربط فعلية (ORIGIN)
    if (
      isOrigin &&
      (domainChanged || originChanged) &&
      current.status !== "MAINTENANCE"
    ) {
      data.status = "PENDING";
    }

    try {
      const server = await this.fastify.prisma.server.update({
        where: { id: serverId },
        data,
      });

      this.emitServerStatus(
        toRealtimePayload(server, "updated", current.status),
      );

      // re-probe: ORIGIN فقط (probeGateway نفسها بتتجاهل Guard كحماية إضافية)
      if (isOrigin && (originChanged || sslChanged)) {
        this.probeGateway(server, this.probeModeFor(server)).catch((err) =>
          this.fastify.log.warn({ err, serverId }, "Re-probe failed to start"),
        );
      }

      return {
        server,
        changes,
        resets,
        ...(domainChanged &&
          isOrigin && {
            dns: buildDnsInstructions(server, readDnsConfig()),
          }),
      };
    } catch (error) {
      if (isPrismaError(error, "P2002")) throw domainExistsError(false);
      if (isPrismaError(error, "P2025")) throw serverNotFound();
      throw error;
    }
  }

  async deleteServer(
    organizationId: string,
    serverId: string,
    confirmDomain: string,
  ): Promise<DeleteServerResult> {
    const server = await this.fastify.prisma.server.findFirst({
      where: { id: serverId, organizationId },
      include: { _count: { select: { securityEvents: true } } },
    });
    if (!server) throw serverNotFound();

    if (confirmDomain !== server.domain) {
      throw new ServerServiceError(
        "اسم الدومين المكتوب لا يطابق السيرفر المراد حذفه",
        400,
        "CONFIRMATION_MISMATCH",
      );
    }

    const deletedEvents = server._count.securityEvents;

    try {
      await this.fastify.prisma.server.delete({ where: { id: serverId } });
    } catch (error) {
      if (isPrismaError(error, "P2025")) throw serverNotFound();
      throw error;
    }

    verifyCooldown.delete(serverId);

    await this.safeNotify({
      organizationId,
      type: "SYSTEM",
      title: "تم حذف سيرفر محمي",
      message: `تم حذف السيرفر ${server.domain} مع ${deletedEvents} حدث أمني.`,
      severity: 2,
      metadata: {
        serverId,
        domain: server.domain,
        deletedEvents,
        setupMode: server.setupMode,
      },
    });

    this.emitServerStatus(toRealtimePayload(server, "deleted", server.status));

    return { id: serverId, domain: server.domain, deletedEvents };
  }

  // ================================================================
  // Dashboard: الصيانة
  // ================================================================

  async setMaintenance(
    organizationId: string,
    serverId: string,
    enabled: boolean,
  ): Promise<Server> {
    const server = await this.findOwned(organizationId, serverId);

    if (enabled && server.status === "MAINTENANCE") return server;
    if (!enabled && server.status !== "MAINTENANCE") return server;

    const updated = await this.fastify.prisma.server.update({
      where: { id: serverId },
      // الرجوع من الصيانة: الحالة بتتحسب من الطبقة الصح حسب وضع الربط
      data: { status: enabled ? "MAINTENANCE" : computeServerStatus(server) },
    });

    this.emitServerStatus(
      toRealtimePayload(updated, "status_changed", server.status),
    );

    return updated;
  }

  // ================================================================
  // Dashboard: فحص الـ DNS (ORIGIN فقط)
  // ================================================================

  /**
   * GUARD → مرفوض (409). تفعيل الحماية لـ Guard مش مربوط بـ dnsVerified
   * ولا بتوجيه CNAME/A، لأن النفق هو بديل التوجيه.
   */
  async verifyServer(
    organizationId: string,
    serverId: string,
    input: VerifyServerInput,
  ): Promise<DnsVerificationResult> {
    const server = await this.findOwned(organizationId, serverId);

    this.requireFeature(server, "DNS_VERIFY");

    const wantOwnership = input.step !== "routing";
    const wantRouting = input.step !== "ownership";
    const config = readDnsConfig();

    if (wantRouting && !config.cnameTarget && config.gatewayIps.length === 0) {
      throw new ServerServiceError(
        "إعدادات توجيه الـ Gateway غير مضبوطة في السيرفر (GATEWAY_CNAME_TARGET / GATEWAY_PUBLIC_IPS)",
        503,
        "DNS_CONFIG_MISSING",
      );
    }

    if (input.step === "routing" && !server.dnsVerified) {
      throw new ServerServiceError(
        "لازم تثبت ملكية الدومين الأول (step: ownership)",
        409,
        "OWNERSHIP_REQUIRED",
      );
    }

    const now = Date.now();
    const last = verifyCooldown.get(serverId);
    if (last !== undefined && now - last < VERIFY_COOLDOWN_MS) {
      const waitSec = Math.ceil((VERIFY_COOLDOWN_MS - (now - last)) / 1000);
      throw new ServerServiceError(
        `انتظر ${waitSec} ثانية قبل إعادة التحقق`,
        429,
        "VERIFY_TOO_FREQUENT",
        { retryAfterSec: waitSec },
      );
    }
    verifyCooldown.set(serverId, now);

    if (verifyCooldown.size > 1000) {
      for (const [id, time] of verifyCooldown) {
        if (now - time > 60_000) verifyCooldown.delete(id);
      }
    }

    const result: Pick<DnsVerificationResult, "ownership" | "routing"> = {};
    const patch: Prisma.ServerUpdateInput = {};
    let dnsVerified = server.dnsVerified;
    let gatewayReachable = server.gatewayReachable;

    if (wantOwnership) {
      const ownership = await this.checkOwnership(server);
      result.ownership = ownership;
      if (ownership.verified) {
        dnsVerified = true;
        if (!server.dnsVerified) {
          patch.dnsVerified = true;
          patch.dnsVerifiedAt = new Date();
        }
      }
    }

    if (wantRouting && dnsVerified) {
      const routing = await this.checkRouting(server, config);
      result.routing = routing;
      if (routing.verified && !server.gatewayReachable) {
        gatewayReachable = true;
        patch.gatewayReachable = true;
      }
    }

    let status = server.status;
    if (Object.keys(patch).length > 0) {
      if (server.status !== "MAINTENANCE") {
        // ORIGIN فقط هنا (الـ Guard مرفوض فوق) → طبقة الأورجن صريحة
        status = computeOriginStatus({
          gatewayReachable,
          originReachable: server.originReachable,
          avgResponseTimeMs: server.avgResponseTimeMs,
        });
        if (status !== server.status) patch.status = status;
      }

      const updated = await this.fastify.prisma.server.update({
        where: { id: serverId },
        data: patch,
      });

      this.emitServerStatus(
        toRealtimePayload(updated, "verified", server.status),
      );

      // أول ما الملكية تتثبت → full probe
      if (patch.dnsVerified === true) {
        this.probeGateway(updated, "full").catch((err) =>
          this.fastify.log.warn({ err, serverId }, "Full probe failed to start"),
        );
      }
    }

    return {
      ...result,
      server: { id: serverId, status, dnsVerified, gatewayReachable },
    };
  }

  private async checkOwnership(server: Server): Promise<DnsCheckResult> {
    const name = dnsTxtRecordName(server.domain);
    const expectedValue = dnsTxtRecordValue(server.verificationToken);
    const res = await lookup(() => this.resolver.resolveTxt(name));

    const found = res.ok
      ? res.value.map((chunks) => cleanTxt(chunks.join("")))
      : [];
    const verified = found.includes(expectedValue);

    const message = verified
      ? "تم التحقق من ملكية الدومين"
      : res.ok
        ? "سجل TXT موجود لكن قيمته لا تطابق القيمة المطلوبة"
        : res.notFound
          ? `سجل TXT غير موجود على ${name}. تأكد من إضافته (وقد يحتاج بضع دقائق للانتشار)`
          : "تعذر الاستعلام من الـ DNS الآن، حاول بعد قليل";

    return {
      verified,
      expected: [expectedValue],
      found,
      checkedAt: new Date().toISOString(),
      message,
    };
  }

  private async checkRouting(
    server: Server,
    config: DnsConfig,
  ): Promise<DnsCheckResult> {
    const [cnameRes, aRes] = await Promise.all([
      lookup(() => this.resolver.resolveCname(server.domain)),
      lookup(() => this.resolver.resolve4(server.domain)),
    ]);

    const cnames = cnameRes.ok ? cnameRes.value.map(cleanDnsName) : [];
    const addresses = aRes.ok ? aRes.value : [];

    const cnameOk =
      config.cnameTarget !== null && cnames.includes(config.cnameTarget);
    const aOk =
      config.gatewayIps.length > 0 &&
      addresses.length > 0 &&
      addresses.every((ip) => config.gatewayIps.includes(ip));

    const verified = cnameOk || aOk;
    const expected = [
      ...(config.cnameTarget ? [`CNAME ${config.cnameTarget}`] : []),
      ...config.gatewayIps.map((ip) => `A ${ip}`),
    ];
    const found = [
      ...cnames.map((c) => `CNAME ${c}`),
      ...addresses.map((ip) => `A ${ip}`),
    ];

    const dnsDown =
      (!cnameRes.ok && !cnameRes.notFound) || (!aRes.ok && !aRes.notFound);

    let message: string;
    if (verified) {
      message = "الدومين موجّه للـ Gateway. الترافيك هيعدي على الحماية";
    } else if (found.length === 0 && dnsDown) {
      message = "تعذر الاستعلام من الـ DNS الآن، حاول بعد قليل";
    } else if (found.length === 0) {
      message = "لا توجد سجلات توجيه (A/CNAME) للدومين";
    } else if (
      addresses.some((ip) => config.gatewayIps.includes(ip)) &&
      addresses.some((ip) => !config.gatewayIps.includes(ip))
    ) {
      message =
        "فيه سجلات A قديمة جنب سجلات الـ Gateway. احذف القديمة وإلا جزء من الترافيك هيتخطى الحماية";
    } else {
      message =
        "الدومين لا يشاور على الـ Gateway. لو بتستخدم CDN/Proxy قدامنا فده طبيعي، والـ Gateway هيأكد لما أول ترافيك يوصل";
    }

    return {
      verified,
      expected,
      found,
      checkedAt: new Date().toISOString(),
      message,
    };
  }

  // ================================================================
  // Gateway
  // ================================================================

  /**
   * مزامنة كل السيرفرات للـ Gateway (ORIGIN + GUARD).
   * كل عنصر فيه setupMode + حالة النفق، وlastAgentAt، وoriginIp = null لـ Guard.
   */
  async listForGateway(
    query: GatewayServersQuery,
  ): Promise<GatewayServersListResult> {
    const serverTime = new Date().toISOString();
    const where: Prisma.ServerWhereInput = {
      organization: { isActive: true },
      ...(query.updatedSince && {
        updatedAt: { gt: new Date(query.updatedSince) },
      }),
    };

    const rows = await this.fastify.prisma.server.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      servers: page.map(toGatewayPayload),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      serverTime,
    };
  }

  async resolveForGateway(rawHost: string): Promise<GatewayServerPayload> {
    const host = normalizeHostHeader(rawHost);
    if (!host) {
      throw new ServerServiceError("host غير صالح", 400, "INVALID_HOST");
    }

    const server = await this.fastify.prisma.server.findUnique({
      where: { domain: host },
      include: { organization: { select: { isActive: true } } },
    });

    if (!server) {
      throw new ServerServiceError(
        "لا يوجد سيرفر محمي بهذا الدومين",
        404,
        "SERVER_NOT_FOUND",
      );
    }

    if (!server.organization.isActive) {
      throw new ServerServiceError(
        "المؤسسة المالكة لهذا السيرفر غير مفعّلة",
        403,
        "ORGANIZATION_INACTIVE",
      );
    }

    return toGatewayPayload(server);
  }

  /**
   * تقرير صحة / نتائج Probe من الـ Gateway.
   *
   * - GUARD: التقرير بيتنضف من حقول الأصل/الـ Probe (sanitize) قبل التخزين،
   *   وبيتحسب الحالة من طبقة الـ Guard (tunnelUp + نبضة) مش من originReachable.
   *   لو التقرير بعد التنظيف فاضي → بيتتجاهل من غير خطأ.
   * - ORIGIN: السلوك القديم بالكامل.
   */
  async reportHealth(
    serverId: string,
    rawReport: GatewayHealthReport,
  ): Promise<HealthReportResult> {
    const txResult = await this.fastify.prisma.$transaction(async (tx) => {
      const server = await tx.server.findUnique({ where: { id: serverId } });
      if (!server) throw serverNotFound();

      // تنظيف حسب وضع الربط (Guard مالوش أصل ولا Probe)
      const report = sanitizeHealthReportForSetupMode(
        server.setupMode,
        rawReport,
      );

      if (!hasHealthValues(report)) {
        return {
          skipped: true as const,
          id: serverId,
          status: server.status,
        };
      }

      const gatewayReachable =
        report.gatewayReachable ?? server.gatewayReachable;
      const originReachable = report.originReachable ?? server.originReachable;
      const avgResponseTimeMs =
        report.avgResponseTimeMs ?? server.avgResponseTimeMs;
      const currentLoadPercent =
        report.currentLoadPercent ?? server.currentLoadPercent;

      const nextStatus: ServerStatus =
        server.status === "MAINTENANCE"
          ? "MAINTENANCE"
          : computeServerStatus({
              setupMode: server.setupMode,
              gatewayReachable,
              originReachable,
              avgResponseTimeMs,
              tunnelUp: server.tunnelUp,
              lastAgentAt: server.lastAgentAt,
            });

      const updated = await tx.server.update({
        where: { id: serverId },
        data: {
          lastHealthCheckAt: new Date(),
          status: nextStatus,
          ...(report.originReachable !== undefined && { originReachable }),
          ...(report.gatewayReachable !== undefined && { gatewayReachable }),
          ...(report.avgResponseTimeMs !== undefined && { avgResponseTimeMs }),
          ...(report.currentLoadPercent !== undefined && {
            currentLoadPercent,
          }),
          ...(report.p95ResponseTimeMs !== undefined && {
            p95ResponseTimeMs: report.p95ResponseTimeMs,
          }),
          ...(report.loadLatencyP99Ms !== undefined && {
            loadLatencyP99Ms: report.loadLatencyP99Ms,
          }),
          ...(report.maxRequestsPerSecond !== undefined && {
            maxRequestsPerSecond: report.maxRequestsPerSecond,
          }),
          ...(report.safeRequestsPerSecond !== undefined && {
            safeRequestsPerSecond: report.safeRequestsPerSecond,
          }),
          ...(report.probeErrorRate !== undefined && {
            probeErrorRate: report.probeErrorRate,
          }),
          ...(report.probeConfidence !== undefined && {
            probeConfidence: report.probeConfidence,
          }),
          ...(report.probeRecommendation !== undefined && {
            probeRecommendation: report.probeRecommendation,
            lastProbeAt: new Date(),
          }),
        },
      });

      if (report.probeRecommendation !== undefined) {
        await tx.serverProbeRun.create({
          data: {
            serverId,
            maxRps: report.maxRequestsPerSecond ?? null,
            safeRps: report.safeRequestsPerSecond ?? null,
            p95Ms: report.p95ResponseTimeMs ?? null,
            p99LoadMs: report.loadLatencyP99Ms ?? null,
            errorRate: report.probeErrorRate ?? null,
            confidence: report.probeConfidence ?? null,
            recommendation: report.probeRecommendation,
            details: report.probeDetails as Prisma.InputJsonValue | undefined,
          },
        });
      }

      // تنبيه السعة: نحسبه جوه الـ transaction ونبعته بعدها
      let capacityWarning: { load: number; warnAt: number } | null = null;

      if (report.currentLoadPercent !== undefined) {
        const policy = await tx.policy.findUnique({
          where: { organizationId: server.organizationId },
          select: { capacityWarnPercent: true },
        });
        const warnAt =
          policy?.capacityWarnPercent ?? DEFAULT_CAPACITY_WARN_PERCENT;
        const wasBelow =
          server.currentLoadPercent === null ||
          server.currentLoadPercent < warnAt;
        if (wasBelow && report.currentLoadPercent >= warnAt) {
          capacityWarning = { load: report.currentLoadPercent, warnAt };
        }
      }

      return {
        skipped: false as const,
        id: serverId,
        status: nextStatus,
        previousStatus: server.status,
        updated,
        report,
        setupMode: server.setupMode,
        statusChanged: nextStatus !== server.status,
        capacityWarning,
      };
    });

    // تقرير فاضي بعد التنظيف (مثلًا Guard بيبعت حقول أصل بس): نتجاهله
    if (txResult.skipped) {
      return {
        id: txResult.id,
        status: txResult.status,
        previousStatus: txResult.status,
      };
    }

    const result = txResult;
    const { report } = result;

    if (result.statusChanged || report.probeRecommendation !== undefined) {
      this.emitServerStatus(
        toRealtimePayload(
          result.updated,
          result.statusChanged ? "status_changed" : "updated",
          result.previousStatus,
        ),
      );
    }

    const domain = result.updated.domain;
    const organizationId = result.updated.organizationId;
    const isGuard = result.setupMode === "GUARD";

    if (result.status === "OFFLINE" && result.previousStatus !== "OFFLINE") {
      await this.safeNotify({
        organizationId,
        type: "SYSTEM",
        title: "السيرفر لا يستجيب",
        message: isGuard
          ? `السيرفر ${domain} لا يستجيب، تأكد من أن الـ Agent شغال والنفق متصل.`
          : `السيرفر ${domain} لا يستجيب، تأكد من أن الـ Origin شغال.`,
        severity: 4,
        metadata: {
          serverId,
          domain,
          setupMode: result.setupMode,
          lastError: report.lastError ?? null,
        },
      });
    }

    if (
      result.previousStatus === "OFFLINE" &&
      (result.status === "ONLINE" || result.status === "DEGRADED")
    ) {
      await this.safeNotify({
        organizationId,
        type: "SERVER_RECOVERY",
        title: "السيرفر رجع يعمل",
        message: `السيرفر ${domain} رجع يستجيب من جديد.`,
        severity: 1,
        metadata: {
          serverId,
          domain,
          setupMode: result.setupMode,
          status: result.status,
        },
      });
    }

    if (result.capacityWarning) {
      await this.safeNotify({
        organizationId,
        type: "SERVER_CAPACITY_WARNING",
        title: "السيرفر قرّب يوصل لحد السعة",
        message: `حمل السيرفر ${domain} وصل ${Math.round(
          result.capacityWarning.load,
        )}% (حد التنبيه ${result.capacityWarning.warnAt}%).`,
        severity: 3,
        metadata: {
          serverId,
          domain,
          setupMode: result.setupMode,
          currentLoadPercent: result.capacityWarning.load,
          warnAt: result.capacityWarning.warnAt,
        },
      });
    }

    return {
      id: result.id,
      status: result.status,
      previousStatus: result.previousStatus,
    };
  }
}