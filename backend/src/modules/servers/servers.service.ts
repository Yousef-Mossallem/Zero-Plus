import type { FastifyInstance } from 'fastify';
import type { CreateServerInput } from './servers.schema.js';

export class ServersService {
  constructor(private fastify: FastifyInstance) {}

  async createServer(organizationId: string, input: CreateServerInput) {
    return await this.fastify.prisma.server.create({
      data: {
        domain: input.domain,
        originIp: input.ip,      // يوسف سماه originIp
        originPort: input.port,  // يوسف سماه originPort
        organizationId: organizationId,
      },
    });
  }

  async getServersByOrganization(organizationId: string) {
    return await this.fastify.prisma.server.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}