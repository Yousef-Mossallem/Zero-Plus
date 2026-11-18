/**
 * backend/src/modules/agents/agents.service.ts
 * ==================================================================
 * Zero Plus - Agent Service
 *
 * المسؤوليات:
 *   1) تفعيل النفق على سيرفر (enable-tunnel)
 *      - توليد AGENT_TOKEN آمن
 *      - حفظ hash في DB (+ التوكن الخام اختياريًا للعرض مرة واحدة)
 *      - بناء أمر التثبيت من متغيرات البيئة (GitHub Release / سيرفرك)
 *
 *   2) استقبال Heartbeat من الـ Agent
 *      - التحقق من التوكن
 *      - تحديث snapshot على Server
 *      - تسجيل صف في AgentHeartbeat
 *
 *   3) حالة الـ Agent + آخر النبضات (للداشبورد)
 *   4) تدوير / إبطال التوكن
 *
 * الأمان:
 *   - التوكن يُولَّد عشوائيًا (base64url) ويُعرض مرة واحدة عند التفعيل/التدوير
 *   - في DB: agentTokenHash (sha256) للتحقق السريع
 *   - agentToken الخام يُحفظ فقط لو AGENT_STORE_RAW_TOKEN=true (للتطوير)
 *
 * أمر التثبيت:
 *   كل الروابط والقوالب من env — غيّر الإصدار/المستودع بدون تعديل كود
 * ==================================================================
 */

import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes } from 'crypto'
import type { AgentOs, ServerStatus } from '@prisma/client'
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

/** طول التوكن بالبايت قبل الترميز (32 = 43 حرف base64url تقريبًا) */
const TOKEN_BYTES = Number(process.env.AGENT_TOKEN_BYTES ?? 32)

/** نافذة «الـ Agent حي» بالثواني (بعدها isFresh = false) */
const AGENT_FRESH_WINDOW_SEC = Number(
  process.env.AGENT_FRESH_WINDOW_SEC ?? 120,
)

/**
 * هل نخزّن التوكن الخام في DB؟
 * الإنتاج: false (hash فقط)
 * التطوير: true لو حابب تشوف التوكن من DB
 */
const STORE_RAW_TOKEN =
  process.env.AGENT_STORE_RAW_TOKEN === '1' ||
  process.env.AGENT_STORE_RAW_TOKEN === 'true'

// ---- قوالب أمر التثبيت (كل شيء قابل للتغيير من env) ----

/**
 * رابط سكربت التثبيت (one-liner)
 * مثال GitHub Release:
 *   https://github.com/ORG/zero-plus-agent/releases/latest/download/install.sh
 * أو سيرفرك:
 *   https://downloads.zero-plus.site/agent/install.sh
 */
function getInstallScriptUrl(): string {
  return (
    process.env.AGENT_INSTALL_SCRIPT_URL?.trim() ||
    process.env.AGENT_DOWNLOAD_BASE_URL?.trim()?.replace(/\/$/, '') +
      '/install.sh' ||
    'https://github.com/zero-plus-hq/zero-plus-agent/releases/latest/download/install.sh'
  )
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
 * مثال:
 *   https://github.com/ORG/zero-plus-agent/releases/latest/download
 * الملفات المتوقعة: zero-plus-agent-linux-amd64.tar.gz ...
 */
function getBinaryBaseUrl(): string {
  return (
    process.env.AGENT_BINARY_BASE_URL?.trim()?.replace(/\/$/, '') ||
    process.env.AGENT_DOWNLOAD_BASE_URL?.trim()?.replace(/\/$/, '') ||
    'https://github.com/zero-plus-hq/zero-plus-agent/releases/latest/download'
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
    process.env.AGENT_API_BASE_URL?.trim()?.replace(/\/$/, '') ||
    process.env.GATEWAY_PUBLIC_URL?.trim()?.replace(/\/$/, '') ||
    process.env.APP_URL?.trim()?.replace(/\/$/, '') ||
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
// Helpers — توكن
// ------------------------------------------------------------------

function generateAgentToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
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
    throw new Error('USER_NOT_FOUND')
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
      status: true,
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
    throw new Error('SERVER_NOT_FOUND')
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
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v)
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
    command = [
      `docker run -d --name zero-plus-agent --restart unless-stopped`,
      `--cap-add=NET_ADMIN --device /dev/net/tun`,
      `-e AGENT_TOKEN="{{TOKEN}}"`,
      `-e AGENT_API_URL="{{API_URL}}"`,
      `-e AGENT_SERVER_ID="{{SERVER_ID}}"`,
      `"{{DOCKER_IMAGE}}"`,
    ]
      .join(' ')
      .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
  } else if (params.channel === 'binary') {
    const os =
      (params.preferOs || 'LINUX').toLowerCase() === 'windows'
        ? 'windows'
        : 'linux'
    const archRaw = (params.preferArch || 'amd64').toLowerCase()
    const arch =
      archRaw === 'aarch64' || archRaw === 'arm64' ? 'arm64' : 'amd64'
    const archive = `${binaryName}-${os}-${arch}.tar.gz`

    command = [
      `curl -fsSL "${binaryBase}/${archive}" -o /tmp/${archive}`,
      `tar -xzf /tmp/${archive} -C /usr/local/bin`,
      `chmod +x /usr/local/bin/${binaryName}`,
      `AGENT_TOKEN="{{TOKEN}}" AGENT_API_URL="{{API_URL}}" AGENT_SERVER_ID="{{SERVER_ID}}" ${binaryName} install`,
    ]
      .join(' && ')
      .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
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
 * يولّد (أو يعيد استخدام) توكن الـ Agent ويرجّع أمر التثبيت
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

  const shouldRotate = input.rotateToken === true
  const hasExisting =
    !!server.agentTokenHash || !!(STORE_RAW_TOKEN && server.agentToken)

  let plainToken: string | null = null

  if (shouldRotate || !hasExisting) {
    plainToken = generateAgentToken()
    const tokenHash = hashToken(plainToken)

    await fastify.prisma.server.update({
      where: { id: server.id },
      data: {
        agentTokenHash: tokenHash,
        agentToken: STORE_RAW_TOKEN ? plainToken : null,
        // عند التفعيل الأول/التدوير نعتبر النفق لسه مش Up
        ...(shouldRotate
          ? {
              tunnelUp: false,
              lastAgentAt: null,
            }
          : {}),
      },
    })
  } else if (STORE_RAW_TOKEN && server.agentToken) {
    // تطوير: نعيد نفس التوكن الخام لو مخزّن
    plainToken = server.agentToken
  } else {
    // الإنتاج بدون raw: لازم rotate عشان تشوف التوكن تاني
    throw new Error('AGENT_TOKEN_ALREADY_ISSUED')
  }

  if (!plainToken) {
    throw new Error('AGENT_TOKEN_ALREADY_ISSUED')
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
 * يتحقق من التوكن ويُرجع السيرفر
 */
async function resolveServerByAgentToken(
  fastify: FastifyInstance,
  plainToken: string,
) {
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
      status: true,
      agentTokenHash: true,
    },
  })

  if (!server) {
    throw new Error('INVALID_AGENT_TOKEN')
  }

  return server
}

