import type { FastifyInstance } from 'fastify';

export async function createEvent(fastify: FastifyInstance, organizationId: string, data: any) {
  return await fastify.prisma.securityEvent.create({
    data: {
      ...data,
      organizationId,
    },
  });
}

export async function getEvents(fastify: FastifyInstance, organizationId: string, query: any) {
  const page = query.page ? parseInt(query.page, 10) : 1;
  const limit = query.limit ? parseInt(query.limit, 10) : 10;
  const skip = (page - 1) * limit;

  const where: any = { organizationId };
  if (query.decision) where.decision = query.decision;
  if (query.ip) where.ip = { contains: query.ip, mode: 'insensitive' };

  const [events, total] = await Promise.all([
    fastify.prisma.securityEvent.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    fastify.prisma.securityEvent.count({ where }),
  ]);

  return {
    events,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getEventById(fastify: FastifyInstance, organizationId: string, eventId: string) {
  return await fastify.prisma.securityEvent.findFirst({
    where: {
      id: eventId,
      organizationId,
    },
  });
}