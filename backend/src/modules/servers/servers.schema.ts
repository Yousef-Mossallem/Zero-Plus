// backend/src/modules/servers/servers.schema.ts
// ==================================================================
// Zero Plus - Servers Validation Schemas
// ------------------------------------------------------------------
// مصدر الحقيقة لكل ما يخص السيرفرات المحمية، ومتطابق مع model Server
// في schema.prisma (setupMode / originIp? / originPort / sslEnabled / mode ...).
//
// مساران منفصلان تمامًا (ممنوع يتلخبطوا):
//
//   ORIGIN  → مسار تقليدي كامل:
//             دومين + originIp (إلزامي) + DNS (TXT/CNAME/A) + verify + Origin Probe.
//             ملهوش دعوة بتفعيل النفق.
//
//   GUARD   → مسار Agent / نفق فقط:
//             دومين فقط. ما فيش originIp ولا DNS routing ولا Probe.
//             التفعيل بعد الإنشاء عن طريق enable-tunnel والـ heartbeat.
//
// وضع الربط (setupMode) بيتحدد عند الإنشاء فقط، والتحويل بينهم
// ميزة منفصلة لاحقًا (PATCH بيرفض تغييره).
//
// Dashboard (JWT)  → prefix: /servers
//   POST   /                       إنشاء سيرفر (ORIGIN: + تعليمات DNS | GUARD: + خطوات النفق)
//   GET    /                       قائمة السيرفرات (فلتر setupMode / tunnelUp)
//   GET    /:id                    تفاصيل سيرفر
//   PATCH  /:id                    تعديل (بقواعد حسب وضع الربط)
//   DELETE /:id?confirmDomain=     حذف (بتأكيد اسم الدومين)
//   GET    /:id/dns                تعليمات الـ DNS (ORIGIN فقط)
//   POST   /:id/verify             فحص الـ DNS (ORIGIN فقط)
//   POST   /:id/maintenance        تشغيل/إيقاف وضع الصيانة
//
// Gateway (X-Gateway-Key) → prefix: /internal/gateway
//   GET  /servers                  مزامنة كل السيرفرات (cursor + updatedSince)
//   GET  /servers/resolve?host=    سيرفر واحد من الـ Host
//   POST /servers/:id/health       الـ Gateway يبلّغ بحالة السيرفر (+ نتائج Probe لـ ORIGIN فقط)
//
// ملاحظة: متوافق مع Zod v3 و v4 (من غير required_error).
// ==================================================================

import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import { z } from 'zod'
import type {
  ServerMode,
  ServerSetupMode,
  ServerStatus,
} from '@prisma/client'

// ==================================================================
// 1) Enums (متطابقة مع Prisma، والـ TypeScript هيكسر الـ build لو اختلفت)
// ==================================================================

export const SERVER_SETUP_MODES = [
  'ORIGIN',
  'GUARD',
] as const satisfies readonly ServerSetupMode[]

/** الافتراضي ORIGIN عشان السيرفرات القديمة وأي عميل لا يرسل setupMode */
export const DEFAULT_SETUP_MODE: ServerSetupMode = 'ORIGIN'

export const SERVER_MODES = [
  'PROTECT',
  'MONITOR_ONLY',
] as const satisfies readonly ServerMode[]

export const SERVER_STATUSES = [
  'PENDING',
  'ONLINE',
  'DEGRADED',
  'OFFLINE',
  'MAINTENANCE',
] as const satisfies readonly ServerStatus[]

/** وصف الوضعين للواجهة (يُعرض في اختيار نوع الربط) */
export const SETUP_MODE_META = {
  ORIGIN: {
    label: 'Origin',
    labelAr: 'ربط تقليدي (Origin)',
    description:
      'Point your domain to the Gateway via DNS and provide your origin server IP. Includes DNS verification and an Origin Probe.',
    descriptionAr:
      'وجّه الدومين للـ Gateway عبر DNS واكتب عنوان السيرفر الأصلي. يشمل التحقق من DNS وقياس قدرة الأصل (Origin Probe).',
  },
  GUARD: {
    label: 'Guard',
    labelAr: 'حارس (Agent / نفق)',
    description:
      'Install a lightweight agent on your server. It opens a secure tunnel to the platform, so no origin IP is required.',
    descriptionAr:
      'ثبّت Agent خفيف على السيرفر يفتح نفقًا آمنًا مع المنصة، من غير ما تحتاج تكتب عنوان الأصل.',
  },
} as const satisfies Record<
  ServerSetupMode,
  { label: string; labelAr: string; description: string; descriptionAr: string }
>

