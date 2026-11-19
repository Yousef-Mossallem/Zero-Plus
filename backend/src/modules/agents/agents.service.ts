/**
 * backend/src/modules/agents/agents.service.ts
 * ==================================================================
 * Zero Plus - Agent Service
 *
 * المسؤوليات:
 *   1) تفعيل النفق على سيرفر Guard (enable-tunnel)
 *      - توليد AGENT_TOKEN آمن
 *      - حفظ hash في DB (+ التوكن الخام اختياريًا للتطوير)
 *      - بناء أمر التثبيت من متغيرات البيئة
 *      - ما بيلمسش أي حقل DNS / أورجن (originIp / dnsVerified / probe ...)
 *
 *   2) استقبال Heartbeat من الـ Agent
 *      - التحقق من التوكن
 *      - تحديث حقول الـ Agent فقط (tunnelUp / lastAgentAt / مقاييس / agentOriginOk ...)
 *      - GUARD  : بيحدّث status من طبقة الـ Guard (computeGuardStatus: نفق + نبضة حديثة)
 *      - ORIGIN : ما بيكتبش status ولا حقول السعة أبدًا (مسار الأورجن بتاع الـ Probe
 *                 هو مصدر الحقيقة، والنفق ما يكتبش عليه ONLINE بالغلط)
 *      - تسجيل صف في AgentHeartbeat (مع تنظيف دوري للقديم)
 *
 *   3) حالة الـ Agent + آخر النبضات (للداشبورد)
 *   4) تدوير / إبطال التوكن (disableAgent ما بيمسحش سيرفر ولا بيشغّل probe)
 *   5) Sweeper اختياري: يعلّم سيرفرات Guard اللي الـ Agent بتاعها سكت (من غير نبضة)
 *      OFFLINE ويبث للداشبورد (sweepStaleAgents / startAgentSweeper)
 *
 * وضع الربط (setupMode) — مصدره servers.schema.ts:
 *   - enable-tunnel / rotate : GUARD فقط (ORIGIN → 409 FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE)
 *   - heartbeat              : مقبول من الاتنين (Agent قديم على سيرفر Origin ما يتكسرش)،
 *                              لكن status/السعة بتتكتب لـ GUARD بس
 *   - disable / status / history : متاحين للاتنين (تنضيف توكن قديم مثلًا)
 *
 * الأمان:
 *   - التوكن يُولَّد عشوائيًا (base64url) ويُعرض مرة واحدة عند التفعيل/التدوير
 *   - في DB: agentTokenHash (sha256) للتحقق السريع
 *   - agentToken الخام يُحفظ فقط لو AGENT_STORE_RAW_TOKEN=true (للتطوير)
 *
 * أخطاء الـ service: Error رسالته = الكود (زي ما الراوت متعود)، وفيها
 * statusCode و code كمان (لو الراوت ما يعرفش الكود، Fastify هيستخدم الـ statusCode).
 *
 * أمر التثبيت:
 *   كل الروابط والقوالب من env — غيّر الإصدار/المستودع بدون تعديل كود
 * ==================================================================
 */

import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes } from 'crypto'
import type {
  AgentOs,
  Prisma,
  Server,
  ServerStatus,
} from '@prisma/client'

import { SocketEvents } from '../../plugins/socket.plugin.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { computeGuardStatus } from '../servers/servers.service.js'
import type { ServerRealtimePayload } from '../servers/servers.service.js'
import { supportsFeature } from '../servers/servers.schema.js'
import type {
  EnableTunnelInput,
  AgentHeartbeatInput,
  ListHeartbeatsQuery,
  DisableAgentInput,
  InstallCommandPayload,
  AgentStatusSnapshot,
} from './agents.schema.js'

// ------------------------------------------------------------------
// Config من البيئة
// ------------------------------------------------------------------

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** طول التوكن بالبايت قبل الترميز (32 = 43 حرف base64url تقريبًا) */
const TOKEN_BYTES = Math.max(16, Math.floor(envNumber('AGENT_TOKEN_BYTES', 32)))

/**
 * نافذة «الـ Agent حي» بالثواني (بعدها isFresh = false).
 * وبتستخدمها الـ sweeper كحد لاعتبار الـ Guard OFFLINE.
 * (الافتراضي 120 — نفس افتراضي GUARD_HEARTBEAT_STALE_SEC في servers.service)
 */
const AGENT_FRESH_WINDOW_SEC = envNumber('AGENT_FRESH_WINDOW_SEC', 120)

/** تلميح الفاصل بين النبضات للـ Agent */
const HEARTBEAT_INTERVAL_SEC = Math.max(
  5,
  Math.floor(envNumber('AGENT_HEARTBEAT_INTERVAL_SEC', 30)),
)

/** مدة الاحتفاظ بتاريخ النبضات بالأيام (0 = لا تنظيف) */
const HEARTBEAT_RETENTION_DAYS = Math.max(
  0,
  envNumber('AGENT_HEARTBEAT_RETENTION_DAYS', 14),
)
/** أقل فاصل بين تنظيفين لنفس السيرفر */
const HEARTBEAT_PRUNE_INTERVAL_MS = 60 * 60 * 1000

