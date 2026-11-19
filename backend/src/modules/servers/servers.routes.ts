// backend/src/modules/servers/servers.routes.ts
// ==================================================================
// Zero Plus - Servers Routes (Dashboard / JWT)
// ------------------------------------------------------------------
// prefix: /servers  (متسجل في app.ts)
//
//   POST   /                         إنشاء سيرفر (ORIGIN: + DNS | GUARD: + خطوات النفق)  (OWNER, ADMIN)
//   GET    /                         قائمة + فلاتر (setupMode / tunnelUp) + pagination    (أي مستخدم)
//   GET    /:id                      تفاصيل سيرفر                                         (أي مستخدم)
//   GET    /:id/dns                  تعليمات الـ DNS (ORIGIN فقط)                         (أي مستخدم)
//   GET    /:id/setup                خطوات الإعداد حسب الوضع (DNS | نفق)                  (أي مستخدم)
//   PATCH  /:id                      تعديل (بقواعد حسب وضع الربط)                         (OWNER, ADMIN)
//   POST   /:id/verify               فحص الـ DNS (ORIGIN فقط)                             (OWNER, ADMIN)
//   POST   /:id/probe                إعادة قياس السعة (ORIGIN فقط)                        (OWNER, ADMIN)
//   POST   /:id/maintenance          تشغيل/إيقاف الصيانة                                  (OWNER, ADMIN)
//   DELETE /:id?confirmDomain=       حذف بتأكيد الدومين                                   (OWNER, ADMIN)
//
// وضع الربط (setupMode: ORIGIN | GUARD):
//   - بيتحدد في body الإنشاء فقط (الافتراضي ORIGIN لو مش مبعوت)
//   - createServerSchema هي اللي بتتحقق منه وبتمرره للـ service
//   - verify / probe / dns لسيرفر GUARD بيرجعوا 409 من الـ service
//     (الـ route مفيهوش منطق خاص بالوضع، بيحوّل خطأ الـ service لـ HTTP بس)
//
// مسارات الـ Agent (enable-tunnel / rotate / disable / heartbeat) مش هنا،
// ليها موديول/ملف راوتس خاص بيها.
//
// قواعد:
//   1) organizationId بييجي من JWT فقط (مش من body/query/params)
//   2) السيرفر بيأثر على توجيه الترافيك، فالتعديل للـ OWNER/ADMIN فقط
//   3) كل الـ Validation بـ Zod، وكل أخطاء الـ Service بتتحول لـ HTTP هنا
// ==================================================================

import type { ServerSetupMode } from '@prisma/client'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodError } from 'zod'

import { ServerServiceError, ServersService } from './servers.service.js'

import {
  SETUP_MODE_ERRORS,
  createServerSchema,
  deleteServerQuerySchema,
  getServerCapabilities,
  listServersQuerySchema,
  maintenanceSchema,
  serverIdParamsSchema,
  updateServerSchema,
  verifyServerSchema,
} from './servers.schema.js'
import type { SetupModeErrorCode } from './servers.schema.js'

const SERVER_MANAGE_ROLES: string[] = ['OWNER', 'ADMIN']

// ==================================================================
// Helpers
// ==================================================================

function formatZodIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.') || '(body)',
    message: issue.message,
  }))
}

function sendValidationError(
  reply: FastifyReply,
  message: string,
  error: ZodError,
) {
  return reply.status(400).send({
    success: false,
    code: 'VALIDATION_ERROR',
    message,
    errors: formatZodIssues(error),
  })
}

/** رسالة نجاح الإنشاء (201) حسب وضع الربط */
function createdMessage(setupMode: ServerSetupMode): string {
  return setupMode === 'GUARD'
    ? 'تم إضافة السيرفر. الخطوة التالية: فعّل الـ Guard (النفق) لتوليد توكن الـ Agent وأمر التثبيت'
    : 'تم إضافة السيرفر. اتبع تعليمات الـ DNS لتفعيل الحماية'
}

function isSetupModeErrorCode(value: string): value is SetupModeErrorCode {
  return Object.prototype.hasOwnProperty.call(SETUP_MODE_ERRORS, value)
}

