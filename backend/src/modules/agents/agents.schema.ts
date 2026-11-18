/**
 * backend/src/modules/agents/agents.schema.ts
 * ==================================================================
 * Zero Plus - Agent Validation (Zod)
 *
 * يغطي:
 *   1) تفعيل النفق من الداشبورد (enable-tunnel)
 *      → توليد AGENT_TOKEN + أمر التثبيت
 *   2) نبضة الـ Agent (heartbeat) من السيرفر الداخلي
 *      → تحديث Server + تسجيل AgentHeartbeat
 *   3) استعلامات اختيارية (آخر نبضات / حالة النفق)
 *
 * ملاحظات أمان:
 *   - التوكن يُعرض مرة واحدة عند التفعيل (أو عند إعادة التوليد)
 *   - في DB يُفضَّل تخزين hash (agentTokenHash) والنص الخام اختياري/مؤقت
 *   - مسار الـ heartbeat داخلي: يتحقق من Bearer AGENT_TOKEN وليس JWT المستخدم
 *
 * الحقول متوافقة مع:
 *   Server (agentToken, agentTokenHash, agentVersion, agentOs, agentArch,
 *           lastAgentAt, tunnelUp, tunnelPeerIp, agentCpuPercent, ...)
 *   AgentHeartbeat (سجل تاريخي لكل نبضة)
 * ==================================================================
 */

import { z } from 'zod'

// ------------------------------------------------------------------
// مشترك
// ------------------------------------------------------------------

const uuidSchema = z.string().uuid('معرّف غير صالح')

/** نظام تشغيل الـ Agent — متوافق مع Prisma enum AgentOs */
export const agentOsSchema = z.enum(['LINUX', 'WINDOWS', 'UNKNOWN'], {
  message: 'نظام التشغيل يجب أن يكون LINUX أو WINDOWS أو UNKNOWN',
})

export type AgentOsInput = z.infer<typeof agentOsSchema>

/** معمارية شائعة */
const agentArchSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[a-zA-Z0-9_-]+$/, 'صيغة المعمارية غير صالحة')
  .optional()
  .nullable()

/** نسبة مئوية 0–100 (أو قيم قريبة للسماح بهامش قياس) */
const percentSchema = z
  .number()
  .finite()
  .min(0)
  .max(100.5)
  .optional()
  .nullable()

/** رقم غير سالب */
const nonNegIntSchema = z.number().int().min(0).optional().nullable()

const nonNegFloatSchema = z.number().finite().min(0).optional().nullable()

/** إصدار الـ Agent مثل 1.0.0 أو 1.2.3-beta */
const agentVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .optional()
  .nullable()

const hostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .optional()
  .nullable()

// ==================================================================
// Params
// ==================================================================

/**
 * POST /servers/:serverId/enable-tunnel
 * GET  /servers/:serverId/agent-status  (اختياري)
 * GET  /servers/:serverId/heartbeats    (اختياري)
 */
export const serverIdParamsSchema = z
  .object({
    serverId: uuidSchema,
  })
  .strict()

/**
 * توافق مع مسارات قديمة تستخدم :id
 * يُفضّل توحيد الاسم على serverId في الـ routes
 */
export const serverIdAliasParamsSchema = z
  .object({
    id: uuidSchema.optional(),
    serverId: uuidSchema.optional(),
  })
  .strict()
  .refine((d) => !!(d.serverId || d.id), {
    message: 'معرّف السيرفر مطلوب',
  })
  .transform((d) => ({
    serverId: (d.serverId || d.id) as string,
  }))

// ==================================================================
// 1) تفعيل النفق — من لوحة التحكم (JWT + صلاحية servers:enable-agent)
// ==================================================================

/**
 * POST /servers/:serverId/enable-tunnel
 *
 * body اختياري:
 *   - rotateToken: إعادة توليد توكن جديد (يلغي القديم)
 *   - installChannel: شكل أمر التثبيت (script | docker | binary)
 *   - preferOs / preferArch: لتخصيص سطر الأمر الراجع
 */