/** فاصل الـ sweeper بالثواني (0 = متوقف) */
const SWEEP_INTERVAL_SEC = Math.max(0, envNumber('AGENT_SWEEP_INTERVAL_SEC', 30))
const SWEEP_BATCH = 200

/**
 * هل نخزّن التوكن الخام في DB؟
 * الإنتاج: false (hash فقط)
 * التطوير: true لو حابب تشوف التوكن من DB
 */
const STORE_RAW_TOKEN =
  process.env.AGENT_STORE_RAW_TOKEN === '1' ||
  process.env.AGENT_STORE_RAW_TOKEN === 'true'

// ---- قوالب أمر التثبيت (كل شيء قابل للتغيير من env) ----

const DEFAULT_RELEASE_BASE =
  'https://github.com/zero-plus-hq/zero-plus-agent/releases/latest/download'

function trimSlash(value: string | undefined): string | undefined {
  const v = value?.trim()
  if (!v) return undefined
  return v.replace(/\/$/, '')
}

/**
 * رابط سكربت التثبيت (one-liner)
 * مثال GitHub Release:
 *   https://github.com/ORG/zero-plus-agent/releases/latest/download/install.sh
 * أو سيرفرك:
 *   https://downloads.zero-plus.site/agent/install.sh
 */
function getInstallScriptUrl(): string {
  const explicit = process.env.AGENT_INSTALL_SCRIPT_URL?.trim()
  if (explicit) return explicit

  const base = trimSlash(process.env.AGENT_DOWNLOAD_BASE_URL)
  if (base) return `${base}/install.sh`

  return `${DEFAULT_RELEASE_BASE}/install.sh`
}

/**
 * رابط صورة Docker
 * مثال: ghcr.io/ORG/zero-plus-agent:latest
 */
function getDockerImage(): string {
  return (
    process.env.AGENT_DOCKER_IMAGE?.trim() ||
    'ghcr.io/zero-plus-hq/zero-plus-agent:latest'
  )
}

/**
 * رابط تحميل الباينري (بدون اسم الملف — نكمّل os/arch)
 * الملفات المتوقعة: zero-plus-agent-linux-amd64.tar.gz ...
 */
function getBinaryBaseUrl(): string {
  return (
    trimSlash(process.env.AGENT_BINARY_BASE_URL) ||
    trimSlash(process.env.AGENT_DOWNLOAD_BASE_URL) ||
    DEFAULT_RELEASE_BASE
  )
}

/** اسم الباينري داخل الأرشيف */
function getBinaryName(): string {
  return process.env.AGENT_BINARY_NAME?.trim() || 'zero-plus-agent'
}

/**
 * عنوان بوابة الـ Gateway / API اللي الـ Agent هيتكلم معاها
 * مثال: https://api.zero-plus.site  أو  https://gw.zero-plus.site
 */
function getAgentApiBaseUrl(): string {
  return (
    trimSlash(process.env.AGENT_API_BASE_URL) ||
    trimSlash(process.env.GATEWAY_PUBLIC_URL) ||
    trimSlash(process.env.APP_URL) ||
    'http://127.0.0.1:3000'
  )
}

/**
 * مسار الـ heartbeat النسبي (الـ Agent يركّبه على API base)
 * افتراضي: /internal/agent/heartbeat
 */
function getHeartbeatPath(): string {
  return (
    process.env.AGENT_HEARTBEAT_PATH?.trim() || '/internal/agent/heartbeat'
  )
}

/** رابط وثائق التثبيت (اختياري في الرد) */
function getAgentDocsUrl(): string | undefined {
  const u = process.env.AGENT_DOCS_URL?.trim()
  return u || undefined
}

/**
 * قالب أمر مخصص بالكامل (أعلى أولوية لو موجود)
 * يدعم placeholders:
 *   {{TOKEN}} {{API_URL}} {{SERVER_ID}} {{DOMAIN}} {{HEARTBEAT_PATH}}
 *   {{SCRIPT_URL}} {{DOCKER_IMAGE}} {{BINARY_BASE}} {{BINARY_NAME}}
 */
function getCustomInstallTemplate(
  channel: 'script' | 'docker' | 'binary',
): string | undefined {
  const key =
    channel === 'script'
      ? 'AGENT_INSTALL_CMD_SCRIPT'
      : channel === 'docker'
        ? 'AGENT_INSTALL_CMD_DOCKER'
        : 'AGENT_INSTALL_CMD_BINARY'
  const v = process.env[key]?.trim()
  return v || undefined
}

// ------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------

/**
 * message = الكود (الراوت بيعمل ERROR_MAP على الرسالة).
 * statusCode: لو الراوت ما يعرفش الكود، Fastify هيستخدمه بدل 500.
 */