function handleRouteError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  if (error instanceof ServerServiceError) {
    // Retry-After للتحقق المتكرر / تبريد القياس
    if (error.statusCode === 429) {
      const retry = (error.details as { retryAfterSec?: number } | undefined)
        ?.retryAfterSec

      if (retry) reply.header('Retry-After', String(retry))
    }

    return reply.status(error.statusCode).send({
      success: false,
      code: error.code,
      message: error.message,
      ...(error.details !== undefined && { details: error.details }),
    })
  }

  // أخطاء قواعد وضع الربط لو اترمت خام (Error(<code>)) من أي مكان
  if (error instanceof Error && isSetupModeErrorCode(error.message)) {
    const info = SETUP_MODE_ERRORS[error.message]

    return reply.status(info.status).send({
      success: false,
      code: info.code,
      message: info.messageAr,
    })
  }

  request.log.error({ err: error }, 'Servers route error')

  return reply.status(500).send({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  })
}

// ==================================================================
// Routes
// ==================================================================

export async function serverRoutes(fastify: FastifyInstance) {
  const service = new ServersService(fastify)

  const manage = {
    preHandler: [
      fastify.authenticate,
      fastify.requireRole(SERVER_MANAGE_ROLES),
    ],
  }

  const read = { preHandler: [fastify.authenticate] }

  // ================================================================
  // POST /servers
  // Body:
  //   ORIGIN (الافتراضي): { domain, originIp, originPort?, sslEnabled?, mode? }
  //   GUARD             : { setupMode: "GUARD", domain, mode? }
  // setupMode بيتحقق منه createServerSchema (والـ schema strict).
  // ================================================================
  fastify.post('/', manage, async (request, reply) => {
    const parsed = createServerSchema.safeParse(request.body)

    if (!parsed.success) {
      return sendValidationError(reply, 'بيانات السيرفر غير صالحة', parsed.error)
    }

    try {
      const { organizationId } = request.user

      const result = await service.createServer(organizationId, parsed.data)

      return reply.status(201).send({
        success: true,
        message: createdMessage(result.setupMode),
        data: result.server,
        setupMode: result.setupMode,
        capabilities: result.capabilities,
        // ORIGIN: تعليمات DNS (غير موجودة لـ GUARD)
        ...(result.dns && { dns: result.dns }),
        // GUARD: خطوات تفعيل النفق (غير موجودة لـ ORIGIN)
        ...(result.guard && { guard: result.guard }),
      })
    } catch (error) {
      return handleRouteError(request, reply, error)
    }
  })

  // ================================================================
  // GET /servers?page=&limit=&status=&mode=&setupMode=&dnsVerified=&tunnelUp=
  //             &search=&sortBy=&sortOrder=
  // ================================================================
  fastify.get('/', read, async (request, reply) => {
    const parsed = listServersQuerySchema.safeParse(request.query)

    if (!parsed.success) {
      return sendValidationError(reply, 'معلمات الاستعلام غير صالحة', parsed.error)
    }

    try {
      const { organizationId } = request.user

      const result = await service.listServers(organizationId, parsed.data)

      return reply.status(200).send({
        success: true,
        data: result.servers,
        pagination: result.pagination,
        summary: result.summary,
        setupSummary: result.setupSummary,
      })
    } catch (error) {
      return handleRouteError(request, reply, error)
    }
  })

  // ================================================================
  // GET /servers/:id
  // ================================================================
  fastify.get('/:id', read, async (request, reply) => {
    const params = serverIdParamsSchema.safeParse(request.params)

    if (!params.success) {
      return sendValidationError(reply, 'معرف السيرفر غير صالح', params.error)
    }

    try {
      const { organizationId } = request.user

      const server = await service.getServerById(organizationId, params.data.id)

      return reply.status(200).send({
        success: true,
        data: server,
        capabilities: getServerCapabilities(server.setupMode),
      })
    } catch (error) {
      return handleRouteError(request, reply, error)
    }
  })

  // ================================================================
  // GET /servers/:id/dns
  // ORIGIN فقط — لسيرفر GUARD الـ service يرد 409
  // ================================================================
  fastify.get('/:id/dns', read, async (request, reply) => {
    const params = serverIdParamsSchema.safeParse(request.params)

    if (!params.success) {
      return sendValidationError(reply, 'معرف السيرفر غير صالح', params.error)
    }

    try {
      const { organizationId } = request.user

      const { server, dns } = await service.getDnsInstructions(
        organizationId,
        params.data.id,
      )

      return reply.status(200).send({
        success: true,
        data: {
          serverId: server.id,
          status: server.status,
          dnsVerified: server.dnsVerified,
          dnsVerifiedAt: server.dnsVerifiedAt,
          gatewayReachable: server.gatewayReachable,
        },
        dns,
      })
    } catch (error) {
      return handleRouteError(request, reply, error)
    }
  })

  // ================================================================
  // GET /servers/:id/setup
  // خطوات الإعداد حسب وضع السيرفر:
  //   ORIGIN → dns | GUARD → guard (خطوات النفق)
  // (مسار إضافي: بيسمح للواجهة تعيد عرض الخطوات بعد refresh)
  // ================================================================
  fastify.get('/:id/setup', read, async (request, reply) => {
    const params = serverIdParamsSchema.safeParse(request.params)

    if (!params.success) {
      return sendValidationError(reply, 'معرف السيرفر غير صالح', params.error)
    }

    try {
      const { organizationId } = request.user

      const result = await service.getSetupInstructions(
        organizationId,
        params.data.id,
      )

      return reply.status(200).send({
        success: true,
        data: {
          serverId: result.server.id,
          status: result.server.status,
          setupMode: result.setupMode,
          dnsVerified: result.server.dnsVerified,
          gatewayReachable: result.server.gatewayReachable,
          tunnelUp: result.server.tunnelUp,
          lastAgentAt: result.server.lastAgentAt,
        },
        capabilities: result.capabilities,
        ...(result.dns && { dns: result.dns }),
        ...(result.guard && { guard: result.guard }),
      })
    } catch (error) {
      return handleRouteError(request, reply, error)
    }
  })

  // ================================================================
  // PATCH /servers/:id
  // Body (واحد على الأقل): { domain?, originIp?, originPort?, sslEnabled?, mode?, setupMode? }
  //   - setupMode مقبول بس لو نفس القيمة الحالية (غير كده 400 SETUP_MODE_IMMUTABLE)
  //   - GUARD: originIp / originPort / sslEnabled مرفوضين (400)
  // ================================================================
  fastify.patch('/:id', manage, async (request, reply) => {
    const params = serverIdParamsSchema.safeParse(request.params)

    if (!params.success) {
      return sendValidationError(reply, 'معرف السيرفر غير صالح', params.error)
    }

    const body = updateServerSchema.safeParse(request.body)

    if (!body.success) {
      return sendValidationError(reply, 'بيانات التعديل غير صالحة', body.error)
    }

    try {
      const { organizationId } = request.user

      const result = await service.updateServer(
        organizationId,
        params.data.id,
        body.data,
      )

      return reply.status(200).send({
        success: true,
        message:
          result.changes.length === 0
            ? 'لا يوجد تغيير: القيم المبعوتة مطابقة للحالية'
            : result.dns
              ? 'تم التعديل. الدومين اتغير فلازم تعيد التحقق بسجل TXT الجديد'
              : 'تم تعديل السيرفر',
        data: result.server,
        changes: result.changes,
        resets: result.resets,
        ...(result.dns && { dns: result.dns }),
      })
    } catch (error) {
      return handleRouteError(request, reply, error)
    }
  })

  // ================================================================
  // POST /servers/:id/verify
  // Body (اختياري): { "step": "ownership" | "routing" | "all" }  (الافتراضي all)
  // ORIGIN فقط — لسيرفر GUARD الـ service يرد 409
  // ================================================================
  fastify.post('/:id/verify', manage, async (request, reply) => {
    const params = serverIdParamsSchema.safeParse(request.params)

    if (!params.success) {
      return sendValidationError(reply, 'معرف السيرفر غير صالح', params.error)
    }

    const body = verifyServerSchema.safeParse(request.body ?? {})

    if (!body.success) {
      return sendValidationError(reply, 'بيانات التحقق غير صالحة', body.error)
    }

    try {
      const { organizationId } = request.user

      const result = await service.verifyServer(
        organizationId,
        params.data.id,
        body.data,
      )

      const ownershipOk = result.ownership?.verified ?? result.server.dnsVerified
      const routingOk = result.routing?.verified ?? result.server.gatewayReachable

      return reply.status(200).send({
        success: true,
        message:
          ownershipOk && routingOk
            ? 'تم التحقق: الدومين مملوك لك وموجّه للـ Gateway'
            : ownershipOk
              ? 'تم إثبات الملكية. الخطوة الجاية: وجّه الدومين للـ Gateway'
              : 'لم يتم التحقق بعد. راجع نتيجة الفحص',
        data: result,
      })
    } catch (error) {
      return handleRouteError(request, reply, error)
    }
  })

  // ================================================================
  // POST /servers/:id/probe
  // إعادة قياس السعة (Origin Probe) — OWNER, ADMIN
  // ORIGIN فقط — لسيرفر GUARD الـ service يرد 409 PROBE_NOT_AVAILABLE_FOR_GUARD
  // يرد 202 فورًا؛ النتيجة توصل عبر Socket بعد انتهاء القياس
  // ================================================================
  fastify.post('/:id/probe', manage, async (request, reply) => {
    const params = serverIdParamsSchema.safeParse(request.params)

    if (!params.success) {
      return sendValidationError(reply, 'معرف السيرفر غير صالح', params.error)
    }

    try {
      await service.requestProbe(request.user.organizationId, params.data.id)

      return reply.status(202).send({
        success: true,
        message: 'تم بدء القياس. النتيجة هتوصل خلال دقيقتين تقريباً',
      })
    } catch (error) {
      return handleRouteError(request, reply, error)
    }
  })

  // ================================================================
  // POST /servers/:id/maintenance
  // Body: { "enabled": true | false }
  // ================================================================
  fastify.post('/:id/maintenance', manage, async (request, reply) => {
    const params = serverIdParamsSchema.safeParse(request.params)

    if (!params.success) {
      return sendValidationError(reply, 'معرف السيرفر غير صالح', params.error)
    }

    const body = maintenanceSchema.safeParse(request.body)

    if (!body.success) {
      return sendValidationError(
        reply,
        'enabled مطلوب (true أو false)',
        body.error,
      )
    }

    try {
      const { organizationId } = request.user

      const server = await service.setMaintenance(
        organizationId,
        params.data.id,
        body.data.enabled,
      )

      return reply.status(200).send({
        success: true,
        message: body.data.enabled
          ? 'تم تشغيل وضع الصيانة'
          : 'تم إيقاف وضع الصيانة',
        data: server,
      })
    } catch (error) {
      return handleRouteError(request, reply, error)
    }
  })

  // ================================================================
  // DELETE /servers/:id?confirmDomain=shop.example.com
  // ================================================================
  fastify.delete('/:id', manage, async (request, reply) => {
    const params = serverIdParamsSchema.safeParse(request.params)

    if (!params.success) {
      return sendValidationError(reply, 'معرف السيرفر غير صالح', params.error)
    }

    const query = deleteServerQuerySchema.safeParse(request.query)

    if (!query.success) {
      return sendValidationError(
        reply,
        'confirmDomain مطلوب لتأكيد الحذف',
        query.error,
      )
    }

    try {
      const { organizationId } = request.user

      const result = await service.deleteServer(
        organizationId,
        params.data.id,
        query.data.confirmDomain,
      )

      return reply.status(200).send({
        success: true,
        message: 'تم حذف السيرفر',
        data: result,
      })
    } catch (error) {
      return handleRouteError(request, reply, error)
    }
  })
}

export default serverRoutes