// ==================================================================
// 2) قدرات كل وضع (Capabilities) — الفاصل بين المسارين
// ==================================================================
// أي ميزة خاصة بمسار واحد بتتفحص من هنا. الـ service / agents.service
// يستدعوا assertFeature() قبل تنفيذ أي إجراء، فمفيش حد يقدر يعمل
// verify لسيرفر Guard ولا enable-tunnel لسيرفر Origin بالغلط.

export type ServerFeature =
  | 'DNS_INSTRUCTIONS' // GET /:id/dns
  | 'DNS_VERIFY' // POST /:id/verify
  | 'ORIGIN_PROBE' // قياس قدرة الأصل
  | 'ORIGIN_FIELDS' // originIp / originPort / sslEnabled
  | 'AGENT_TUNNEL' // enable-tunnel / rotate / disable / heartbeat

const SETUP_MODE_FEATURES = {
  ORIGIN: new Set<ServerFeature>([
    'DNS_INSTRUCTIONS',
    'DNS_VERIFY',
    'ORIGIN_PROBE',
    'ORIGIN_FIELDS',
  ]),
  GUARD: new Set<ServerFeature>(['AGENT_TUNNEL']),
} as const satisfies Record<ServerSetupMode, ReadonlySet<ServerFeature>>

export function supportsFeature(
  setupMode: ServerSetupMode,
  feature: ServerFeature,
): boolean {
  return SETUP_MODE_FEATURES[setupMode].has(feature)
}

export function getServerCapabilities(
  setupMode: ServerSetupMode,
): Record<ServerFeature, boolean> {
  return {
    DNS_INSTRUCTIONS: supportsFeature(setupMode, 'DNS_INSTRUCTIONS'),
    DNS_VERIFY: supportsFeature(setupMode, 'DNS_VERIFY'),
    ORIGIN_PROBE: supportsFeature(setupMode, 'ORIGIN_PROBE'),
    ORIGIN_FIELDS: supportsFeature(setupMode, 'ORIGIN_FIELDS'),
    AGENT_TUNNEL: supportsFeature(setupMode, 'AGENT_TUNNEL'),
  }
}

/**
 * يرمي Error('FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE') لو الميزة مش
 * متاحة للوضع ده. أضف الكود في ERROR_MAP بتاع الراوت (شوف
 * SETUP_MODE_ERRORS تحت).
 */
export function assertFeature(
  setupMode: ServerSetupMode,
  feature: ServerFeature,
): void {
  if (!supportsFeature(setupMode, feature)) {
    throw new Error('FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE')
  }
}

// ==================================================================
// 3) أخطاء وضع الربط (بنفس شكل ERROR_MAP في الراوتات)
// ==================================================================

export type SetupModeErrorCode =
  | 'SETUP_MODE_IMMUTABLE'
  | 'ORIGIN_FIELDS_NOT_ALLOWED_FOR_GUARD'
  | 'FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE'
  | 'EMPTY_UPDATE'

/**
 * استخدمها في ERROR_MAP:  { ...ERROR_MAP, ...SETUP_MODE_ERRORS }
 */
export const SETUP_MODE_ERRORS: Record<
  SetupModeErrorCode,
  { status: number; code: SetupModeErrorCode; message: string; messageAr: string }
> = {
  SETUP_MODE_IMMUTABLE: {
    status: 400,
    code: 'SETUP_MODE_IMMUTABLE',
    message: 'The setup mode cannot be changed after the server is created',
    messageAr: 'لا يمكن تغيير وضع الربط (Origin / Guard) بعد إنشاء السيرفر',
  },
  ORIGIN_FIELDS_NOT_ALLOWED_FOR_GUARD: {
    status: 400,
    code: 'ORIGIN_FIELDS_NOT_ALLOWED_FOR_GUARD',
    message:
      'originIp / originPort / sslEnabled do not apply to a Guard (agent) server',
    messageAr:
      'حقول الأصل (originIp / originPort / sslEnabled) لا تنطبق على سيرفر Guard',
  },
  FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE: {
    status: 409,
    code: 'FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE',
    message: 'This action is not available for this server setup mode',
    messageAr: 'هذا الإجراء غير متاح لوضع الربط الخاص بهذا السيرفر',
  },
  EMPTY_UPDATE: {
    status: 400,
    code: 'EMPTY_UPDATE',
    message: 'Nothing to update',
    messageAr: 'لا توجد حقول للتعديل',
  },
}

// ==================================================================
// 4) الدومين
// ==================================================================

export type DomainCheck =
  | { ok: true; value: string }
  | { ok: false; message: string }

const fail = (message: string): DomainCheck => ({ ok: false, message })

const LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const TLD_REGEX = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

// نطاقات داخلية/محجوزة ما ينفعش تتحمي
const RESERVED_DOMAIN = 'localhost'
const RESERVED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home.arpa',
  '.invalid',
  '.onion',
] as const

