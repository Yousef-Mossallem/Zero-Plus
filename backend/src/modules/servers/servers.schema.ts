import { z } from 'zod';

export const createServerSchema = z.object({
  domain: z.string().min(1, { message: 'النطاق مطلوب' }),
  ip: z.string().min(1, { message: 'عنوان IP مطلوب' }),
  port: z.number().int().min(1).max(65535, { message: 'المنفذ يجب أن يكون بين 1 و 65535' }),
});

export type CreateServerInput = z.infer<typeof createServerSchema>;