export class AgentServiceError extends Error {
  public readonly code: string
  public readonly statusCode: number

  constructor(code: string, statusCode: number) {
    super(code)
    this.name = 'AgentServiceError'
    this.code = code
    this.statusCode = statusCode
  }
}

/** enable-tunnel / rotate: GUARD فقط (AGENT_TUNNEL في servers.schema) */
function assertAgentTunnelAllowed(server: Pick<Server, 'setupMode'>): void {
  if (!supportsFeature(server.setupMode, 'AGENT_TUNNEL')) {
    throw new AgentServiceError('FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE', 409)
  }
}

// ------------------------------------------------------------------
// Helpers — توكن
// ------------------------------------------------------------------

function generateAgentToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

// ------------------------------------------------------------------
// Helpers — أرقام آمنة
// ------------------------------------------------------------------

function clampPercent(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(100, Math.max(0, value))
}

function positiveInt(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return Math.round(value)
}

// ------------------------------------------------------------------
// Helpers — Socket + إشعارات (نفس عقد servers.service)
// ------------------------------------------------------------------

type Broadcaster = (
  organizationId: string,
  event: string,
  payload: unknown,
) => void

function toRealtimePayload(
  s: Server,
  action: ServerRealtimePayload['action'],
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
    updatedAt: s.updatedAt.toISOString(),
  }
}

function emitServerStatus(
  fastify: FastifyInstance,
  server: Server,
  action: ServerRealtimePayload['action'],
  previousStatus?: ServerStatus,
): void {
  try {
    const broadcast = (fastify as unknown as { broadcastToOrg?: Broadcaster })
      .broadcastToOrg

    if (typeof broadcast === 'function') {
      broadcast.call(
        fastify,
        server.organizationId,
        SocketEvents.SERVER_STATUS,
        toRealtimePayload(server, action, previousStatus),
      )
    }
  } catch (err) {
    fastify.log.warn(
      { err, serverId: server.id },
      'Failed to broadcast server:status (agents)',
    )
  }
}

/** الإشعار ما يفشلش العملية الأساسية */
async function safeNotify(
  fastify: FastifyInstance,
  input: Parameters<NotificationsService['create']>[0],
): Promise<void> {
  try {
    await new NotificationsService(fastify).create(input)
  } catch (err) {
    fastify.log.warn({ err }, 'Failed to create notification (agents)')
  }
}

/**
 * إشعارات تغيّر حالة سيرفر Guard (الأورجن بيتعامل معاه reportHealth في servers.service).
 *   - OFFLINE بعد ما كان شغال        → تنبيه
 *   - رجوع من OFFLINE               → SERVER_RECOVERY
 *   - أول اتصال (PENDING → شغال)    → إشعار تفعيل
 */
async function notifyGuardTransition(
  fastify: FastifyInstance,
  server: Pick<Server, 'id' | 'organizationId' | 'domain'>,
  previous: ServerStatus,
  next: ServerStatus,
): Promise<void> {
  if (previous === next) return

  const base = { organizationId: server.organizationId }
  const meta = {
    serverId: server.id,
    domain: server.domain,
    setupMode: 'GUARD' as const,
  }

  if (
    next === 'OFFLINE' &&
    (previous === 'ONLINE' || previous === 'DEGRADED')
  ) {
    await safeNotify(fastify, {
      ...base,
      type: 'SYSTEM',
      title: 'السيرفر لا يستجيب',
      message: `السيرفر ${server.domain} لا يستجيب، تأكد من أن الـ Agent شغال والنفق متصل.`,
      severity: 4,
      metadata: { ...meta, status: next },
    })
    return
  }

  if (previous === 'OFFLINE' && (next === 'ONLINE' || next === 'DEGRADED')) {
    await safeNotify(fastify, {
      ...base,
      type: 'SERVER_RECOVERY',
      title: 'السيرفر رجع يعمل',
      message: `السيرفر ${server.domain} رجع يستجيب من جديد.`,
      severity: 1,
      metadata: { ...meta, status: next },
    })
    return
  }

  if (previous === 'PENDING' && (next === 'ONLINE' || next === 'DEGRADED')) {
    await safeNotify(fastify, {
      ...base,
      type: 'SYSTEM',
      title: 'تم تفعيل الـ Guard',
      message: `الـ Agent اتصل بنجاح والنفق شغال للسيرفر ${server.domain}.`,
      severity: 1,
      metadata: { ...meta, status: next },
    })
  }
}

// ------------------------------------------------------------------
// Helpers — صلاحية المستدعي على السيرفر
// ------------------------------------------------------------------