/**
 * نطاقات المنصة نفسها (مثلًا zeroplus.app) عشان شركة ما تسجلهاش.
 * في .env:  PLATFORM_DOMAINS=zeroplus.app,zeroplus.com
 */
function getPlatformDomains(): string[] {
  return (process.env.PLATFORM_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean)
}

/**
 * توحيد الدومين + التحقق منه (للإنشاء والتعديل).
 */
export function normalizeDomain(raw: string): DomainCheck {
  let value = raw.trim().toLowerCase()

  if (!value) return fail('النطاق مطلوب')

  if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) {
    return fail('اكتب اسم النطاق فقط بدون http:// أو https://')
  }

  if (/[\s/?#@\\]/.test(value)) {
    return fail('اكتب اسم النطاق فقط (بدون مسار أو مسافات أو رموز إضافية)')
  }

  if (value.startsWith('*.')) {
    return fail(
      'نطاقات wildcard (*.example.com) غير مدعومة، أضف كل نطاق فرعي على حدة',
    )
  }

  if (value.includes(':')) {
    return fail('لا تكتب رقم المنفذ مع النطاق، استخدم حقل originPort')
  }

  value = value.replace(/\.$/, '')

  const ascii = domainToASCII(value)

  if (!ascii) return fail('صيغة النطاق غير صحيحة')

  if (isIP(ascii)) return fail('النطاق لا يمكن أن يكون عنوان IP')

  if (ascii.length > 253) return fail('النطاق طويل جدًا')

  const labels = ascii.split('.')

  if (labels.length < 2) {
    return fail('النطاق يجب أن يحتوي على امتداد (مثال: shop.example.com)')
  }

  if (!labels.every((label) => LABEL_REGEX.test(label))) {
    return fail(
      'صيغة النطاق غير صحيحة (حروف وأرقام وشرطة فقط، والشرطة لا تكون أول أو آخر الجزء)',
    )
  }

  if (!TLD_REGEX.test(labels[labels.length - 1]!)) {
    return fail('امتداد النطاق غير صحيح')
  }

  if (
    ascii === RESERVED_DOMAIN ||
    RESERVED_SUFFIXES.some((suffix) => ascii.endsWith(suffix))
  ) {
    return fail('هذا النطاق داخلي أو محجوز ولا يمكن حمايته')
  }

  if (getPlatformDomains().some((d) => ascii === d || ascii.endsWith(`.${d}`))) {
    return fail('هذا النطاق تابع للمنصة ولا يمكن تسجيله')
  }

  return { ok: true, value: ascii }
}

/**
 * توحيد الـ Host القادم من الـ Gateway أو من تأكيد الحذف.
 */
export function normalizeHostHeader(raw: string): string | null {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/:\d{1,5}$/, '')
    .replace(/\.$/, '')

  if (!host) return null

  const ascii = domainToASCII(host)

  if (!ascii || ascii.length > 253) return null

  if (!ascii.split('.').every((label) => LABEL_REGEX.test(label))) return null

  return ascii
}

// ==================================================================
// 5) عنوان الـ Origin (IPv4 فقط في الـ MVP) — لمسار ORIGIN فقط
// ==================================================================

export type IpClass = 'PUBLIC' | 'PRIVATE' | 'FORBIDDEN'

export function classifyIPv4(ip: string): IpClass {
  const [a, b] = ip.split('.').map(Number) as [number, number]

  if (a === 0) return 'FORBIDDEN'
  if (a >= 224) return 'FORBIDDEN'
  if (a === 169 && b === 254) return 'FORBIDDEN'

  if (a === 127) return 'PRIVATE'
  if (a === 10) return 'PRIVATE'
  if (a === 172 && b >= 16 && b <= 31) return 'PRIVATE'
  if (a === 192 && b === 168) return 'PRIVATE'
  if (a === 100 && b >= 64 && b <= 127) return 'PRIVATE'

  return 'PUBLIC'
}

export function allowPrivateOrigins(): boolean {
  const flag = process.env.ALLOW_PRIVATE_ORIGINS

  if (flag === 'true') return true
  if (flag === 'false') return false

  return process.env.NODE_ENV !== 'production'
}

export type OriginIpCheck =
  | { ok: true; value: string }
  | { ok: false; message: string }

export function validateOriginIp(raw: string): OriginIpCheck {
  const value = raw.trim()

  if (!value) return { ok: false, message: 'عنوان IP مطلوب' }

  const version = isIP(value)

  if (version === 6) {
    return { ok: false, message: 'IPv6 غير مدعوم حاليًا، استخدم عنوان IPv4' }
  }

  if (version !== 4) {
    return { ok: false, message: 'صيغة عنوان IP غير صحيحة' }
  }

  const ipClass = classifyIPv4(value)

  if (ipClass === 'FORBIDDEN') {
    return {
      ok: false,
      message:
        'هذا العنوان محجوز ولا يمكن استخدامه (عنوان خاص بالنظام أو الشبكة أو Cloud Metadata)',
    }
  }

  if (ipClass === 'PRIVATE' && !allowPrivateOrigins()) {
    return {
      ok: false,
      message:
        'يجب أن يكون الـ Origin عنوان IP عامًا (العناوين الداخلية غير مسموحة)',
    }
  }

  return { ok: true, value }
}

