/**
 * backend/src/modules/agents/agents.routes.ts
 * ==================================================================
 * Zero Plus - Agent Routes
 *
 * مسارات الداشبورد (JWT + صلاحيات):
 *   POST   /servers/:serverId/enable-tunnel
 *   POST   /servers/:serverId/rotate-agent-token
 *   POST   /servers/:serverId/disable-agent
 *   GET    /servers/:serverId/agent-status
 *   GET    /servers/:serverId/heartbeats
 *
 * مسار الـ Agent الداخلي (مصادقة AGENT_TOKEN):
 *   POST   /internal/agent/heartbeat
 *
 * ملاحظة التسجيل في app.ts:
 *   - مسارات السيرفر: تُسجَّل مع servers أو كـ plugin منفصل تحت /servers
 *   - مسار heartbeat: تحت /internal/agent
 * ==================================================================
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
} from 'fastify'

import {
  enableTunnel,
  processHeartbeat,
  extractAgentToken,
  getAgentStatus,
  listHeartbeats,
  rotateAgentToken,
  disableAgent,
} from './agents.service.js'

import {
  serverIdParamsSchema,
  serverIdAliasParamsSchema,
  enableTunnelBodySchema,
  agentHeartbeatBodySchema,
  listHeartbeatsQuerySchema,
  rotateAgentTokenBodySchema,
  disableAgentBodySchema,
} from './agents.schema.js'

// ------------------------------------------------------------------
// خريطة أخطاء → HTTP
// ------------------------------------------------------------------

const ERROR_MAP: Record<
  string,
  { status: number; code: string; message: string; messageAr: string }
> = {
  SERVER_NOT_FOUND: {
    status: 404,
    code: 'SERVER_NOT_FOUND',
    message: 'Server not found in your organization',
    messageAr: 'السيرفر غير موجود في منظمتك',
  },
  USER_NOT_FOUND: {
    status: 404,
    code: 'USER_NOT_FOUND',
    message: 'User not found or inactive',
    messageAr: 'المستخدم غير موجود أو غير نشط',
  },
  INVALID_AGENT_TOKEN: {
    status: 401,
    code: 'INVALID_AGENT_TOKEN',
    message: 'Invalid or missing agent token',
    messageAr: 'توكن الـ Agent غير صالح أو مفقود',
  },
  AGENT_TOKEN_ALREADY_ISSUED: {
    status: 409,
    code: 'AGENT_TOKEN_ALREADY_ISSUED',
    message:
      'Agent token already issued. Use rotateToken: true to generate a new one.',
    messageAr:
      'تم إصدار توكن الـ Agent مسبقًا. استخدم rotateToken: true لتوليد توكن جديد.',
  },
  FORBIDDEN_ORG: {
    status: 403,
    code: 'FORBIDDEN_ORG',
    message: 'Access denied to this organization',
    messageAr: 'غير مسموح بالوصول إلى هذه المنظمة',
  },
}

function handleError(error: unknown, reply: FastifyReply) {
  const message = error instanceof Error ? error.message : String(error)
  const mapped = ERROR_MAP[message]

  if (mapped) {
    return reply.status(mapped.status).send({
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        messageAr: mapped.messageAr,
      },
    })
  }

  // أخطاء الخدمة اللي بتحمل statusCode و code (مثل AgentServiceError): نحافظ عليهم بدل 500 عام
  if (error && typeof error === 'object') {
    const e = error as { statusCode?: unknown; code?: unknown; message?: string; messageAr?: string }
    if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500 && typeof e.code === 'string') {
      return reply.status(e.statusCode).send({
        success: false,
        error: { code: e.code, message: e.message ?? e.code, ...(e.messageAr ? { messageAr: e.messageAr } : {}) },
      })
    }
  }

  // Zod
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name: string }).name === 'ZodError'
  ) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        messageAr: 'فشل التحقق من البيانات',
        details: (error as { issues?: unknown }).issues,
      },
    })
  }

  console.error('[agents.routes] unhandled error:', error)
  return reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      messageAr: 'حدث خطأ غير متوقع',
    },
  })
}

function getActorId(request: FastifyRequest): string {
  const user = (request as { user?: { id?: string; sub?: string } }).user
  const id = user?.id ?? user?.sub
  if (!id || typeof id !== 'string') {
    throw new Error('USER_NOT_FOUND')
  }
  return id
}

function parseServerId(params: unknown): string {
  // يدعم :serverId أو :id
  try {
    return serverIdParamsSchema.parse(params).serverId
  } catch {
    return serverIdAliasParamsSchema.parse(params).serverId
  }
}

// ==================================================================
// Plugin — مسارات مرتبطة بالسيرفر (تحت /servers)
// يُسجَّل: app.register(agentsServerRoutes, { prefix: '/servers' })
// ==================================================================

export const agentsServerRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
) => {
  /**
   * POST /servers/:serverId/enable-tunnel
   * توليد توكن + أمر تثبيت
   * صلاحية: servers:enable-agent
   */
  fastify.post(
    '/:serverId/enable-tunnel',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission('servers:enable-agent'),
      ],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const serverId = parseServerId(request.params)
        const body = enableTunnelBodySchema.parse(request.body ?? {})

        const result = await enableTunnel(
          fastify,
          actorId,
          serverId,
          body,
        )

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  // توافق مع :id بدل :serverId
  fastify.post(
    '/:id/enable-tunnel',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission('servers:enable-agent'),
      ],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const serverId = parseServerId(request.params)
        const body = enableTunnelBodySchema.parse(request.body ?? {})

        const result = await enableTunnel(
          fastify,
          actorId,
          serverId,
          body,
        )

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * POST /servers/:serverId/rotate-agent-token
   * توكن جديد + أمر تثبيت جديد
   */
  fastify.post(
    '/:serverId/rotate-agent-token',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission('servers:enable-agent'),
      ],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const serverId = parseServerId(request.params)
        const body = rotateAgentTokenBodySchema.parse(request.body ?? {})
        // body.confirm اختياري — التدوير يتم مباشرة
        void body

        const result = await rotateAgentToken(
          fastify,
          actorId,
          serverId,
          'script',
        )

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  fastify.post(
    '/:id/rotate-agent-token',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission('servers:enable-agent'),
      ],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const serverId = parseServerId(request.params)
        const result = await rotateAgentToken(
          fastify,
          actorId,
          serverId,
          'script',
        )
        return reply.status(200).send({ success: true, data: result })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * POST /servers/:serverId/disable-agent
   * إيقاف النفق + إلغاء التوكن
   */
  fastify.post(
    '/:serverId/disable-agent',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission('servers:enable-agent'),
      ],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const serverId = parseServerId(request.params)
        const body = disableAgentBodySchema.parse(request.body ?? {})

        const result = await disableAgent(
          fastify,
          actorId,
          serverId,
          body,
        )

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  fastify.post(
    '/:id/disable-agent',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission('servers:enable-agent'),
      ],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const serverId = parseServerId(request.params)
        const body = disableAgentBodySchema.parse(request.body ?? {})
        const result = await disableAgent(
          fastify,
          actorId,
          serverId,
          body,
        )
        return reply.status(200).send({ success: true, data: result })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * GET /servers/:serverId/agent-status
   * ملخص حالة الـ Agent
   * صلاحية: servers:view
   */
  fastify.get(
    '/:serverId/agent-status',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission('servers:view'),
      ],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const serverId = parseServerId(request.params)
        const result = await getAgentStatus(fastify, actorId, serverId)

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  fastify.get(
    '/:id/agent-status',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission('servers:view'),
      ],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const serverId = parseServerId(request.params)
        const result = await getAgentStatus(fastify, actorId, serverId)
        return reply.status(200).send({ success: true, data: result })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * GET /servers/:serverId/heartbeats
   * آخر النبضات
   */
  fastify.get(
    '/:serverId/heartbeats',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission('servers:view'),
      ],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const serverId = parseServerId(request.params)
        const query = listHeartbeatsQuerySchema.parse(request.query)

        const result = await listHeartbeats(
          fastify,
          actorId,
          serverId,
          query,
        )

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  fastify.get(
    '/:id/heartbeats',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission('servers:view'),
      ],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const serverId = parseServerId(request.params)
        const query = listHeartbeatsQuerySchema.parse(request.query)
        const result = await listHeartbeats(
          fastify,
          actorId,
          serverId,
          query,
        )
        return reply.status(200).send({ success: true, data: result })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}

