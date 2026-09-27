import { z } from 'zod';

// Schema لتحديث بيانات اسم الشركة
export const updateOrganizationSchema = z.object({
  name: z.string().min(2, { message: 'اسم الشركة يجب أن يكون من حرفين على الأقل' }).max(100),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;