// ==================================================================
// 6) المنفذ
// ==================================================================

const BLOCKED_ORIGIN_PORTS: ReadonlySet<number> = new Set([
  22, 23, 25, 110, 143, 465, 587, 993, 995, 1433, 3306, 5432, 6379, 9200,
  11211, 27017,
])

/** القيم الافتراضية المخزّنة لسيرفر Guard (مش بتُستخدم، بس الأعمدة لها defaults) */
const GUARD_DEFAULT_ORIGIN_PORT = 443
const GUARD_DEFAULT_SSL_ENABLED = true

// ==================================================================
// 7) تعريف الحقول (مرة واحدة)
// ==================================================================

const domainField = z
  .string({ message: 'النطاق مطلوب' })
  .max(300, 'النطاق طويل جدًا')
  .transform((raw, ctx) => {
    const result = normalizeDomain(raw)

    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.message })
      return z.NEVER
    }

    return result.value
  })

const originIpField = z
  .string({ message: 'عنوان IP مطلوب' })
  .max(45, 'صيغة عنوان IP غير صحيحة')
  .transform((raw, ctx) => {
    const result = validateOriginIp(raw)

    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.message })
      return z.NEVER
    }

    return result.value
  })

const originPortField = z
  .number({ message: 'المنفذ يجب أن يكون رقمًا' })
  .int('المنفذ يجب أن يكون رقمًا صحيحًا')
  .min(1, 'المنفذ يجب أن يكون بين 1 و 65535')
  .max(65535, 'المنفذ يجب أن يكون بين 1 و 65535')
  .refine((port) => !BLOCKED_ORIGIN_PORTS.has(port), {
    message: 'هذا المنفذ مخصص لخدمة غير ويب ولا يمكن استخدامه كـ Origin',
  })

const sslEnabledField = z.boolean({
  message: 'sslEnabled يجب أن يكون true أو false',
})

const modeField = z.enum(SERVER_MODES, {
  message: 'mode يجب أن يكون PROTECT أو MONITOR_ONLY',
})

const setupModeField = z.enum(SERVER_SETUP_MODES, {
  message: 'setupMode يجب أن يكون ORIGIN أو GUARD',
})

/** null / undefined / نص فاضي = "مش مبعوت" */
const isBlank = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '')

// ==================================================================
// 8) إنشاء سيرفر  (POST /servers)
// ==================================================================
//
//   ORIGIN: domain + originIp (إلزامي) + originPort + sslEnabled (اختياريين)
//   GUARD : domain فقط. أي originIp / originPort / sslEnabled مبعوتين
//           بالغلط بيتتجاهلوا ولا يتخزنوا (originIp = null دايمًا).
//
// الناتج union مميّز بـ setupMode، فالـ service يعمل narrowing مباشر:
//   if (input.setupMode === 'ORIGIN') { input.originIp  // string }
//   else                              { input.originIp  // null   }

export interface CreateOriginServerInput {
  setupMode: 'ORIGIN'
  domain: string
  originIp: string
  originPort: number
  sslEnabled: boolean
  mode: ServerMode | undefined
}

export interface CreateGuardServerInput {
  setupMode: 'GUARD'
  domain: string
  originIp: null
  originPort: number
  sslEnabled: boolean
  mode: ServerMode | undefined
}

export type CreateServerInput =
  | CreateOriginServerInput
  | CreateGuardServerInput

