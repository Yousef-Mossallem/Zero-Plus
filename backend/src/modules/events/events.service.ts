import { PrismaClient } from '@prisma/client';
import type { CreateEventInput, GetEventsQueryInput } from './events.schema.ts';

const prisma = new PrismaClient();

export class EventsService {
  private io: any;

  constructor(io?: any) {
    this.io = io;
  }

  // 1. مسار الـ Gateway (POST) - لتسجيل وبث الأحداث
  async createEvent(data: CreateEventInput) {
    const event = await (prisma as any).securityEvent.create({
      data: {
        organizationId: data.organizationId,
        serverId: data.serverId,
        ipAddress: data.ipAddress,
        country: data.country ?? "Unknown",
        isDataCenter: data.isDataCenter ?? false,
        userAgent: data.userAgent ?? "",
        path: data.path,
        method: data.method ?? "GET",
        riskScore: data.riskScore,
        anomalyScore: data.anomalyScore ?? 0,
        actionTaken: data.actionTaken ?? "ALLOW",
        severity: data.severity ?? "LOW",
        fingerprint: data.fingerprint ?? "",
        attackType: data.attackType ?? "UNKNOWN",
        aiSummary: data.aiSummary ?? "",
      },
    });

    if (this.io) {
      this.io.to(`org_${data.organizationId}`).emit('new_security_event', event);
    }

    return {
      status: 'success',
      message: 'تم تسجيل الحدث الأمني بنجاح وبثه للوحة التحكم',
      data: event,
    };
  }

  // 2. مسار الـ Frontend (GET) - للفلترة والإحصائيات الشاملة
  async getEvents(query: GetEventsQueryInput) {
    const organizationId = query.organizationId;
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (query.serverId) where.serverId = query.serverId;
    if (query.severity) where.severity = query.severity;
    if (query.actionTaken) where.actionTaken = query.actionTaken;
    if (query.attackType) where.attackType = { contains: query.attackType, mode: 'insensitive' };
    if (query.ipAddress) where.ipAddress = { contains: query.ipAddress };
    if (query.country) where.country = { equals: query.country, mode: 'insensitive' };
    if (query.isDataCenter !== undefined) where.isDataCenter = query.isDataCenter === 'true';
    if (query.path) where.path = { contains: query.path, mode: 'insensitive' };
    if (query.method) where.method = query.method.toUpperCase();
    if (query.fingerprint) where.fingerprint = query.fingerprint;

    if (query.minRiskScore || query.maxRiskScore) {
      where.riskScore = {};
      if (query.minRiskScore) where.riskScore.gte = parseInt(query.minRiskScore, 10);
      if (query.maxRiskScore) where.riskScore.lte = parseInt(query.maxRiskScore, 10);
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    if (query.search) {
      where.OR = [
        { ipAddress: { contains: query.search } },
        { path: { contains: query.search } },
        { attackType: { contains: query.search } },
        { aiSummary: { contains: query.search } },
      ];
    }

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';

    const [events, total, blockedCount, avgRisk] = await Promise.all([
      (prisma as any).securityEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      (prisma as any).securityEvent.count({ where }),
      (prisma as any).securityEvent.count({ where: { ...where, actionTaken: 'BLOCK' } }),
      (prisma as any).securityEvent.aggregate({
        where,
        _avg: { riskScore: true },
      }),
    ]);

    return {
      status: 'success',
      meta: {
        totalRecords: total,
        currentPage: page,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
      summary: {
        totalFilteredEvents: total,
        totalBlocked: blockedCount,
        averageRiskScore: Number((avgRisk._avg.riskScore || 0).toFixed(2)),
      },
      data: events.map((event: any) => ({
        id: event.id,
        organizationId: event.organizationId,
        requestDetails: {
          ipAddress: event.ipAddress,
          country: event.country,
          isDataCenter: event.isDataCenter,
          userAgent: event.userAgent,
          path: event.path,
          method: event.method,
          fingerprint: event.fingerprint,
        },
        securityMetrics: {
          riskScore: event.riskScore,
          anomalyScore: event.anomalyScore,
          severity: event.severity,
          actionTaken: event.actionTaken,
          attackType: event.attackType,
        },
        aiAnalysis: {
          summary: event.aiSummary || 'لا يوجد ملخص آلي متاح لهذا الحدث.',
        },
        timestamp: event.createdAt,
      })),
    };
  }
}