async function getActorServer(
  fastify: FastifyInstance,
  actorUserId: string,
  serverId: string,
) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: actorUserId },
    select: {
      id: true,
      organizationId: true,
      isActive: true,
      role: true,
    },
  })
  if (!user || !user.isActive) {
    throw new AgentServiceError('USER_NOT_FOUND', 401)
  }

  const server = await fastify.prisma.server.findFirst({
    where: {
      id: serverId,
      organizationId: user.organizationId,
    },
    select: {
      id: true,
      domain: true,
      originIp: true,
      organizationId: true,
      setupMode: true,
      status: true,
      avgResponseTimeMs: true,
      agentToken: true,
      agentTokenHash: true,
      agentVersion: true,
      agentOs: true,
      agentArch: true,
      lastAgentAt: true,
      tunnelUp: true,
      tunnelPeerIp: true,
      agentCpuPercent: true,
      agentRamPercent: true,
      agentDiskPercent: true,
      agentLoadAvg1m: true,
      estimatedMaxRps: true,
      agentOriginOk: true,
      agentOriginLatMs: true,
    },
  })

  if (!server) {
    throw new AgentServiceError('SERVER_NOT_FOUND', 404)
  }

  return { user, server }
}

// ------------------------------------------------------------------
// بناء أمر التثبيت
// ------------------------------------------------------------------

function applyTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template
  for (const [k, v] of Object.entries(vars)) {
    // replacer function: عشان رموز $ في القيمة ما تتفسرش كـ pattern
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), () => v)
  }
  return out
}

function buildInstallCommand(params: {
  channel: 'script' | 'docker' | 'binary'
  token: string
  serverId: string
  domain?: string | null
  preferOs?: string
  preferArch?: string
}): InstallCommandPayload {
  const apiUrl = getAgentApiBaseUrl()
  const heartbeatPath = getHeartbeatPath()
  const scriptUrl = getInstallScriptUrl()
  const dockerImage = getDockerImage()
  const binaryBase = getBinaryBaseUrl()
  const binaryName = getBinaryName()

  const vars: Record<string, string> = {
    TOKEN: params.token,
    API_URL: apiUrl,
    SERVER_ID: params.serverId,
    DOMAIN: params.domain || '',
    HEARTBEAT_PATH: heartbeatPath,
    SCRIPT_URL: scriptUrl,
    DOCKER_IMAGE: dockerImage,
    BINARY_BASE: binaryBase,
    BINARY_NAME: binaryName,
  }

  const custom = getCustomInstallTemplate(params.channel)
  let command: string

  if (custom) {
    command = applyTemplate(custom, vars)
  } else if (params.channel === 'docker') {
    // أمر Docker افتراضي — متغيرات من env
    command = applyTemplate(
      [
        `docker run -d --name zero-plus-agent --restart unless-stopped`,
        `--cap-add=NET_ADMIN --device /dev/net/tun`,
        `-e AGENT_TOKEN="{{TOKEN}}"`,
        `-e AGENT_API_URL="{{API_URL}}"`,
        `-e AGENT_SERVER_ID="{{SERVER_ID}}"`,
        `"{{DOCKER_IMAGE}}"`,
      ].join(' '),
      vars,
    )
  } else if (params.channel === 'binary') {
    const os =
      (params.preferOs || 'LINUX').toLowerCase() === 'windows'
        ? 'windows'
        : 'linux'
    const archRaw = (params.preferArch || 'amd64').toLowerCase()
    const arch =
      archRaw === 'aarch64' || archRaw === 'arm64' ? 'arm64' : 'amd64'
    const archive = `${binaryName}-${os}-${arch}.tar.gz`

    command = applyTemplate(
      [
        `curl -fsSL "${binaryBase}/${archive}" -o /tmp/${archive}`,
        `tar -xzf /tmp/${archive} -C /usr/local/bin`,
        `chmod +x /usr/local/bin/${binaryName}`,
        `AGENT_TOKEN="{{TOKEN}}" AGENT_API_URL="{{API_URL}}" AGENT_SERVER_ID="{{SERVER_ID}}" ${binaryName} install`,
      ].join(' && '),
      vars,
    )
  } else {
    // script — one-liner شائع
    command = applyTemplate(
      `curl -fsSL "{{SCRIPT_URL}}" | AGENT_TOKEN="{{TOKEN}}" AGENT_API_URL="{{API_URL}}" AGENT_SERVER_ID="{{SERVER_ID}}" bash`,
      vars,
    )
  }

  return {
    channel: params.channel,
    command,
    agentToken: params.token,
    tokenHint:
      'يظهر هذا التوكن مرة واحدة. احفظ الأمر كاملًا. إعادة التفعيل مع rotateToken تولّد توكنًا جديدًا.',
    serverId: params.serverId,
    domain: params.domain || undefined,
    docsUrl: getAgentDocsUrl(),
  }
}

// ==================================================================
// 1) Enable Tunnel
// ==================================================================

/**
 * يولّد (أو يعيد استخدام) توكن الـ Agent ويرجّع أمر التثبيت.
 *
 * - GUARD فقط (ORIGIN → 409 FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE)
 * - بيكتب حقول الـ Agent فقط (agentToken / agentTokenHash / tunnelUp / lastAgentAt)
 *   وstatus لسيرفر Guard عند التدوير. ما بيلمسش DNS ولا الأورجن ولا الـ Probe.
 */
