// backend/src/modules/servers/servers.routes.ts
// ==================================================================
// Zero Plus - Servers Routes
// ==================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { ServersService } from './servers.service.js'
import { createServerSchema, updateServerSchema } from './servers.schema.js'

export async function serverRoutes(fastify: FastifyInstance) {
  const service = new ServersService(fastify)

  // ================================================================
  // POST /servers
  // إضافة سيرفر جديد
  // ================================================================
  /**
   * محتاج:
   * - Header: Authorization: Bearer <token>
   * - Body:
   *   {
   *     "domain": "example.com",
   *     "ip": "192.168.1.10",
   *     "port": 443
   *   }
   */
  fastify.post(
    '/',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { organizationId } = request.user
        const body = createServerSchema.parse(request.body)

        const server = await service.createServer(organizationId, body)

        return reply.status(201).send({
          success: true,
          message: 'Server created successfully',
          data: server,
        })
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.status(400).send({
            success: false,
            message: 'Validation failed',
            errors: error.errors,
          })
        }

        if (error.message === 'DOMAIN_ALREADY_EXISTS') {
          return reply.status(409).send({
            success: false,
            message: 'Domain already exists in your organization',
          })
        }

        request.log.error(error)
        return reply.status(500).send({
          success: false,
          message: 'Internal server error',
        })
      }
    }
  )

  // ================================================================
  // GET /servers
  // جلب كل سيرفرات الشركة
  // ================================================================
  /**
   * محتاج:
   * - Header: Authorization: Bearer <token>
   */
  fastify.get(
    '/',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { organizationId } = request.user
        const servers = await service.getServersByOrganization(organizationId)

        return reply.status(200).send({
          success: true,
          data: servers,
        })
      } catch (error: any) {
        request.log.error(error)
        return reply.status(500).send({
          success: false,
          message: 'Internal server error',
        })
      }
    }
  )

  // ================================================================
  // GET /servers/:id
  // جلب سيرفر واحد بالـ ID
  // ================================================================
  /**
   * محتاج:
   * - Header: Authorization: Bearer <token>
   * - Params: id
   */
  fastify.get(
    '/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { organizationId } = request.user
        const { id } = request.params as { id: string }

        const server = await service.getServerById(organizationId, id)

        return reply.status(200).send({
          success: true,
          data: server,
        })
      } catch (error: any) {
        if (error.message === 'SERVER_NOT_FOUND') {
          return reply.status(404).send({
            success: false,
            message: 'Server not found',
          })
        }

        request.log.error(error)
        return reply.status(500).send({
          success: false,
          message: 'Internal server error',
        })
      }
    }
  )

  // ================================================================
  // PATCH /servers/:id
  // تعديل سيرفر
  // ================================================================
  /**
   * محتاج:
   * - Header: Authorization: Bearer <token>
   * - Params: id
   * - Body (واحد على الأقل):
   *   {
   *     "domain": "new-domain.com",
   *     "ip": "10.0.0.1",
   *     "port": 8080
   *   }
   */
  fastify.patch(
    '/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { organizationId } = request.user
        const { id } = request.params as { id: string }
        const body = updateServerSchema.parse(request.body)

        const updatedServer = await service.updateServer(organizationId, id, body)

        return reply.status(200).send({
          success: true,
          message: 'Server updated successfully',
          data: updatedServer,
        })
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.status(400).send({
            success: false,
            message: 'Validation failed',
            errors: error.errors,
          })
        }

        if (error.message === 'SERVER_NOT_FOUND') {
          return reply.status(404).send({
            success: false,
            message: 'Server not found',
          })
        }

        if (error.message === 'DOMAIN_ALREADY_EXISTS') {
          return reply.status(409).send({
            success: false,
            message: 'Domain already exists in your organization',
          })
        }

        request.log.error(error)
        return reply.status(500).send({
          success: false,
          message: 'Internal server error',
        })
      }
    }
  )

  // ================================================================
  // DELETE /servers/:id
  // حذف سيرفر
  // ================================================================
  /**
   * محتاج:
   * - Header: Authorization: Bearer <token>
   * - Params: id
   */
  fastify.delete(
    '/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { organizationId } = request.user
        const { id } = request.params as { id: string }

        await service.deleteServer(organizationId, id)

        return reply.status(200).send({
          success: true,
          message: 'Server deleted successfully',
        })
      } catch (error: any) {
        if (error.message === 'SERVER_NOT_FOUND') {
          return reply.status(404).send({
            success: false,
            message: 'Server not found',
          })
        }

        request.log.error(error)
        return reply.status(500).send({
          success: false,
          message: 'Internal server error',
        })
      }
    }
  )
}
