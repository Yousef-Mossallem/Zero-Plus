/**
 * backend/src/modules/team/team.schema.ts
 * ==================================================================
 * Zero Plus - Team & Permissions Validation (Zod)
 *
 * يغطي:
 *   - مجموعات الصلاحيات (PermissionGroup)
 *   - عضوية المجموعات (GroupMembership)
 *   - استثناءات فردية (UserPermissionOverride)
 *   - دعوات الأعضاء (TeamInvite)
 *   - تحديث دور عضو / إزالة عضو
 *
 * الصلاحيات = resource:action من lib/permissions.ts
 * فحص التنفيذ الفعلي في jwt.plugin — هنا validation فقط
 * ==================================================================
 */

import { z } from 'zod'
import {
    PERMISSION_CATALOG,
    isValidPermission,
    type Permission,
} from '../../lib/permissions.js'

// ------------------------------------------------------------------
// مشترك
// ------------------------------------------------------------------

const emailSchema = z
  .string()
  .min(1, 'البريد الإلكتروني مطلوب')
  .email('صيغة البريد غير صحيحة')
  .max(255)
  .transform((v) => v.toLowerCase().trim())

const uuidSchema = z.string().uuid('معرّف غير صالح')

/** أدوار النظام — متوافقة مع Prisma UserRole */
export const userRoleSchema = z.enum(['OWNER', 'ADMIN', 'ANALYST', 'VIEWER'], {
  message: 'الدور يجب أن يكون OWNER أو ADMIN أو ANALYST أو VIEWER',
})

export type TeamUserRole = z.infer<typeof userRoleSchema>

/**
 * صلاحية واحدة من الكتالوج
 * نقبل فقط القيم المعرّفة في PERMISSION_CATALOG
 */
export const permissionSchema = z
  .string()
  .min(3)
  .max(64)
  .refine((p) => isValidPermission(p), {
    message: `صلاحية غير معروفة. المسموح: ${PERMISSION_CATALOG.slice(0, 8).join(', ')}...`,
  }) as z.ZodType<Permission>

/** قائمة صلاحيات (فريدة، غير فارغة عند الإنشاء إن لزم) */
export const permissionsArraySchema = z
  .array(permissionSchema)
  .min(1, 'يجب اختيار صلاحية واحدة على الأقل')
  .max(PERMISSION_CATALOG.length, 'عدد صلاحيات أكبر من الكتالوج')
  .transform((arr) => [...new Set(arr)])

const groupNameSchema = z
  .string()
  .min(1, 'اسم المجموعة مطلوب')
  .min(2, 'اسم المجموعة قصير جدًا')
  .max(80, 'اسم المجموعة طويل جدًا')
  .trim()

const groupDescriptionSchema = z
  .string()
  .max(500, 'الوصف طويل جدًا')
  .trim()
  .optional()
  .nullable()

/** مدة صلاحية الدعوة بالساعات (للعرض / الحساب من السيرفر) */
const inviteTtlHoursSchema = z
  .number()
  .int()
  .min(1)
  .max(720) // 30 يوم كحد أقصى
  .optional()

// ==================================================================
// Permission Groups
// ==================================================================

/**
 * POST /team/groups
 * إنشاء مجموعة صلاحيات
 */
export const createGroupSchema = z
  .object({
    name: groupNameSchema,
    description: groupDescriptionSchema,
    permissions: permissionsArraySchema,
  })
  .strict()

/**
 * PATCH /team/groups/:groupId
 * تعديل اسم / وصف / صلاحيات (استبدال كامل لقائمة الصلاحيات إن وُجدت)
 */