/**
 * معالجة نبضة واحدة:
 * - تحديث snapshot على Server
 * - إدراج AgentHeartbeat
 */
export async function processHeartbeat(
  fastify: FastifyInstance,
  plainToken: string,
  body: AgentHeartbeatInput,
) {
  const server = await resolveServerByAgentToken(fastify, plainToken)

  const now = new Date()

  const agentOs = (body.agentOs ?? undefined) as AgentOs | undefined

  const [updated, heartbeat] = await fastify.prisma.$transaction([
    fastify.prisma.server.update({
      where: { id: server.id },
      data: {
        lastAgentAt: now,
        tunnelUp: body.tunnelUp ?? false,
        tunnelPeerIp: body.tunnelPeerIp ?? undefined,
        agentVersion: body.agentVersion ?? undefined,
        agentOs: agentOs ?? undefined,
        agentArch: body.agentArch ?? undefined,
        agentCpuPercent: body.cpuPercent ?? undefined,
        agentRamPercent: body.ramPercent ?? undefined,
        agentDiskPercent: body.diskPercent ?? undefined,
        agentLoadAvg1m: body.loadAvg1m ?? undefined,
        estimatedMaxRps: body.suggestedMaxRps ?? undefined,
        agentOriginOk: body.originOk ?? undefined,
        agentOriginLatMs: body.originLatMs ?? undefined,
        // لو النفق شغال والأصل تمام — ممكن نرفع الحالة لـ ONLINE بحذر
        ...(body.tunnelUp && body.originOk === true
          ? { status: 'ONLINE' as ServerStatus }
          : {}),
      },
      select: {
        id: true,
        domain: true,
        tunnelUp: true,
        lastAgentAt: true,
        agentVersion: true,
        status: true,
      },
    }),

    fastify.prisma.agentHeartbeat.create({
      data: {
        serverId: server.id,
        agentVersion: body.agentVersion ?? undefined,
        agentOs: agentOs ?? undefined,
        agentArch: body.agentArch ?? undefined,
        hostname: body.hostname ?? undefined,
        tunnelUp: body.tunnelUp ?? false,
        lastHandshakeAgeSec: body.lastHandshakeAgeSec ?? undefined,
        tunnelTxBytes: body.tunnelTxBytes ?? undefined,
        tunnelRxBytes: body.tunnelRxBytes ?? undefined,
        cpuPercent: body.cpuPercent ?? undefined,
        ramPercent: body.ramPercent ?? undefined,
        diskPercent: body.diskPercent ?? undefined,
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

  return {
    ok: true,
    serverId: updated.id,
    domain: updated.domain,
    tunnelUp: updated.tunnelUp,
    lastAgentAt: updated.lastAgentAt,
    heartbeatId: heartbeat.id,
    // تلميح للـ Agent (اختياري لاحقًا: intervalSec من السياسة)
    nextHeartbeatSec: Number(process.env.AGENT_HEARTBEAT_INTERVAL_SEC ?? 30),
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
    take: query.limit,
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
 * يولّد توكن جديد ويلغي القديم + يرجّع أمر تثبيت جديد
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
 * يوقف اعتماد الـ Agent على السيرفر (يمسح التوكن ويعلّم النفق لأسفل)
 */
export async function disableAgent(
  fastify: FastifyInstance,
  actorUserId: string,
  serverId: string,
  input: DisableAgentInput = { revokeToken: true },
) {
  const { server } = await getActorServer(fastify, actorUserId, serverId)

  await fastify.prisma.server.update({
    where: { id: server.id },
    data: {
      tunnelUp: false,
      ...(input.revokeToken
        ? {
            agentToken: null,
            agentTokenHash: null,
          }
        : {}),
    },
  })

  return {
    ok: true,
    serverId: server.id,
    tokenRevoked: input.revokeToken !== false,
  }
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
}