export const enableTunnelBodySchema = z
  .object({
    /** true = امسح التوكن القديم وولّد واحد جديد */
    rotateToken: z.boolean().optional().default(false),

    /**
     * شكل الأمر الراجع للعميل
     * script  = curl | bash (افتراضي)
     * docker  = أمر docker run
     * binary  = رابط تحميل + أمر تشغيل
     */
    installChannel: z
      .enum(['script', 'docker', 'binary'])
      .optional()
      .default('script'),

    /** تلميح لنظام التشغيل عند بناء الأمر (لا يُحفظ كحقيقة) */
    preferOs: agentOsSchema.optional(),

    /** تلميح للمعمارية: amd64 | arm64 */
    preferArch: z
      .enum(['amd64', 'arm64', 'x86_64', 'aarch64'])
      .optional(),
  })
  .strict()

export type EnableTunnelInput = z.infer<typeof enableTunnelBodySchema>

// ==================================================================
// 2) Heartbeat — من الـ Agent (مصادقة AGENT_TOKEN)
// ==================================================================

/**
 * POST /internal/agent/heartbeat
 *
 * المصادقة: Authorization: Bearer <AGENT_TOKEN>
 * أو هيدر بديل: X-Agent-Token: <AGENT_TOKEN>
 *
 * الـ service يفك التوكن → يجد Server → يحدّث snapshot على Server
 * ويسجّل صف في AgentHeartbeat
 */
export const agentHeartbeatBodySchema = z
  .object({
    // ---------- هوية الـ Agent ----------
    agentVersion: agentVersionSchema,
    agentOs: agentOsSchema.optional().nullable(),
    agentArch: agentArchSchema,
    hostname: hostnameSchema,

    // ---------- حالة النفق (WireGuard / tunnel) ----------
    tunnelUp: z.boolean().optional().default(false),

    /** ثواني منذ آخر handshake ناجح مع الـ peer */
    lastHandshakeAgeSec: nonNegIntSchema,

    /** بايتات تراكمية على النفق (للمراقبة) */
    tunnelTxBytes: z
      .union([z.number().int().min(0), z.string().regex(/^\d+$/)])
      .optional()
      .nullable()
      .transform((v) => {
        if (v === undefined || v === null) return null
        return typeof v === 'string' ? BigInt(v) : BigInt(v)
      }),

    tunnelRxBytes: z
      .union([z.number().int().min(0), z.string().regex(/^\d+$/)])
      .optional()
      .nullable()
      .transform((v) => {
        if (v === undefined || v === null) return null
        return typeof v === 'string' ? BigInt(v) : BigInt(v)
      }),

    /** IP الـ peer داخل النفق إن وُجد */
    tunnelPeerIp: z
      .string()
      .trim()
      .max(64)
      .optional()
      .nullable(),

    // ---------- مقاييس المضيف ----------
    cpuPercent: percentSchema,
    ramPercent: percentSchema,
    diskPercent: percentSchema,
    loadAvg1m: nonNegFloatSchema,

    /** معدل الشبكة منذ آخر نبضة (بايت/ثانية) */
    netTxBytesPs: nonNegFloatSchema,
    netRxBytesPs: nonNegFloatSchema,

    // ---------- صحة الـ Origin من منظور الـ Agent ----------
    originOk: z.boolean().optional().nullable(),
    originLatMs: nonNegIntSchema,

    /**
     * تقدير السعة من الـ Agent نفسه (اختياري)
     * يُحفظ على Server.estimatedMaxRps وعلى النبضة
     */
    suggestedMaxRps: nonNegIntSchema,

    /**
     * حقول إضافية مستقبلية بدون كسر الـ schema
     * (الـ service يتجاهلها أو يخزن جزء منها في details إن لزم)
     */
    meta: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .strict()

export type AgentHeartbeatInput = z.infer<typeof agentHeartbeatBodySchema>

// ==================================================================
// 3) استعلامات اختيارية (للداشبورد)
// ==================================================================

/**
 * GET /servers/:serverId/heartbeats
 * آخر N نبضة لمخططات السعة / التسعير
 */
export const listHeartbeatsQuerySchema = z.object({
  /** عدد الصفوف (الأحدث أولاً) */
  limit: z.coerce.number().int().min(1).max(500).default(50),

  /**
   * من تاريخ (ISO) — اختياري
   * مثال: 2026-11-01T00:00:00.000Z
   */
  from: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string().datetime().optional()),

  to: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string().datetime().optional()),

  /** فقط النبضات والنفق Up */
  tunnelUpOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
})

