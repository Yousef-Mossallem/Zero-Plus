import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as eventsService from './events.service.js';
import {
  createEventSchema,
  getEventsQuerySchema,
  getEventByIdSchema,
} from './events.schema.js';

export default async function eventRoutes(fastify: FastifyInstance) {
  
  // حماية المسارات والتحقق من التوكن عبر الـ JWT Plugin
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: 'غير مسموح، يرجى تسجيل الدخول بـ Token صحيح' });
    }
  });

  // POST /api/events
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { organizationId?: string };
    const organizationId = user?.organizationId;
    
    if (!organizationId) {
      return reply.code(403).send({ error: 'معرف المؤسسة غير موجود في التوكن' });
    }

    const validationResult = createEventSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.code(400).send({
        error: 'بيانات غير صالحة',
        details: validationResult.error.format(),
      });
    }

    const newEvent = await eventsService.createEvent(fastify, organizationId, validationResult.data);
    return reply.code(201).send({
      message: 'تم إنشاء الحدث الأمني بنجاح',
      data: newEvent,
    });
  });

  // GET /api/events
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { organizationId?: string };
    const organizationId = user?.organizationId;
    
    if (!organizationId) {
      return reply.code(403).send({ error: 'معرف المؤسسة غير موجود في التوكن' });
    }

    const validationResult = getEventsQuerySchema.safeParse(request.query);
    if (!validationResult.success) {
      return reply.code(400).send({
        error: 'معلمات الاستعلام غير صالحة',
        details: validationResult.error.format(),
      });
    }

    const result = await eventsService.getEvents(fastify, organizationId, validationResult.data);
    return reply.code(200).send(result);
  });

  // GET /api/events/:id
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = request.user as { organizationId?: string };
    const organizationId = user?.organizationId;
    
    if (!organizationId) {
      return reply.code(403).send({ error: 'معرف المؤسسة غير موجود في التوكن' });
    }

    const validationResult = getEventByIdSchema.safeParse(request.params);
    if (!validationResult.success) {
      return reply.code(400).send({
        error: 'معرف الحدث غير صالح',
        details: validationResult.error.format(),
      });
    }

    const event = await eventsService.getEventById(fastify, organizationId, validationResult.data.id);
    if (!event) {
      return reply.code(404).send({ error: 'الحدث غير موجود أو ليس لديك صلاحية الوصول إليه' });
    }

    return reply.code(200).send({ data: event });
  });
}