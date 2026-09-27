// backend/src/modules/servers/servers.service.ts
// ==================================================================
// Zero Plus - Servers Service
// ==================================================================

import type { FastifyInstance } from 'fastify'
import type { CreateServerInput, UpdateServerInput } from './servers.schema.js'

export class ServersService {
  constructor(private fastify: FastifyInstance) {}

  // ================================================================
  // إنشاء سيرفر جديد
  // ================================================================
  async createServer(organizationId: string, input: CreateServerInput) {
    // نتأكد إن الـ domain مش مستخدم قبل كده في نفس الشركة
    const existing = await this.fastify.prisma.server.findFirst({
      where: {
        organizationId,
        domain: input.domain,
      },
    })

    if (existing) {
      throw new Error('DOMAIN_ALREADY_EXISTS')
    }

    return await this.fastify.prisma.server.create({
      data: {
        domain: input.domain,
        originIp: input.ip,
        originPort: input.port,
        organizationId,
        status: 'PENDING',
      },
    })
  }

  // ================================================================
  // جلب كل سيرفرات الشركة
  // ================================================================
  async getServersByOrganization(organizationId: string) {
    return await this.fastify.prisma.server.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    })
  }

  // ================================================================
  // جلب سيرفر واحد بالـ ID
  // ================================================================
  async getServerById(organizationId: string, serverId: string) {
    const server = await this.fastify.prisma.server.findFirst({
      where: {
        id: serverId,
        organizationId, // عشان ميقدرش يوصل لسيرفر شركة تانية
      },
    })

    if (!server) {
      throw new Error('SERVER_NOT_FOUND')
    }

    return server
  }

  // ================================================================
  // تعديل سيرفر
  // ================================================================
  async updateServer(
    organizationId: string,
    serverId: string,
    input: UpdateServerInput
  ) {
    // نتأكد إن السيرفر موجود ويتبع الشركة دي
    await this.getServerById(organizationId, serverId)

    // لو بيعدل الـ domain، نتأكد إنه مش مكرر
    if (input.domain) {
      const existing = await this.fastify.prisma.server.findFirst({
        where: {
          organizationId,
          domain: input.domain,
          NOT: { id: serverId },
        },
      })

      if (existing) {
        throw new Error('DOMAIN_ALREADY_EXISTS')
      }
    }

    return await this.fastify.prisma.server.update({
      where: { id: serverId },
      data: {
        ...(input.domain && { domain: input.domain }),
        ...(input.ip && { originIp: input.ip }),
        ...(input.port && { originPort: input.port }),
      },
    })
  }

  // ================================================================
  // حذف سيرفر
  // ================================================================
  async deleteServer(organizationId: string, serverId: string) {
    // نتأكد إن السيرفر موجود ويتبع الشركة دي
    await this.getServerById(organizationId, serverId)

    await this.fastify.prisma.server.delete({
      where: { id: serverId },
    })

    return { success: true }
  }
}
