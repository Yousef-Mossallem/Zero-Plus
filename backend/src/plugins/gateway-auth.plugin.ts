// ==================================================================
// Zero Plus - Gateway Auth Plugin
// Header: X-Gateway-Key = process.env.GATEWAY_SECRET
// ==================================================================

import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    authenticateGateway: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>
  }
}

async function gatewayAuthPlugin(fastify: FastifyInstance) {
  const secret = process.env.GATEWAY_SECRET

  if (!secret) {
    fastify.log.warn(
      'GATEWAY_SECRET is not set in .env — Gateway internal routes will reject all requests'
    )
  }

  fastify.decorate(
    'authenticateGateway',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const key = request.headers['x-gateway-key']

      if (!secret) {
        return reply.status(500).send({
          success: false,
          message: 'Server misconfiguration: GATEWAY_SECRET is not set',
        })
      }

      if (!key || typeof key !== 'string') {
        return reply.status(401).send({
          success: false,
          message: 'Missing X-Gateway-Key header',
        })
      }

      if (key !== secret) {
        request.log.warn({ ip: request.ip }, 'Invalid Gateway key attempt')
        return reply.status(403).send({
          success: false,
          message: 'Invalid Gateway key',
        })
      }
    }
  )
}

export default fp(gatewayAuthPlugin, { name: 'gateway-auth-plugin' })