export const createServerSchema = z
  .object({
    setupMode: setupModeField.default(DEFAULT_SETUP_MODE),
    domain: domainField,

    // حقول الأصل: بتتفحص جوه الـ transform حسب الوضع، مش هنا
    originIp: z.unknown().optional(),
    originPort: z.unknown().optional(),
    sslEnabled: z.unknown().optional(),

    mode: modeField.optional(),
  })
  .strict()
  .transform((data, ctx): CreateServerInput => {
    // ---------------- GUARD ----------------
    if (data.setupMode === 'GUARD') {
      return {
        setupMode: 'GUARD',
        domain: data.domain,
        originIp: null,
        originPort: GUARD_DEFAULT_ORIGIN_PORT,
        sslEnabled: GUARD_DEFAULT_SSL_ENABLED,
        mode: data.mode,
      }
    }

    // ---------------- ORIGIN ----------------
    let hasIssues = false

    const report = (path: string, message: string) => {
      hasIssues = true
      ctx.addIssue({ code: 'custom', message, path: [path] })
    }

    // originIp (إلزامي)
    let originIp = ''
    if (isBlank(data.originIp)) {
      report('originIp', 'عنوان IP الأصل مطلوب عند اختيار وضع Origin')
    } else {
      const parsed = originIpField.safeParse(data.originIp)
      if (parsed.success) {
        originIp = parsed.data
      } else {
        report(
          'originIp',
          parsed.error.issues[0]?.message ?? 'عنوان IP غير صحيح',
        )
      }
    }

    // originPort (اختياري → 443)
    let originPort = 443
    if (!isBlank(data.originPort)) {
      const parsed = originPortField.safeParse(data.originPort)
      if (parsed.success) {
        originPort = parsed.data
      } else {
        report(
          'originPort',
          parsed.error.issues[0]?.message ?? 'المنفذ غير صحيح',
        )
      }
    }

    // sslEnabled (اختياري → حسب المنفذ)
    let sslEnabled: boolean | undefined
    if (data.sslEnabled !== undefined && data.sslEnabled !== null) {
      const parsed = sslEnabledField.safeParse(data.sslEnabled)
      if (parsed.success) {
        sslEnabled = parsed.data
      } else {
        report(
          'sslEnabled',
          parsed.error.issues[0]?.message ?? 'sslEnabled غير صحيح',
        )
      }
    }

    if (hasIssues) return z.NEVER

    return {
      setupMode: 'ORIGIN',
      domain: data.domain,
      originIp,
      originPort,
      sslEnabled: sslEnabled ?? originPort !== 80,
      mode: data.mode,
    }
  })

// ==================================================================
// 9) تعديل سيرفر  (PATCH /servers/:id)
// ==================================================================
//
// - setupMode ما يتغيرش بعد الإنشاء. مقبول في الـ body فقط لو نفس
//   القيمة الحالية (عشان الفرونت اللي بيبعت الكائن كله)، ويتشال من
//   البيانات قبل الحفظ.
// - سيرفر GUARD: يرفض originIp / originPort / sslEnabled.
// - سيرفر ORIGIN: originIp ما ينفعش يتفرّغ.
//
// الـ schema بتتحقق من الشكل بس، وقواعد الوضع بتتطبّق في
// resolveServerUpdate() بعد ما الـ service يجيب السيرفر الحالي.

export const updateServerSchema = z
  .object({
    domain: domainField,
    originIp: originIpField,
    originPort: originPortField,
    sslEnabled: sslEnabledField,
    mode: modeField,
    setupMode: setupModeField,
  })
  .partial()
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'يجب إرسال حقل واحد على الأقل للتعديل',
  })

/** البيانات الجاهزة للحفظ (من غير setupMode) */
export type ResolvedServerUpdate = Omit<
  z.infer<typeof updateServerSchema>,
  'setupMode'
>

/**
 * يطبّق قواعد وضع الربط على التعديل.
 * يرمي Error(<SetupModeErrorCode>) عند المخالفة، أو يرجّع البيانات
 * النظيفة للحفظ.
 *
 * الاستخدام في الـ service:
 *   const input = updateServerSchema.parse(body)
 *   const data  = resolveServerUpdate(existingServer, input)
 *   await prisma.server.update({ where: { id }, data })
 */
export function resolveServerUpdate(
  existing: { setupMode: ServerSetupMode },
  input: z.infer<typeof updateServerSchema>,
): ResolvedServerUpdate {
  const { setupMode, ...data } = input

  if (setupMode !== undefined && setupMode !== existing.setupMode) {
    throw new Error('SETUP_MODE_IMMUTABLE' satisfies SetupModeErrorCode)
  }

  if (
    !supportsFeature(existing.setupMode, 'ORIGIN_FIELDS') &&
    (data.originIp !== undefined ||
      data.originPort !== undefined ||
      data.sslEnabled !== undefined)
  ) {
    throw new Error(
      'ORIGIN_FIELDS_NOT_ALLOWED_FOR_GUARD' satisfies SetupModeErrorCode,
    )
  }

  if (!Object.values(data).some((value) => value !== undefined)) {
    throw new Error('EMPTY_UPDATE' satisfies SetupModeErrorCode)
  }

  return data
}

// ==================================================================
// 10) Params / Query / Actions للـ Dashboard
// ==================================================================

export const serverIdParamsSchema = z.object({
  id: z.string({ message: 'معرف السيرفر مطلوب' }).uuid('معرف السيرفر غير صالح'),
})

const queryBoolean = z
  .enum(['true', 'false'], { message: 'القيمة يجب أن تكون true أو false' })
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'))

