/**
 * backend/src/plugins/jwt.plugin.ts
 * ==================================================================
 * Zero Plus - JWT Plugin (لوحة التحكم)
 * الـ Gateway له plugin منفصل: gateway-auth.plugin.ts
 *
 * التوكن يحتوي:
 *   id · email · role · organizationId · permissions[] · passkeyId?
 *   iat · exp · (اختياري) tokenVersion
 *
 * ميزات:
 *   - authenticate          → تحقق من التوكن
 *   - requireRole           → فحص الدور (للتوافق مع القديم)
 *   - requirePermission     → فحص صلاحية واحدة أو أكثر (AND)
 *   - requireAnyPermission  → فحص أي صلاحية (OR)
 *   - enforceRoutePermissions → فحص مركزي من ROUTE_PERMISSION_RULES
 *   - refresh token خفيف    → تمديد الجلسة لو قربت تنتهي
 * ==================================================================
 */

import fp from 'fastify-plugin'
import fjwt from '@fastify/jwt'
import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify'
import {
  type Permission,
  hasPermission,
  hasAnyPermission,
  matchRoutePermissions,
  isValidPermission,
} from '../lib/permissions.js'
// ------------------------------------------------------------------
// إعدادات من الـ env
// ------------------------------------------------------------------

/** مدة صلاحية التوكن (افتراضي 7 أيام) */
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d'

/**
 * لو متبقي أقل من X ثانية على انتهاء التوكن → نرجّع توكن جديد في الهيدر
 * افتراضي: ساعة واحدة (3600)
 */
const JWT_REFRESH_WINDOW_SEC = Number(
  process.env.JWT_REFRESH_WINDOW_SEC ?? 3600,
)

/** تفعيل الفحص المركزي للمسارات تلقائيًا بعد authenticate */
const ENFORCE_ROUTE_PERMISSIONS =
  process.env.ENFORCE_ROUTE_PERMISSIONS !== '0' &&
  process.env.ENFORCE_ROUTE_PERMISSIONS !== 'false'

// ------------------------------------------------------------------
// TypeScript Declaration Merging
// ------------------------------------------------------------------

declare module '@fastify/jwt' {
  interface FastifyJWT {
    /** الشكل عند sign */
    payload: {
      id: string
      email: string
      role: string
      organizationId: string
      /** صلاحيات محسوبة وقت الإصدار */
      permissions: string[]
      /** معرف Passkey المستخدم في هذا الدخول (اختياري) */
      passkeyId?: string
      /** نسخة التوكن — لو غيّرت صلاحيات المستخدم ارفع الرقم عشان تلغي التوكنات القديمة */
      tokenVersion?: number
    }