export async function enableTunnel(
  fastify: FastifyInstance,
  actorUserId: string,
  serverId: string,
  input: EnableTunnelInput = {
    rotateToken: false,
    installChannel: 'script',
  },
) {
  const { server } = await getActorServer(fastify, actorUserId, serverId)

  assertAgentTunnelAllowed(server)

  const shouldRotate = input.rotateToken === true
  const hasExisting =
    !!server.agentTokenHash || !!(STORE_RAW_TOKEN && server.agentToken)

  let plainToken: string | null = null

  if (shouldRotate || !hasExisting) {
    plainToken = generateAgentToken()
    const tokenHash = hashToken(plainToken)

    const data: Prisma.ServerUpdateInput = {
      agentTokenHash: tokenHash,
      agentToken: STORE_RAW_TOKEN ? plainToken : null,
    }

    if (shouldRotate) {
      // توكن جديد = Agent جديد: النفق لسه مش Up وماحدش اتصل
      data.tunnelUp = false
      data.lastAgentAt = null
      // الحالة ترجع PENDING (عمره ما بعت نبضة) إلا لو في صيانة
      if (server.status !== 'MAINTENANCE') data.status = 'PENDING'
    }

    const updated = await fastify.prisma.server.update({
      where: { id: server.id },
      data,
    })

    if (updated.status !== server.status || server.tunnelUp) {
      emitServerStatus(fastify, updated, 'updated', server.status)
    }
  } else if (STORE_RAW_TOKEN && server.agentToken) {
    // تطوير: نعيد نفس التوكن الخام لو مخزّن
    plainToken = server.agentToken
  } else {
    // الإنتاج بدون raw: لازم rotate عشان تشوف التوكن تاني
    throw new AgentServiceError('AGENT_TOKEN_ALREADY_ISSUED', 409)
  }

  if (!plainToken) {
    throw new AgentServiceError('AGENT_TOKEN_ALREADY_ISSUED', 409)
  }

  const install = buildInstallCommand({
    channel: input.installChannel ?? 'script',
    token: plainToken,
    serverId: server.id,
    domain: server.domain,
    preferOs: input.preferOs,
    preferArch: input.preferArch,
  })

  return {
    serverId: server.id,
    domain: server.domain,
    rotated: shouldRotate || !hasExisting,
    install,
  }
}

// ==================================================================
// 2) Heartbeat (من الـ Agent — مصادقة بالتوكن)
// ==================================================================

/**
 * يستخرج التوكن من الهيدر
 * يدعم: Authorization: Bearer <token>  |  X-Agent-Token: <token>
 */
export function extractAgentToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const x = headers['x-agent-token']
  if (typeof x === 'string' && x.trim()) return x.trim()
  if (Array.isArray(x) && x[0]) return String(x[0]).trim()

  const auth = headers['authorization']
  const raw = Array.isArray(auth) ? auth[0] : auth
  if (!raw || typeof raw !== 'string') return null
  const [scheme, token] = raw.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null
  return token.trim() || null
}

/**
 * يتحقق من التوكن ويُرجع السيرفر (بحقول الفصل بين Guard/Origin)
 */
async function resolveServerByAgentToken(
  fastify: FastifyInstance,
  plainToken: string,
) {
  if (!plainToken) throw new AgentServiceError('INVALID_AGENT_TOKEN', 401)

  const tokenHash = hashToken(plainToken)

  const server = await fastify.prisma.server.findFirst({
    where: {
      OR: [
        { agentTokenHash: tokenHash },
        ...(STORE_RAW_TOKEN ? [{ agentToken: plainToken }] : []),
      ],
    },
    select: {
      id: true,
      domain: true,
      organizationId: true,
      setupMode: true,
      status: true,
      tunnelUp: true,
      avgResponseTimeMs: true,
      agentTokenHash: true,
    },
  })

  if (!server) {
    throw new AgentServiceError('INVALID_AGENT_TOKEN', 401)
  }

  return server
}

/** آخر وقت تنظيف لكل سيرفر (في الذاكرة) */
const lastHeartbeatPrune = new Map<string, number>()

/** تنظيف النبضات القديمة (مرة في الساعة لكل سيرفر، في الخلفية) */
function maybePruneHeartbeats(fastify: FastifyInstance, serverId: string): void {
  if (HEARTBEAT_RETENTION_DAYS <= 0) return

  const now = Date.now()
  const last = lastHeartbeatPrune.get(serverId) ?? 0
  if (now - last < HEARTBEAT_PRUNE_INTERVAL_MS) return

  lastHeartbeatPrune.set(serverId, now)
  if (lastHeartbeatPrune.size > 5000) {
    const first = lastHeartbeatPrune.keys().next()
    if (!first.done) lastHeartbeatPrune.delete(first.value)
  }

  const cutoff = new Date(now - HEARTBEAT_RETENTION_DAYS * 86_400_000)

  fastify.prisma.agentHeartbeat
    .deleteMany({ where: { serverId, createdAt: { lt: cutoff } } })
    .catch((err: unknown) =>
      fastify.log.warn({ err, serverId }, 'Heartbeat prune failed'),
    )
}

