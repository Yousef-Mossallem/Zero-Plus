import type { FastifyInstance } from 'fastify';
import type { UpdateOrganizationInput } from './organizations.schema.js';

export class OrganizationsService {
  constructor(private fastify: FastifyInstance) {}

  // جلب بيانات الشركة الخاصة بالمستخدم المسجل
  async getMyOrganization(organizationId: string) {
    const organization = await this.fastify.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        _count: {
          select: { users: true, servers: true },
        },
      },
    });

    if (!organization) {
      throw new Error('الشركة غير موجودة');
    }

    return organization;
  }

  // تعديل اسم الشركة
  async updateOrganization(organizationId: string, input: UpdateOrganizationInput) {
    return await this.fastify.prisma.organization.update({
      where: { id: organizationId },
      data: {
        name: input.name,
      },
    });
  }
}