// ==================================================================
// Plugin — مسار داخلي للـ Agent
// يُسجَّل: app.register(agentsInternalRoutes, { prefix: '/internal/agent' })
// ==================================================================

export const agentsInternalRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
) => {
  /**
   * POST /internal/agent/heartbeat
   *
   * مصادقة: AGENT_TOKEN فقط
   *   Authorization: Bearer <token>
   *   أو X-Agent-Token: <token>
   *
   * لا يستخدم JWT المستخدم ولا requirePermission
   */
  fastify.post('/heartbeat', async (request, reply) => {
    try {
      const headers = request.headers as Record<
        string,
        string | string[] | undefined
      >
      const token = extractAgentToken(headers)

      if (!token) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_AGENT_TOKEN',
            message: 'Missing agent token',
            messageAr: 'توكن الـ Agent مفقود',
          },
        })
      }

      const body = agentHeartbeatBodySchema.parse(request.body ?? {})
      const result = await processHeartbeat(fastify, token, body)

      return reply.status(200).send({
        success: true,
        data: result,
      })
    } catch (err) {
      return handleError(err, reply)
    }
  })
}

// ------------------------------------------------------------------
// تصدير افتراضي = مسارات السيرفر (للتوافق)
// ------------------------------------------------------------------

export default agentsServerRoutes