/**
 * معالجة نبضة واحدة:
 *
 * الفصل بين المسارين:
 *   - دايمًا: حقول الـ Agent فقط (tunnelUp / lastAgentAt / مقاييس / agentOriginOk ...)
 *   - GUARD : status من computeGuardStatus (نفق + نبضة حديثة)، وsafeRequestsPerSecond
 *             من تقدير الـ Agent. لو الـ Agent بلّغ إن الأصل المحلي واقع → DEGRADED.
 *   - ORIGIN: ما بيكتبش status ولا أي حقل سعة/Probe. النفق ما يرفعش ONLINE على سيرفر
 *             Origin ولا يخطف نتائج قياسه.
 *   - الصيانة (MAINTENANCE) ما بتتغيرش من نبضة أبدًا.
 */
export async function processHeartbeat(
  fastify: FastifyInstance,
  plainToken: string,
  body: AgentHeartbeatInput,
) {
  const server = await resolveServerByAgentToken(fastify, plainToken)

  const now = new Date()
  const isGuard = server.setupMode === 'GUARD'
  const tunnelUp = body.tunnelUp ?? false

  const agentOs = (body.agentOs ?? undefined) as AgentOs | undefined

  // ---- status (GUARD فقط، وبشرط نفق/نبضة) ----
  let nextStatus: ServerStatus | undefined
  if (isGuard && server.status !== 'MAINTENANCE') {
    nextStatus = computeGuardStatus({
      tunnelUp,
      lastAgentAt: now,
      avgResponseTimeMs: server.avgResponseTimeMs ?? body.originLatMs ?? null,
    })
    // النفق سليم لكن الـ Agent بيقول إن التطبيق المحلي واقع
    if (nextStatus === 'ONLINE' && body.originOk === false) {
      nextStatus = 'DEGRADED'
    }
  }

  // ---- سعة Guard من تقدير الـ Agent (ORIGIN: لأ، سعته من الـ Probe) ----
  const suggestedRps = positiveInt(body.suggestedMaxRps)

  const [updated, heartbeat] = await fastify.prisma.$transaction([
    fastify.prisma.server.update({
      where: { id: server.id },
      data: {
        // —— حقول الـ Agent (للاتنين) ——
        lastAgentAt: now,
        tunnelUp,
        tunnelPeerIp: body.tunnelPeerIp ?? undefined,
        agentVersion: body.agentVersion ?? undefined,
        agentOs: agentOs ?? undefined,
        agentArch: body.agentArch ?? undefined,
        agentCpuPercent: clampPercent(body.cpuPercent),
        agentRamPercent: clampPercent(body.ramPercent),
        agentDiskPercent: clampPercent(body.diskPercent),
        agentLoadAvg1m: body.loadAvg1m ?? undefined,
        estimatedMaxRps: body.suggestedMaxRps ?? undefined,
        agentOriginOk: body.originOk ?? undefined,
        agentOriginLatMs: body.originLatMs ?? undefined,

        // —— GUARD فقط ——
        ...(isGuard && nextStatus !== undefined && { status: nextStatus }),
        ...(isGuard &&
          suggestedRps !== undefined && { safeRequestsPerSecond: suggestedRps }),
      },
    }),

    fastify.prisma.agentHeartbeat.create({
      data: {
        serverId: server.id,
        agentVersion: body.agentVersion ?? undefined,
        agentOs: agentOs ?? undefined,
        agentArch: body.agentArch ?? undefined,
        hostname: body.hostname ?? undefined,
        tunnelUp,
        lastHandshakeAgeSec: body.lastHandshakeAgeSec ?? undefined,
        tunnelTxBytes: body.tunnelTxBytes ?? undefined,
        tunnelRxBytes: body.tunnelRxBytes ?? undefined,
        cpuPercent: clampPercent(body.cpuPercent),
        ramPercent: clampPercent(body.ramPercent),
        diskPercent: clampPercent(body.diskPercent),
        loadAvg1m: body.loadAvg1m ?? undefined,
        netTxBytesPs: body.netTxBytesPs ?? undefined,
        netRxBytesPs: body.netRxBytesPs ?? undefined,
        originOk: body.originOk ?? undefined,
        originLatMs: body.originLatMs ?? undefined,
        suggestedMaxRps: body.suggestedMaxRps ?? undefined,
      },
      select: {
        id: true,
        createdAt: true,
        tunnelUp: true,
        cpuPercent: true,
        ramPercent: true,
      },
    }),
  ])

  // ---- بث لحظي: عند تغيّر الحالة أو حالة النفق فقط (مش مع كل نبضة) ----
  const statusChanged = updated.status !== server.status
  const tunnelChanged = updated.tunnelUp !== server.tunnelUp

  if (statusChanged || tunnelChanged) {
    emitServerStatus(
      fastify,
      updated,
      statusChanged ? 'status_changed' : 'updated',
      server.status,
    )
  }

  // ---- إشعارات (GUARD فقط) ----
  if (isGuard && statusChanged) {
    await notifyGuardTransition(fastify, updated, server.status, updated.status)
  }

  maybePruneHeartbeats(fastify, server.id)

  return {
    ok: true,
    serverId: updated.id,
    domain: updated.domain,
    setupMode: updated.setupMode,
    status: updated.status,
    tunnelUp: updated.tunnelUp,
    lastAgentAt: updated.lastAgentAt,
    heartbeatId: heartbeat.id,
    // تلميح للـ Agent (اختياري لاحقًا: intervalSec من السياسة)
    nextHeartbeatSec: HEARTBEAT_INTERVAL_SEC,
  }
}

