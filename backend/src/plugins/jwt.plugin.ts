// ==================================================================
// Zero Plus - JWT Plugin
// مسؤول عن كل حاجة تخص المصادقة والتوكنات + Gateway Key
// ==================================================================

import fp from 'fastify-plugin'
import fjwt from '@fastify/jwt'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

// ------------------------------------------------------------------
// TypeScript Declaration Merging
// ------------------------------------------------------------------
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      id: string
      email: string
      role: string
      organizationId: string
    }
    user: {
      id: string
      email: string
      role: string
      organizationId: string
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    authenticateGateway: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }

  interface FastifyRequest {
    user: {
      id: string
      email: string
      role: string
      organizationId: string
    }
  }
}

// ------------------------------------------------------------------
// الـ Plugin نفسه
// ------------------------------------------------------------------
const jwtPlugin: FastifyPluginAsync = async (fastify) => {
  const secret = process.env.JWT_SECRET

  if (!secret) {
    throw new Error('❌ JWT_SECRET is missing in environment variables')
  }

  await fastify.register(fjwt, {
    secret,
    sign: {
      expiresIn: '7d',
    },
  })

  // ------------------------------------------------------------------
  // Dashboard: JWT
  // ------------------------------------------------------------------
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify()
      } catch (err) {
        return reply.status(401).send({
          success: false,
          message: 'Unauthorized - Invalid or missing token',
        })
      }
    }
  )

  // ------------------------------------------------------------------
  // Gateway: X-Gateway-Key فقط (من .env → GATEWAY_SECRET)
  // ------------------------------------------------------------------
  const gatewaySecret = process.env.GATEWAY_SECRET

  if (!gatewaySecret) {
    fastify.log.warn(
      '⚠️ GATEWAY_SECRET is not set — /internal/gateway/* routes will reject all requests'
    )
  }

  fastify.decorate(
    'authenticateGateway',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!gatewaySecret) {
        return reply.status(500).send({
          success: false,
          message: 'Server misconfiguration: GATEWAY_SECRET is not set',
        })
      }

      const key = request.headers['x-gateway-key']

      if (!key || typeof key !== 'string') {
        return reply.status(401).send({
          success: false,
          message: 'Missing X-Gateway-Key header',
        })
      }

      if (key !== gatewaySecret) {
        request.log.warn({ ip: request.ip }, 'Invalid Gateway key attempt')
        return reply.status(403).send({
          success: false,
          message: 'Invalid Gateway key',
        })
      }
    }
  )
}

export default fp(jwtPlugin, {
  name: 'jwt-plugin',
})