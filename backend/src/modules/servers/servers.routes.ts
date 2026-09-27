import type { FastifyInstance } from 'fastify';
import { ServersService } from './servers.service.js';
import { createServerSchema } from './servers.schema.js';

export async function serverRoutes(fastify: FastifyInstance) {
  const service = new ServersService(fastify);

  // التحقق من توكن تسجيل الدخول
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ message: 'غير مصرح للوصول' });
    }
  });

  // POST /servers - إضافة سيرفر جديد
  fastify.post('/', async (request, reply) => {
    try {
      const user = request.user as { organizationId: string };
      const body = createServerSchema.parse(request.body);
      const server = await service.createServer(user.organizationId, body);
      return reply.status(201).send(server);
    } catch (error: any) {
      return reply.status(400).send({ message: error.message });
    }
  });

  // GET /servers - جلب قائمة سيرفرات الشركة
  fastify.get('/', async (request, reply) => {
    try {
      const user = request.user as { organizationId: string };
      const servers = await service.getServersByOrganization(user.organizationId);
      return reply.send(servers);
    } catch (error: any) {
      return reply.status(400).send({ message: error.message });
    }
  });
}