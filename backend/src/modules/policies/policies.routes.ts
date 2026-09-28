// ==================================================================
// Zero Plus - Policies Routes
// Dashboard → JWT | Gateway → X-Gateway-Key (GATEWAY_SECRET)
// ==================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PoliciesService } from './policies.service.js'
import { updatePolicySchema } from './policies.schema.js'

async function policiesRoutes(fastify: FastifyInstance) {
  const service = new PoliciesService(fastify)

  // ================================================================
  // GET /policies/me
  // ================================================================
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { organizationId } = request.user
        const policy = await service.getPolicyByOrganization(organizationId)
        return reply.status(200).send({ success: true, data: policy })
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
  // PATCH /policies/me
  // ================================================================
  fastify.patch(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { organizationId } = request.user
        const body = updatePolicySchema.parse(request.body)
        const updated = await service.updatePolicy(organizationId, body)
        return reply.status(200).send({
          success: true,
          message: 'Policy updated successfully',
          data: updated,
        })
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.status(400).send({
            success: false,
            message: 'Validation failed',
            errors: error.errors,
          })
        }
        if (error.message === 'INVALID_THRESHOLDS') {
          return reply.status(400).send({
            success: false,
            message:
              'Invalid thresholds: allowMaxScore ≤ rateLimitMaxScore ≤ challengeMaxScore must hold',
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

async function policiesInternalRoutes(fastify: FastifyInstance) {
  const service = new PoliciesService(fastify)

  /**
   * GET /internal/gateway/policies/:organizationId
   * Header: X-Gateway-Key: <GATEWAY_SECRET>
   */
  fastify.get<{ Params: { organizationId: string } }>(
    '/policies/:organizationId',
    { preHandler: [fastify.authenticateGateway] },
    async (request, reply) => {
      try {
        const { organizationId } = request.params
        if (!organizationId || organizationId.length < 10) {
          return reply.status(400).send({
            success: false,
            message: 'Invalid organizationId',
          })
        }
        const policy = await service.getGatewayPolicy(organizationId)
        return reply.status(200).send({ success: true, data: policy })
      } catch (error: any) {
        request.log.error(error)
        return reply.status(500).send({
          success: false,
          message: 'Internal server error',
        })
      }
    }
  )
}

export default policiesRoutes
export { policiesRoutes, policiesInternalRoutes }