    /** الشكل في request.user بعد jwtVerify */
    user: {
      id: string
      email: string
      role: string
      organizationId: string
      permissions: string[]
      passkeyId?: string
      tokenVersion?: number
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>

    requireRole: (
      roles: string[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>

    requirePermission: (
      permissions: Permission | Permission[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>

    requireAnyPermission: (
      permissions: Permission[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>

    /**
     * فحص مركزي: يطابق المسار مع ROUTE_PERMISSION_RULES
     * يُستخدم بعد authenticate على مستوى الـ app أو على مجموعات routes
     */
    enforceRoutePermissions: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>

    /**
     * يوقّع توكن جديد بنفس بيانات المستخدم + permissions محدّثة
     * (يُستدعى من auth.service عند login / refresh / تغيير صلاحيات)
     */
    signAccessToken: (payload: {
      id: string
      email: string
      role: string
      organizationId: string
      permissions: string[]
      passkeyId?: string
      tokenVersion?: number
    }) => string
  }

  interface FastifyRequest {
    /** صلاحيات المستخدم كـ Set للفحص السريع */
    userPermissionSet?: Set<string>
  }
}

// ------------------------------------------------------------------
// مساعدات داخلية
// ------------------------------------------------------------------

function getBearerToken(request: FastifyRequest): string | null {
  const h = request.headers.authorization
  if (!h || typeof h !== 'string') return null
  const [scheme, token] = h.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null
  return token.trim() || null
}

function buildPermissionSet(user: { permissions?: string[] }): Set<string> {
  const list = Array.isArray(user.permissions) ? user.permissions : []
  return new Set(list.filter((p) => typeof p === 'string' && p.length > 0))
}

/**
 * هل التوكن قرب ينتهي؟ → نرجع توكن جديد في الهيدر
 * من غير ما نروح للـ DB (نفس الـ payload الحالي)
 */
function maybeAttachRefreshedToken(
  fastify: Parameters<FastifyPluginAsync>[0],
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  try {
    const user = request.user
    if (!user?.id) return

    // @fastify/jwt بيحط iat/exp على الـ decoded أحيانًا
    const decoded = request.user as {
      iat?: number
      exp?: number
      id: string
      email: string
      role: string
      organizationId: string
      permissions?: string[]
      passkeyId?: string
      tokenVersion?: number
    }

    const exp = decoded.exp
    if (!exp || typeof exp !== 'number') return

    const nowSec = Math.floor(Date.now() / 1000)
    const remaining = exp - nowSec

    // لسه بدري على التجديد
    if (remaining > JWT_REFRESH_WINDOW_SEC) return
    // منتهي أصلًا (authenticate كان هيرفض)
    if (remaining <= 0) return

    const permissions = Array.isArray(decoded.permissions)
      ? decoded.permissions.filter(isValidPermission)
      : []

    const newToken = fastify.jwt.sign(
      {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        organizationId: decoded.organizationId,
        permissions,
        ...(decoded.passkeyId ? { passkeyId: decoded.passkeyId } : {}),
        ...(typeof decoded.tokenVersion === 'number'
          ? { tokenVersion: decoded.tokenVersion }
          : {}),
      },
      { expiresIn: JWT_EXPIRES_IN },
    )

    // الفرونت يقرأ الهيدر ويحدّث التوكن المحلي
    reply.header('X-Access-Token', newToken)
    reply.header('X-Access-Token-Refresh', '1')
  } catch {
    // فشل التجديد مش حرج — التوكن الحالي لسه صالح
  }
}

// ------------------------------------------------------------------
// Plugin
// ------------------------------------------------------------------

const jwtPlugin: FastifyPluginAsync = async (fastify) => {
  const secret = process.env.JWT_SECRET

  if (!secret) {
    throw new Error('❌ JWT_SECRET is missing in environment variables')
  }

  await fastify.register(fjwt, {
    secret,
    sign: {
      expiresIn: JWT_EXPIRES_IN,
    },
    // رسائل أوضح في الإنتاج ممكن تتعطّل
    messages: {
      badRequestErrorMessage: 'Format is Authorization: Bearer [token]',
      noAuthorizationInHeaderMessage: 'No Authorization was found in request headers',
      authorizationTokenExpiredMessage: 'Authorization token expired',
      authorizationTokenInvalid: 'Authorization token is invalid',
      authorizationTokenUntrusted: 'Untrusted authorization token',
    },
  })

  // ------------------------------------------------------------------
  // signAccessToken — واجهة موحّدة لتوقيع التوكن
  // ------------------------------------------------------------------

  fastify.decorate('signAccessToken', (payload) => {
    const permissions = (payload.permissions ?? []).filter(isValidPermission)

    return fastify.jwt.sign(
      {
        id: payload.id,
        email: payload.email,
        role: payload.role,
        organizationId: payload.organizationId,
        permissions,
        ...(payload.passkeyId ? { passkeyId: payload.passkeyId } : {}),
        ...(typeof payload.tokenVersion === 'number'
          ? { tokenVersion: payload.tokenVersion }
          : {}),
      },
      { expiresIn: JWT_EXPIRES_IN },
    )
  })

  // ------------------------------------------------------------------
  // authenticate
  // ------------------------------------------------------------------

  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify()
      } catch {
        return reply.status(401).send({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Unauthorized - Invalid or missing token',
        })
      }

      // تأكد من الحقول الأساسية
      const u = request.user
      if (!u?.id || !u.organizationId) {
        return reply.status(401).send({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Unauthorized - Malformed token payload',
        })
      }

      // تطبيع permissions
      if (!Array.isArray(u.permissions)) {
        ;(u as { permissions: string[] }).permissions = []
      }

      request.userPermissionSet = buildPermissionSet(u)

      // تجديد صامت لو قرب الانتهاء
      maybeAttachRefreshedToken(fastify, request, reply)
    },
  )

  // ------------------------------------------------------------------
  // requireRole — توافق مع الكود القديم
  // ------------------------------------------------------------------

  fastify.decorate('requireRole', (roles: string[]) => {
    const allowed = new Set(roles.map((r) => r.toUpperCase()))

    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.status(401).send({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        })
      }

      const role = String(request.user.role || '').toUpperCase()
      if (!allowed.has(role)) {
        return reply.status(403).send({
          success: false,
          code: 'FORBIDDEN_ROLE',
          message: 'ليس لديك صلاحية لتنفيذ هذا الإجراء',
        })
      }
    }
  })

  // ------------------------------------------------------------------
  // requirePermission — AND
  // ------------------------------------------------------------------

  fastify.decorate('requirePermission', (permissions: Permission | Permission[]) => {
    const required = Array.isArray(permissions) ? permissions : [permissions]

    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.status(401).send({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        })
      }

      const set =
        request.userPermissionSet ?? buildPermissionSet(request.user)

      if (!hasPermission(set, required)) {
        return reply.status(403).send({
          success: false,
          code: 'FORBIDDEN_PERMISSION',
          message: 'ليس لديك الصلاحية المطلوبة',
          required,
        })
      }
    }
  })

