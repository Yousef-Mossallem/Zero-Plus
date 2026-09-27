import { z } from 'zod';

export const createEventSchema = z.object({
  ip: z.string().min(1, 'عنوان IP مطلوب'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
  path: z.string().min(1, 'المسار مطلوب'),
  userAgent: z.string().optional(),
  countryCode: z.string().length(2, 'كود الدولة يجب أن يكون حرفين').optional(),
  ipType: z.enum(['RESIDENTIAL', 'MOBILE', 'DATACENTER', 'UNKNOWN']),
  riskScore: z.number().min(0).max(100),
  anomalyScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  decision: z.enum(['ALLOW', 'RATE_LIMIT', 'CHALLENGE', 'BLOCK']),
  reasonSummary: z.string().min(1, 'ملخص السبب مطلوب'),
  reasonDetails: z.record(z.string(), z.any()).optional(),
  actionTaken: z.string().optional(),
});

export const getEventsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  decision: z.enum(['ALLOW', 'RATE_LIMIT', 'CHALLENGE', 'BLOCK']).optional(),
  ip: z.string().optional(),
});

export const getEventByIdSchema = z.object({
  id: z.string().min(1, 'معرف الإيفنت مطلوب'),
});