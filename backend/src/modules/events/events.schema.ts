import { z } from 'zod';

export const createEventSchema = z.object({
  organizationId: z.string(),
  serverId: z.string(),
  ipAddress: z.string(),
  country: z.string().optional(),
  isDataCenter: z.boolean().optional(),
  userAgent: z.string().optional(),
  path: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  riskScore: z.number().int().min(0).max(100),
  anomalyScore: z.number().optional(),
  actionTaken: z.enum(['ALLOW', 'RATE_LIMIT', 'CHALLENGE', 'BLOCK']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  fingerprint: z.string().optional(),
  attackType: z.string().optional(),
  aiSummary: z.string().optional(),
});

export const getEventsQuerySchema = z.object({
  organizationId: z.string(),
  serverId: z.string().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  actionTaken: z.enum(['ALLOW', 'RATE_LIMIT', 'CHALLENGE', 'BLOCK']).optional(),
  attackType: z.string().optional(),
  ipAddress: z.string().optional(),
  country: z.string().optional(),
  isDataCenter: z.string().optional(),
  path: z.string().optional(),
  method: z.string().optional(),
  fingerprint: z.string().optional(),
  minRiskScore: z.string().optional(),
  maxRiskScore: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  page: z.string().default('1'),
  limit: z.string().default('20'),
  sortBy: z.string().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type GetEventsQueryInput = z.infer<typeof getEventsQuerySchema>;