  // ------------------------------------------------------------------
  // requireAnyPermission — OR
  // ------------------------------------------------------------------

  fastify.decorate('requireAnyPermission', (permissions: Permission[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.status(401).send({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        })
      }

      const set =
        request.userPermissionSet ?? buildPermissionSet(request.user)

      if (!hasAnyPermission(set, permissions)) {
        return reply.status(403).send({
          success: false,
          code: 'FORBIDDEN_PERMISSION',
          message: 'ليس لديك أي من الصلاحيات المطلوبة',
          requiredAny: permissions,
        })
      }
    }
  })

  // ------------------------------------------------------------------
  // enforceRoutePermissions — فحص مركزي من الكتالوج
  // ------------------------------------------------------------------

  fastify.decorate(
    'enforceRoutePermissions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.status(401).send({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        })
      }

      const matched = matchRoutePermissions(request.method, request.url)

      // مفيش قاعدة → نمرّر (أو ارفض حسب سياستك)
      if (!matched) return

      const set =
        request.userPermissionSet ?? buildPermissionSet(request.user)

      const ok = matched.anyOf
        ? hasAnyPermission(set, matched.permissions)
        : hasPermission(set, matched.permissions)

      if (!ok) {
        return reply.status(403).send({
          success: false,
          code: 'FORBIDDEN_PERMISSION',
          message: 'ليس لديك صلاحية للوصول لهذا المسار',
          required: matched.permissions,
        })
      }
    },
  )

  // ------------------------------------------------------------------
  // Hook اختياري: بعد كل authenticate على routes محمية
  // تفعيله من الـ app: preHandler: [fastify.authenticate, fastify.enforceRoutePermissions]
  // أو تسيبه يدوي على كل route
  // ------------------------------------------------------------------

  if (ENFORCE_ROUTE_PERMISSIONS) {
    fastify.log.info(
      'JWT: ENFORCE_ROUTE_PERMISSIONS enabled (use enforceRoutePermissions in preHandler)',
    )
  }

  fastify.log.info('✅ JWT plugin registered successfully')
}

export default fp(jwtPlugin, {
  name: 'jwt',
  dependencies: [], // permissions.ts مش plugin
})