export type ListHeartbeatsQuery = z.infer<typeof listHeartbeatsQuerySchema>

/**
 * GET /servers/:serverId/agent-status
 * ملخص سريع لحالة الـ Agent (من snapshot على Server)
 * مفيش query — params فقط
 */
export const emptyQuerySchema = z.object({}).strict().optional().default({})

// ==================================================================
// 4) إبطال / تدوير التوكن (اختياري من الداشبورد)
// ==================================================================

/**
 * POST /servers/:serverId/rotate-agent-token
 * أو يُغطّى عبر enable-tunnel مع rotateToken: true
 *
 * body فاضي أو تأكيد صريح
 */
export const rotateAgentTokenBodySchema = z
  .object({
    /** يجب true لتأكيد التدوير */
    confirm: z.literal(true).optional(),
  })
  .strict()
  .optional()
  .default({})

export type RotateAgentTokenInput = z.infer<typeof rotateAgentTokenBodySchema>

/**
 * POST /servers/:serverId/disable-agent
 * إيقاف اعتماد التوكن الحالي (مسح hash / تعليم tunnel لأسفل)
 */
export const disableAgentBodySchema = z
  .object({
    /** مسح التوكن نهائيًا من DB */
    revokeToken: z.boolean().optional().default(true),
  })
  .strict()
  .default({ revokeToken: true })

export type DisableAgentInput = z.infer<typeof disableAgentBodySchema>

// ==================================================================
// 5) أشكال مساعدة للاستجابة (توثيق / type-only — مش validation وارد)
// ==================================================================

/**
 * شكل أمر التثبيت الراجع من enable-tunnel
 * (للاستخدام في TypeScript على الـ service/routes — مش Zod request)
 */
export type InstallCommandPayload = {
  channel: 'script' | 'docker' | 'binary'
  /** الأمر الكامل للنسخ واللصق */
  command: string
  /** التوكن مرة واحدة — لا يُعاد في GET لاحق */
  agentToken: string
  /** متى ينتهي عرض التوكن في الواجهة (اختياري) */
  tokenHint?: string
  serverId: string
  domain?: string
  /** رابط وثائق أو سكربت */
  docsUrl?: string
}

/**
 * ملخص حالة الـ Agent من Server snapshot
 */
export type AgentStatusSnapshot = {
  serverId: string
  hasToken: boolean
  tunnelUp: boolean
  lastAgentAt: string | null
  agentVersion: string | null
  agentOs: AgentOsInput | null
  agentArch: string | null
  agentCpuPercent: number | null
  agentRamPercent: number | null
  agentDiskPercent: number | null
  agentLoadAvg1m: number | null
  estimatedMaxRps: number | null
  agentOriginOk: boolean | null
  agentOriginLatMs: number | null
  tunnelPeerIp: string | null
  /** هل آخر نبضة ضمن نافذة fresh (مثلاً 2 دقيقة) */
  isFresh: boolean
}

// ==================================================================
// Types المُصدَّرة للـ service / routes
// ==================================================================

export type ServerIdParams = z.infer<typeof serverIdParamsSchema>
export type EnableTunnelBody = EnableTunnelInput
export type AgentHeartbeatBody = AgentHeartbeatInput