// ==================================================================
// 3) حالة + تاريخ النبضات (داشبورد — JWT)
// ==================================================================

export async function getAgentStatus(
  fastify: FastifyInstance,
  actorUserId: string,
  serverId: string,
): Promise<AgentStatusSnapshot> {
  const { server } = await getActorServer(fastify, actorUserId, serverId)

  const last = server.lastAgentAt
    ? new Date(server.lastAgentAt).getTime()
    : 0
  const ageSec = last ? (Date.now() - last) / 1000 : Infinity
  const isFresh = ageSec <= AGENT_FRESH_WINDOW_SEC

  return {
    serverId: server.id,
    hasToken: !!(server.agentTokenHash || server.agentToken),
    tunnelUp: server.tunnelUp,
    lastAgentAt: server.lastAgentAt
      ? new Date(server.lastAgentAt).toISOString()
      : null,
    agentVersion: server.agentVersion,
    agentOs: server.agentOs as AgentStatusSnapshot['agentOs'],
    agentArch: server.agentArch,
    agentCpuPercent: server.agentCpuPercent,
    agentRamPercent: server.agentRamPercent,
    agentDiskPercent: server.agentDiskPercent,
    agentLoadAvg1m: server.agentLoadAvg1m,
    estimatedMaxRps: server.estimatedMaxRps,
    agentOriginOk: server.agentOriginOk,
    agentOriginLatMs: server.agentOriginLatMs,
    tunnelPeerIp: server.tunnelPeerIp,
    isFresh,
  }
}

export async function listHeartbeats(
  fastify: FastifyInstance,
  actorUserId: string,
  serverId: string,
  query: ListHeartbeatsQuery,
) {
  await getActorServer(fastify, actorUserId, serverId)

  const where: {
    serverId: string
    tunnelUp?: boolean
    createdAt?: { gte?: Date; lte?: Date }
  } = { serverId }

  if (query.tunnelUpOnly === true) {
    where.tunnelUp = true
  }

  if (query.from || query.to) {
    where.createdAt = {}
    if (query.from) where.createdAt.gte = new Date(query.from)
    if (query.to) where.createdAt.lte = new Date(query.to)
  }

  const items = await fastify.prisma.agentHeartbeat.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(query.limit, 500),
    select: {
      id: true,
      createdAt: true,
      agentVersion: true,
      agentOs: true,
      agentArch: true,
      hostname: true,
      tunnelUp: true,
      lastHandshakeAgeSec: true,
      cpuPercent: true,
      ramPercent: true,
      diskPercent: true,
      loadAvg1m: true,
      netTxBytesPs: true,
      netRxBytesPs: true,
      originOk: true,
      originLatMs: true,
      suggestedMaxRps: true,
    },
  })

  return {
    serverId,
    items,
    limit: query.limit,
  }
}

// ==================================================================
// 4) تدوير / إبطال التوكن
// ==================================================================

/**
 * يولّد توكن جديد ويلغي القديم + يرجّع أمر تثبيت جديد (GUARD فقط)
 */
export async function rotateAgentToken(
  fastify: FastifyInstance,
  actorUserId: string,
  serverId: string,
  installChannel: EnableTunnelInput['installChannel'] = 'script',
) {
  return enableTunnel(fastify, actorUserId, serverId, {
    rotateToken: true,
    installChannel: installChannel ?? 'script',
  })
}

/**
 * يقفل النفق (والتوكن لو revokeToken ≠ false).
 *
 * - ما بيمسحش السيرفر (Origin ولا Guard) ولا بيشغّل probe لوحده.
 * - متاح للاتنين: ينضّف توكن Agent قديم على سيرفر Origin من غير ما يلمس
 *   status أو حقول الأورجن.
 * - GUARD: الحالة بتتحسب من طبقة الـ Guard (بعد قفل النفق → OFFLINE، أو
 *   PENDING لو عمره ما اتصل). الصيانة ما بتتغيرش.
 *
 * ملاحظة: لو revokeToken=false والتوكن لسه شغال، الـ Agent لو لسه بيبعت
 * نبضات هيرجّع tunnelUp من جديد. الإبطال هو الإيقاف الفعلي.
 */