export const updateGroupSchema = z
  .object({
    name: groupNameSchema.optional(),
    description: groupDescriptionSchema,
    permissions: permissionsArraySchema.optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.name !== undefined ||
      d.description !== undefined ||
      d.permissions !== undefined,
    { message: 'يجب إرسال حقل واحد على الأقل للتحديث' },
  )

/**
 * POST /team/groups/:groupId/members
 * إضافة أعضاء للمجموعة
 */
export const addGroupMembersSchema = z
  .object({
    userIds: z
      .array(uuidSchema)
      .min(1, 'اختر مستخدمًا واحدًا على الأقل')
      .max(50, 'حد أقصى 50 مستخدم في الطلب')
      .transform((ids) => [...new Set(ids)]),
  })
  .strict()

/**
 * DELETE /team/groups/:groupId/members
 * أو body لإزالة أعضاء
 */
export const removeGroupMembersSchema = z
  .object({
    userIds: z
      .array(uuidSchema)
      .min(1)
      .max(50)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict()

// ==================================================================
// User permission overrides (استثناءات فردية)
// ==================================================================

/**
 * PUT /team/members/:userId/overrides
 * استبدال كامل لقائمة الاستثناءات للمستخدم
 *
 * isDeny: false = منح إضافي | true = سحب حتى لو المجموعة تمنح
 */
export const setUserOverridesSchema = z
  .object({
    overrides: z
      .array(
        z
          .object({
            permission: permissionSchema,
            isDeny: z.boolean().default(false),
          })
          .strict(),
      )
      .max(PERMISSION_CATALOG.length)
      .transform((list) => {
        // آخر ظهور لنفس permission يفوز
        const map = new Map<string, { permission: Permission; isDeny: boolean }>()
        for (const o of list) {
          map.set(o.permission, {
            permission: o.permission,
            isDeny: o.isDeny,
          })
        }
        return [...map.values()]
      }),
  })
  .strict()

/**
 * PATCH /team/members/:userId/overrides  — إضافة/تعديل عنصر واحد
 */
export const upsertUserOverrideSchema = z
  .object({
    permission: permissionSchema,
    isDeny: z.boolean().default(false),
  })
  .strict()

/**
 * DELETE — إزالة استثناء واحد (permission في body أو query)
 */
export const deleteUserOverrideSchema = z
  .object({
    permission: permissionSchema,
  })
  .strict()

// ==================================================================
// Members — دور / إزالة
// ==================================================================

/**
 * PATCH /team/members/:userId
 * تغيير الدور الأساسي (User.role)
 * ملاحظة: OWNER لا يُغيَّر من هنا إلا بسياسات خاصة في الـ service
 */
export const updateMemberRoleSchema = z
  .object({
    role: userRoleSchema.refine((r) => r !== 'OWNER', {
      message: 'لا يمكن تعيين OWNER من هنا — انقل الملكية بمسار منفصل إن وُجد',
    }),
  })
  .strict()

/**
 * POST /team/members/:userId/groups
 * تعيين مجموعات المستخدم (استبدال كامل)
 */
export const setMemberGroupsSchema = z
  .object({
    groupIds: z
      .array(uuidSchema)
      .max(50)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict()

// ==================================================================
// Team invites
// ==================================================================

/**
 * POST /team/invites
 * دعوة عضو بالإيميل
 */
export const createTeamInviteSchema = z
  .object({
    email: emailSchema,
    /** الدور بعد القبول */
    role: userRoleSchema.default('VIEWER'),
    /** مجموعات تُطبَّق تلقائيًا بعد القبول */
    initialGroupIds: z
      .array(uuidSchema)
      .max(20)
      .optional()
      .default([])
      .transform((ids) => [...new Set(ids)]),
    /** مدة الدعوة بالساعات — السيرفر يستخدم الافتراضي من env إن حُذف */
    expiresInHours: inviteTtlHoursSchema,
  })
  .strict()
  .refine((d) => d.role !== 'OWNER', {
    message: 'لا يمكن دعوة عضو بدور OWNER',
    path: ['role'],
  })

/**
 * POST /team/invites/:inviteId/resend
 * body اختياري لتمديد المدة
 */
export const resendTeamInviteSchema = z
  .object({
    expiresInHours: inviteTtlHoursSchema,
  })
  .strict()
  .optional()
  .default({})

// ==================================================================
// Query / list filters
// ==================================================================

export const listMembersQuerySchema = z.object({
  q: z.string().max(100).optional(),
  role: userRoleSchema.optional(),
  groupId: uuidSchema.optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const listGroupsQuerySchema = z.object({
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const listInvitesQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

/** params مشتركة */
export const groupIdParamsSchema = z.object({
  groupId: uuidSchema,
})

export const userIdParamsSchema = z.object({
  userId: uuidSchema,
})

export const inviteIdParamsSchema = z.object({
  inviteId: uuidSchema,
})

// ==================================================================
// Catalog (للـ UI)
// ==================================================================

/**
 * GET /team/permissions-catalog
 * مفيش body — الـ service ترجع PERMISSION_CATALOG + labels
 * سكيما فاضي للتوحيد إن احتجت
 */
export const emptyBodySchema = z.object({}).strict().optional().default({})

// ==================================================================
// Types
// ==================================================================

export type CreateGroupInput = z.infer<typeof createGroupSchema>
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>
export type AddGroupMembersInput = z.infer<typeof addGroupMembersSchema>
export type RemoveGroupMembersInput = z.infer<typeof removeGroupMembersSchema>

export type SetUserOverridesInput = z.infer<typeof setUserOverridesSchema>
export type UpsertUserOverrideInput = z.infer<typeof upsertUserOverrideSchema>
export type DeleteUserOverrideInput = z.infer<typeof deleteUserOverrideSchema>

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>
export type SetMemberGroupsInput = z.infer<typeof setMemberGroupsSchema>

export type CreateTeamInviteInput = z.infer<typeof createTeamInviteSchema>
export type ResendTeamInviteInput = z.infer<typeof resendTeamInviteSchema>

export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>
export type ListGroupsQuery = z.infer<typeof listGroupsQuerySchema>
export type ListInvitesQuery = z.infer<typeof listInvitesQuerySchema>