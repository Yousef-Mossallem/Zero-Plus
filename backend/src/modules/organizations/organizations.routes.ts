import type { FastifyInstance } from 'fastify';
import { OrganizationsService } from './organizations.service.js';
import { updateOrganizationSchema } from './organizations.schema.js';

export async function organizationRoutes(fastify: FastifyInstance) {
  const service = new OrganizationsService(fastify);

  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ message: 'غير مصرح للوصول' });
    }
  });

  fastify.get('/me', async (request, reply) => {
    try {
      const user = request.user as { organizationId: string };
      const organization = await service.getMyOrganization(user.organizationId);
      return reply.send(organization);
    } catch (error: any) {
      return reply.status(400).send({ message: error.message });
    }
  });

  fastify.patch('/me', async (request, reply) => {
    try {
      const user = request.user as { organizationId: string };
      const body = updateOrganizationSchema.parse(request.body);
      const updatedOrg = await service.updateOrganization(user.organizationId, body);
      return reply.send({ message: 'تم تحديث البيانات بنجاح', organization: updatedOrg });
    } catch (error: any) {
      return reply.status(400).send({ message: error.message });
    }
  });
}