export async function disableAgent(
  fastify: FastifyInstance,
  actorUserId: string,
  serverId: string,
  input: DisableAgentInput = { revokeToken: true },
) {
  const { server } = await getActorServer(fastify, actorUserId, serverId)

  // الافتراضي: إبطال (نفس منطق الرد القديم، وبقى متسق مع اللي بيتكتب فعلًا)
  const revoke = input.revokeToken !== false

  const data: Prisma.ServerUpdateInput = {
    tunnelUp: false,
    ...(revoke
      ? {
          agentToken: null,
          agentTokenHash: null,
        }
      : {}),
  }

  if (server.setupMode === 'GUARD' && server.status !== 'MAINTENANCE') {
    data.status = computeGuardStatus({
      tunnelUp: false,
      lastAgentAt: server.lastAgentAt,
      avgResponseTimeMs: server.avgResponseTimeMs,
    })
  }

  const updated = await fastify.prisma.server.update({
    where: { id: server.id },
    data,
  })

  if (updated.status !== server.status || server.tunnelUp) {
    emitServerStatus(
      fastify,
      updated,
      updated.status !== server.status ? 'status_changed' : 'updated',
      server.status,
    )
  }

  return {
    ok: true,
    serverId: server.id,
    tokenRevoked: revoke,
    status: updated.status,
  }
}

// ==================================================================
// 5) Sweeper: Agent سكت (من غير نبضة) → OFFLINE
// ==================================================================

export interface StaleAgentSweepResult {
  checked: number
  markedOffline: number
}

/**
 * يلاقي سيرفرات GUARD اللي tunnelUp=true لكن آخر نبضة أقدم من AGENT_FRESH_WINDOW_SEC
 * (يعني الـ Agent مات/اتفصل من غير ما يبلّغ) ويعلّمها tunnelUp=false + OFFLINE،
 * ويبث للداشبورد ويبعت إشعار. الصيانة بتتحفظ.
 *
 * التحديث مشروط (lastAgentAt لسه قديم) فنبضة وصلت بين القراءة والكتابة ما تتكتبش فوقها.
 */
export async function sweepStaleAgents(
  fastify: FastifyInstance,
  opts: { limit?: number } = {},
): Promise<StaleAgentSweepResult> {
  const cutoff = new Date(Date.now() - AGENT_FRESH_WINDOW_SEC * 1000)

  const stale = await fastify.prisma.server.findMany({
    where: {
      setupMode: 'GUARD',
      tunnelUp: true,
      lastAgentAt: { lt: cutoff },
    },
    select: { id: true, status: true },
    take: opts.limit ?? SWEEP_BATCH,
  })

  let markedOffline = 0

  for (const row of stale) {
    try {
      const res = await fastify.prisma.server.updateMany({
        where: {
          id: row.id,
          setupMode: 'GUARD',
          tunnelUp: true,
          lastAgentAt: { lt: cutoff },
        },
        data: {
          tunnelUp: false,
          ...(row.status !== 'MAINTENANCE' ? { status: 'OFFLINE' as const } : {}),
        },
      })

      if (res.count === 0) continue // نبضة وصلت في الأثناء

      const updated = await fastify.prisma.server.findUnique({
        where: { id: row.id },
      })
      if (!updated) continue

      markedOffline++
      emitServerStatus(fastify, updated, 'status_changed', row.status)
      await notifyGuardTransition(fastify, updated, row.status, updated.status)
    } catch (err) {
      fastify.log.warn({ err, serverId: row.id }, 'Stale agent sweep failed')
    }
  }

  return { checked: stale.length, markedOffline }
}

/**
 * يشغّل الـ sweeper دوريًا (AGENT_SWEEP_INTERVAL_SEC، الافتراضي 30، 0 = متوقف).
 * يرجّع دالة إيقاف (استدعيها عند إغلاق السيرفر).
 *
 * مثال في server.ts / app.ts بعد ما الـ app يجهز:
 *   const stopAgentSweeper = startAgentSweeper(app)
 *   app.addHook('onClose', async () => stopAgentSweeper())
 */
export function startAgentSweeper(fastify: FastifyInstance): () => void {
  if (SWEEP_INTERVAL_SEC <= 0) return () => undefined

  let running = false

  const timer = setInterval(() => {
    if (running) return
    running = true
    sweepStaleAgents(fastify)
      .catch((err: unknown) =>
        fastify.log.error({ err }, 'Agent sweeper crashed'),
      )
      .finally(() => {
        running = false
      })
  }, SWEEP_INTERVAL_SEC * 1000)

  timer.unref()

  return () => clearInterval(timer)
}

// ------------------------------------------------------------------
// تصدير
// ------------------------------------------------------------------

export default {
  enableTunnel,
  processHeartbeat,
  extractAgentToken,
  getAgentStatus,
  listHeartbeats,
  rotateAgentToken,
  disableAgent,
  sweepStaleAgents,
  startAgentSweeper,
}