const queryInt = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .default(String(fallback))
    .transform((value) => Number(value))
    .pipe(
      z
        .number({ message: 'القيمة يجب أن تكون رقمًا' })
        .int('القيمة يجب أن تكون رقمًا صحيحًا')
        .min(min, `القيمة يجب ألا تقل عن ${min}`)
        .max(max, `القيمة يجب ألا تزيد عن ${max}`),
    )

export const listServersQuerySchema = z.object({
  page: queryInt(1, 1, 100_000),
  limit: queryInt(20, 1, 100),

  status: z.enum(SERVER_STATUSES).optional(),
  mode: z.enum(SERVER_MODES).optional(),

  /** ORIGIN | GUARD — تصفية القائمة حسب وضع الربط */
  setupMode: z.enum(SERVER_SETUP_MODES).optional(),

  /** خاص بـ ORIGIN */
  dnsVerified: queryBoolean,

  /** خاص بـ GUARD (النفق شغال دلوقتي؟) */
  tunnelUp: queryBoolean,

  search: z.string().trim().min(1).max(100).optional(),

  sortBy: z
    .enum(['createdAt', 'updatedAt', 'domain', 'status', 'lastAgentAt'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export const VERIFY_STEPS = ['ownership', 'routing', 'all'] as const

/** POST /:id/verify — لسيرفرات ORIGIN فقط (الـ service يستدعي assertFeature('DNS_VERIFY')) */
export const verifyServerSchema = z
  .object({
    step: z.enum(VERIFY_STEPS).default('all'),
  })
  .strict()

export const maintenanceSchema = z
  .object({
    enabled: z.boolean({ message: 'enabled يجب أن يكون true أو false' }),
  })
  .strict()

export const hostSchema = z
  .string({ message: 'host مطلوب' })
  .trim()
  .min(1, 'host مطلوب')
  .max(300, 'host طويل جدًا')
  .transform((raw, ctx) => {
    const host = normalizeHostHeader(raw)

    if (!host) {
      ctx.addIssue({ code: 'custom', message: 'host غير صالح' })
      return z.NEVER
    }

    return host
  })

export const deleteServerQuerySchema = z.object({
  confirmDomain: hostSchema,
})

// ==================================================================
// 11) الـ Gateway
// ==================================================================

export const gatewayServersQuerySchema = z.object({
  limit: queryInt(500, 1, 1000),
  cursor: z.string().uuid('cursor غير صالح').optional(),
  updatedSince: z
    .string()
    .datetime({
      message: 'updatedSince يجب أن يكون تاريخ ISO بصيغة UTC (ينتهي بـ Z)',
    })
    .optional(),
})

export const gatewayServerResolveQuerySchema = z.object({
  host: hostSchema,
})

// ---- POST /internal/gateway/servers/:id/health ----
// يدعم تقارير الصحة العادية + نتائج Origin Probe الكاملة (ORIGIN فقط)

const probeStepSchema = z.object({
  connections: z.number().int().min(1).max(2000),
  rps: z.number().int().min(0),
  p99Ms: z.number().int().min(0),
  errorRate: z.number().min(0).max(100),
})

export const gatewayHealthReportSchema = z
  .object({
    originReachable: z.boolean().optional(),
    gatewayReachable: z.boolean().optional(),
    avgResponseTimeMs: z.number().int().min(0).max(600_000).optional(),
    p95ResponseTimeMs: z.number().int().min(0).max(600_000).optional(),
    loadLatencyP99Ms: z.number().int().min(0).max(600_000).optional(),
    currentLoadPercent: z.number().min(0).max(100).optional(),
    maxRequestsPerSecond: z.number().int().min(0).optional(),
    safeRequestsPerSecond: z.number().int().min(0).optional(),
    probeErrorRate: z.number().min(0).max(100).optional(),
    probeConfidence: z.enum(['high', 'medium', 'low']).optional(),
    probeRecommendation: z
      .enum(['excellent', 'good', 'fair', 'poor', 'down'])
      .optional(),
    probeDetails: z
      .object({
        steps: z.array(probeStepSchema).max(20),
        runs: z.array(z.object({ rps: z.number().int().min(0) })).max(10),
        saturated: z.boolean().optional(),
        redirected: z.boolean().optional(),
      })
      .optional(),
    lastError: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (d) =>
      Object.entries(d).some(
        ([k, v]) => k !== 'lastError' && v !== undefined,
      ),
    { message: 'يجب إرسال قيمة صحة واحدة على الأقل' },
  )

export type GatewayHealthReport = z.infer<typeof gatewayHealthReportSchema>

/** حقول الـ Origin Probe: لا تنطبق على سيرفر GUARD (سعته بتيجي من الـ Agent) */
const ORIGIN_ONLY_HEALTH_FIELDS = [
  'originReachable',
  'loadLatencyP99Ms',
  'maxRequestsPerSecond',
  'safeRequestsPerSecond',
  'probeErrorRate',
  'probeConfidence',
  'probeRecommendation',
  'probeDetails',
] as const satisfies readonly (keyof GatewayHealthReport)[]

/**
 * يشيل حقول الأصل/الـ Probe من تقرير الصحة لو السيرفر GUARD.
 * ما بيرميش خطأ (الـ Gateway يفضل يبعت نفس التقرير)، بس الـ service
 * ما يخزّنش بيانات أورجن لسيرفر ملوش أورجن.
 */
export function sanitizeHealthReportForSetupMode(
  setupMode: ServerSetupMode,
  report: GatewayHealthReport,
): GatewayHealthReport {
  if (supportsFeature(setupMode, 'ORIGIN_PROBE')) return report

  const cleaned: GatewayHealthReport = { ...report }
  for (const key of ORIGIN_ONLY_HEALTH_FIELDS) {
    delete cleaned[key]
  }
  return cleaned
}

/** هل التقرير (بعد التنظيف) لسه فيه قيمة صحة؟ لو لأ، الـ service يتجاهله */
export function hasHealthValues(report: GatewayHealthReport): boolean {
  return Object.entries(report).some(
    ([key, value]) => key !== 'lastError' && value !== undefined,
  )
}

// ==================================================================
// 12) إعدادات وتعليمات الـ DNS (ORIGIN فقط)
// ==================================================================

export const DNS_TXT_LABEL = '_zeroplus-verify'
export const DNS_TXT_VALUE_PREFIX = 'zeroplus-verify='
export const DNS_RECOMMENDED_TTL = 300

export interface DnsConfig {
  cnameTarget: string | null
  gatewayIps: string[]
}

export function readDnsConfig(env: NodeJS.ProcessEnv = process.env): DnsConfig {
  const cnameTarget =
    env.GATEWAY_CNAME_TARGET?.trim().toLowerCase().replace(/\.$/, '') || null

  const gatewayIps = (env.GATEWAY_PUBLIC_IPS ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter((ip) => isIP(ip) === 4)

  return { cnameTarget, gatewayIps }
}

export const dnsTxtRecordName = (domain: string) => `${DNS_TXT_LABEL}.${domain}`
export const dnsTxtRecordValue = (token: string) =>
  `${DNS_TXT_VALUE_PREFIX}${token}`

export interface DnsRecordInstruction {
  purpose: 'OWNERSHIP' | 'ROUTING'
  type: 'TXT' | 'CNAME' | 'A'
  name: string
  value: string
  ttl: number
  note?: string
}

export interface DnsInstructions {
  domain: string
  ownership: DnsRecordInstruction
  routing: DnsRecordInstruction[]
  steps: string[]
  warnings: string[]
}

/**
 * تعليمات DNS الكاملة — لمسار ORIGIN فقط.
 * (للتوافق: التوقيع ما اتغيرش. لو عايز رد يناسب الوضعين استخدم
 *  buildSetupInstructions تحت.)
 */
export function buildDnsInstructions(
  server: { domain: string; verificationToken: string },
  config: DnsConfig,
): DnsInstructions {
  const { domain, verificationToken } = server

  const ownership: DnsRecordInstruction = {
    purpose: 'OWNERSHIP',
    type: 'TXT',
    name: dnsTxtRecordName(domain),
    value: dnsTxtRecordValue(verificationToken),
    ttl: DNS_RECOMMENDED_TTL,
    note: 'يثبت إنك مالك الدومين. لا تحذفه بعد التحقق.',
  }

  const routing: DnsRecordInstruction[] = []

  if (config.cnameTarget) {
    routing.push({
      purpose: 'ROUTING',
      type: 'CNAME',
      name: domain,
      value: config.cnameTarget,
      ttl: DNS_RECOMMENDED_TTL,
      note: 'للنطاقات الفرعية (shop.example.com). لا يصلح مع النطاق الرئيسي.',
    })
  }

  for (const ip of config.gatewayIps) {
    routing.push({
      purpose: 'ROUTING',
      type: 'A',
      name: domain,
      value: ip,
      ttl: DNS_RECOMMENDED_TTL,
      note: 'يصلح للنطاق الرئيسي (example.com) والفرعي.',
    })
  }

  const warnings: string[] = [
    'Delete any old A/CNAME record for this domain before adding the routing record, otherwise traffic will keep going straight to the origin server without protection.',
    'After activation, lock down the origin server to the Gateway addresses only (Firewall). If the attacker knows the origin IP, they will attack it directly and bypass the protection.',
  ]

  if (routing.length === 0) {
    warnings.unshift(
      'إعدادات توجيه الـ Gateway (GATEWAY_CNAME_TARGET / GATEWAY_PUBLIC_IPS) غير مضبوطة في السيرفر.',
    )
  }
  return {
    domain,
    ownership,
    routing,
    steps: [
      'Add a TXT record to verify domain ownership in your DNS panel.',
      'Click "Verify" (step: ownership) after the record has propagated (it may take a few minutes).',
      'Point the domain to the Gateway using a CNAME or A record (only one of them).',
      'Click "Verify" (step: routing). If it succeeds, traffic will start flowing through the protection.',
      'Start with MONITOR_ONLY mode to observe decisions, then switch to PROTECT.',
    ],
    warnings,
  }
}

// ------------------------------------------------------------------
// خطوات التفعيل حسب الوضع (للرد على POST /servers و GET /servers/:id/setup)
// ------------------------------------------------------------------

export interface GuardInstructions {
  /** الخطوة اللي الواجهة تعرض زرارها بعد الإنشاء */
  nextAction: 'ENABLE_TUNNEL'
  steps: string[]
  warnings: string[]
}

export type ServerSetupInstructions =
  | { setupMode: 'ORIGIN'; dns: DnsInstructions; guard: null }
  | { setupMode: 'GUARD'; dns: null; guard: GuardInstructions }

export function buildGuardInstructions(): GuardInstructions {
  return {
    nextAction: 'ENABLE_TUNNEL',
    steps: [
      'Click "Enable tunnel" to generate the agent token and the install command.',
      'Run the install command on your server (Linux or Windows). The token is shown only once.',
      'Wait for the first heartbeat: the tunnel status will turn ONLINE automatically.',
      'Start with MONITOR_ONLY mode to observe decisions, then switch to PROTECT.',
    ],
    warnings: [
      'Keep the agent token secret. If it leaks, rotate it from the server page.',
      'No origin IP or DNS routing record is required for Guard servers.',
    ],
  }
}

/**
 * يبني التعليمات المناسبة لوضع السيرفر:
 *   ORIGIN → تعليمات DNS كاملة
 *   GUARD  → خطوات النفق فقط (من غير CNAME/TXT إجباريين)
 */
export function buildSetupInstructions(
  server: {
    setupMode: ServerSetupMode
    domain: string
    verificationToken: string
  },
  config: DnsConfig,
): ServerSetupInstructions {
  if (server.setupMode === 'GUARD') {
    return { setupMode: 'GUARD', dns: null, guard: buildGuardInstructions() }
  }

  return {
    setupMode: 'ORIGIN',
    dns: buildDnsInstructions(server, config),
    guard: null,
  }
}

// ==================================================================
// 13) أشكال الردود (يبنيها الـ Service)
// ==================================================================

export interface DnsCheckResult {
  verified: boolean
  expected: string[]
  found: string[]
  checkedAt: string
  message: string
}

export interface DnsVerificationResult {
  ownership?: DnsCheckResult
  routing?: DnsCheckResult
  server: {
    id: string
    status: ServerStatus
    dnsVerified: boolean
    gatewayReachable: boolean
  }
}

/** السيرفر بالشكل اللي الـ Gateway بيستخدمه */
export interface GatewayServerPayload {
  id: string
  domain: string
  organizationId: string

  /** ORIGIN = توجيه مباشر للأصل | GUARD = توجيه عبر النفق */
  setupMode: ServerSetupMode

  /** null لسيرفرات GUARD */
  originIp: string | null
  originPort: number
  sslEnabled: boolean

  status: ServerStatus
  mode: ServerMode
  dnsVerified: boolean
  gatewayReachable: boolean
  originReachable: boolean

  /** GUARD: حالة النفق وعنوان الـ peer اللي الـ Gateway يوجّه عليه */
  tunnelUp: boolean
  tunnelPeerIp: string | null
  lastAgentAt: string | null

  maxRequestsPerSecond: number | null
  /** رقم التسعير الآمن (ORIGIN: من آخر Probe | GUARD: من تقدير الـ Agent) */
  safeRequestsPerSecond: number | null
  updatedAt: string
}

export interface GatewayServersListResult {
  servers: GatewayServerPayload[]
  nextCursor: string | null
  serverTime: string
}

// ==================================================================
// 14) Types
// ==================================================================

export type UpdateServerInput = z.infer<typeof updateServerSchema>
export type ServerIdParams = z.infer<typeof serverIdParamsSchema>
export type ListServersQuery = z.infer<typeof listServersQuerySchema>
export type VerifyServerInput = z.infer<typeof verifyServerSchema>
export type MaintenanceInput = z.infer<typeof maintenanceSchema>
export type DeleteServerQuery = z.infer<typeof deleteServerQuerySchema>
export type GatewayServersQuery = z.infer<typeof gatewayServersQuerySchema>
export type GatewayServerResolveQuery = z.infer<
  typeof gatewayServerResolveQuerySchema
>