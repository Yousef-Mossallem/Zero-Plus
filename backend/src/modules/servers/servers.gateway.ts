// ==================================================================
// Zero Plus - Servers Gateway Lookup
// Domain → organizationId
// ==================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

export async function lookupServerByDomain(
  fastify: FastifyInstance,
  domain: string
) {
  // split دائماً بيرجع عنصر واحد على الأقل، بس TypeScript محتاج ضمان
  const hostOnly = (domain.toLowerCase().trim().split(':')[0] ?? domain).trim()

  const server = await fastify.prisma.server.findFirst({
    where: {
      domain: hostOnly,
      status: { in: ['PENDING', 'ONLINE', 'DEGRADED'] },
    },
    select: {
      id: true,
      organizationId: true,
      domain: true,
      originIp: true,
      originPort: true,
      status: true,
      sslEnabled: true,
    },
  })

  if (!server) return null

  return {
    serverId: server.id,
    organizationId: server.organizationId,
    domain: server.domain,
    originIp: server.originIp,
    originPort: server.originPort,
    status: server.status,
    sslEnabled: server.sslEnabled,
  }
}

export async function serversInternalRoutes(fastify: FastifyInstance) {
  /**
   * GET /internal/gateway/servers/lookup?domain=shop.acme.com
   * Header: X-Gateway-Key: <GATEWAY_SECRET>
   */
  fastify.get(
    '/servers/lookup',
    { preHandler: [fastify.authenticateGateway] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const q = request.query as { domain?: string }
        const raw = typeof q.domain === 'string' ? q.domain.trim() : ''

        if (raw.length < 3) {
          return reply.status(400).send({
            success: false,
            message: 'Query parameter "domain" is required',
          })
        }

        const result = await lookupServerByDomain(fastify, raw)
        if (!result) {
          return reply.status(404).send({
            success: false,
            message: `No active server found for domain: ${raw}`,
          })
        }

        return reply.status(200).send({ success: true, data: result })
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