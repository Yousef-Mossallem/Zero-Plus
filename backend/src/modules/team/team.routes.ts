/**
 * backend/src/modules/team/team.routes.ts
 * ==================================================================
 * Zero Plus - Team & Permissions Routes
 *
 * يربط كل دوال team.service بمسارات HTTP مع:
 *   - authenticate (JWT)
 *   - requirePermission('team:view' | 'team:manage')
 *   - Zod validation من team.schema (يدوياً داخل كل handler)
 *   - ترجمة أخطاء الخدمة إلى استجابات HTTP واضحة
 *
 * ملاحظة: لا نمرّر Zod schemas داخل خيار `schema:` الخاص بـ Fastify،
 * لأنه يتوقع JSON Schema (Ajv) وسيفشل بناء السيرفر. التحقق يتم
 * بـ .parse() داخل كل handler، وأخطاء Zod تُترجم إلى 400.
 * ==================================================================
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import teamService from './team.service.js'
import {
  createGroupSchema,
  updateGroupSchema,
  addGroupMembersSchema,
  removeGroupMembersSchema,
  setUserOverridesSchema,
  upsertUserOverrideSchema,
  deleteUserOverrideSchema,
  updateMemberRoleSchema,
  setMemberGroupsSchema,
  createTeamInviteSchema,
  resendTeamInviteSchema,
  listMembersQuerySchema,
  listGroupsQuerySchema,
  listInvitesQuerySchema,
  groupIdParamsSchema,
  userIdParamsSchema,
  inviteIdParamsSchema,
} from './team.schema.js'

// ------------------------------------------------------------------
// خريطة الأخطاء → HTTP status + رسالة عربية/إنجليزية
// ------------------------------------------------------------------

const ERROR_MAP: Record<
  string,
  { status: number; code: string; message: string; messageAr: string }
> = {
  GROUP_NOT_FOUND: {
    status: 404,
    code: 'GROUP_NOT_FOUND',
    message: 'Permission group not found',
    messageAr: 'مجموعة الصلاحيات غير موجودة',
  },
  GROUP_NAME_EXISTS: {
    status: 409,
    code: 'GROUP_NAME_EXISTS',
    message: 'A group with this name already exists',
    messageAr: 'يوجد مجموعة بنفس الاسم بالفعل',
  },
  CANNOT_DELETE_SYSTEM_GROUP: {
    status: 403,
    code: 'CANNOT_DELETE_SYSTEM_GROUP',
    message: 'System groups cannot be deleted',
    messageAr: 'لا يمكن حذف مجموعات النظام',
  },
  CANNOT_RENAME_SYSTEM_GROUP: {
    status: 403,
    code: 'CANNOT_RENAME_SYSTEM_GROUP',
    message: 'System groups cannot be renamed',
    messageAr: 'لا يمكن إعادة تسمية مجموعات النظام',
  },
  MEMBER_NOT_FOUND: {
    status: 404,
    code: 'MEMBER_NOT_FOUND',
    message: 'Member not found in this organization',
    messageAr: 'العضو غير موجود في هذه المنظمة',
  },
  CANNOT_MODIFY_OWNER: {
    status: 403,
    code: 'CANNOT_MODIFY_OWNER',
    message: 'Only an owner can modify another owner',
    messageAr: 'فقط المالك يمكنه تعديل مالك آخر',
  },
  CANNOT_ASSIGN_OWNER: {
    status: 403,
    code: 'CANNOT_ASSIGN_OWNER',
    message: 'Cannot assign OWNER role via this endpoint',
    messageAr: 'لا يمكن تعيين دور المالك عبر هذا المسار',
  },
  CANNOT_DEACTIVATE_SELF: {
    status: 400,
    code: 'CANNOT_DEACTIVATE_SELF',
    message: 'You cannot deactivate your own account',
    messageAr: 'لا يمكنك إلغاء تفعيل حسابك بنفسك',
  },
  USER_ALREADY_IN_ORG: {
    status: 409,
    code: 'USER_ALREADY_IN_ORG',
    message: 'User is already a member of this organization',
    messageAr: 'المستخدم عضو بالفعل في هذه المنظمة',
  },
  EMAIL_ALREADY_EXISTS: {
    status: 409,
    code: 'EMAIL_ALREADY_EXISTS',
    message: 'Email is already registered to another organization',
    messageAr: 'البريد مسجل بالفعل في منظمة أخرى',
  },
  INVITE_NOT_FOUND: {
    status: 404,
    code: 'INVITE_NOT_FOUND',
    message: 'Invite not found',
    messageAr: 'الدعوة غير موجودة',
  },
  INVITE_ALREADY_PENDING: {
    status: 409,
    code: 'INVITE_ALREADY_PENDING',
    message: 'An active invite already exists for this email',
    messageAr: 'توجد دعوة نشطة بالفعل لهذا البريد',
  },
  INVITE_ALREADY_USED: {
    status: 409,
    code: 'INVITE_ALREADY_USED',
    message: 'This invite has already been accepted',
    messageAr: 'تم قبول هذه الدعوة مسبقاً',
  },
  INVITE_REVOKED: {
    status: 410,
    code: 'INVITE_REVOKED',
    message: 'This invite has been revoked',
    messageAr: 'تم إلغاء هذه الدعوة',
  },
  INVITE_EXPIRED: {
    status: 410,
    code: 'INVITE_EXPIRED',
    message: 'This invite has expired',
    messageAr: 'انتهت صلاحية هذه الدعوة',
  },
  FORBIDDEN_ORG: {
    status: 403,
    code: 'FORBIDDEN_ORG',
    message: 'Access denied to this organization',
    messageAr: 'غير مسموح بالوصول إلى هذه المنظمة',
  },
  FORBIDDEN_TEAM_MANAGE: {
    status: 403,
    code: 'FORBIDDEN_TEAM_MANAGE',
    message: 'You do not have permission to manage the team',
    messageAr: 'ليس لديك صلاحية إدارة الفريق',
  },
  ORGANIZATION_DISABLED: {
    status: 403,
    code: 'ORGANIZATION_DISABLED',
    message: 'Organization is disabled',
    messageAr: 'المنظمة معطّلة',
  },
  USER_NOT_FOUND: {
    status: 404,
    code: 'USER_NOT_FOUND',
    message: 'User not found or inactive',
    messageAr: 'المستخدم غير موجود أو غير نشط',
  },
}

function isZodError(
  error: unknown,
): error is { name: string; issues: unknown[] } {
  return (
    !!error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name: string }).name === 'ZodError'
  )
}

/** يحوّل أي خطأ (خدمة / Zod / غير معروف) إلى رد HTTP موحّد */
function handleServiceError(error: unknown, reply: FastifyReply) {
  // 1) أخطاء الخدمة المعروفة
  const message = error instanceof Error ? error.message : String(error)
  const mapped = ERROR_MAP[message]

  if (mapped) {
    return reply.status(mapped.status).send({
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        messageAr: mapped.messageAr,
      },
    })
  }

  // 2) أخطاء التحقق من Zod → 400
  if (isZodError(error)) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        messageAr: 'فشل التحقق من البيانات',
        details: error.issues,
      },
    })
  }

  // 3) أخطاء غير معروفة → 500 مع تسجيل
  requestLogError(error)
  return reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      messageAr: 'حدث خطأ غير متوقع',
    },
  })
}

function requestLogError(error: unknown) {
  // يمكن استبدالها بـ fastify.log.error لاحقاً
  console.error('[team.routes] unhandled service error:', error)
}

/** يستخرج userId من الطلب بعد authenticate */
function getActorId(request: FastifyRequest): string {
  // يدعم الشكل الشائع: request.user.id أو request.user.sub
  const user = (request as any).user
  const id = user?.id ?? user?.sub ?? user?.userId
  if (!id || typeof id !== 'string') {
    throw new Error('USER_NOT_FOUND')
  }
  return id
}

// ------------------------------------------------------------------
// Plugin
// ------------------------------------------------------------------

const teamRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // كل المسارات تحت /team تتطلب مصادقة
  fastify.addHook('preHandler', fastify.authenticate)

  // ================================================================
  // Catalog — للـ UI
  // ================================================================

  /**
   * GET /team/permissions-catalog
   * قائمة كل الصلاحيات + قوالب مجموعات النظام
   */
  fastify.get(
    '/permissions-catalog',
    {
      preHandler: [fastify.requirePermission('team:view')],
    },
    async (_request, reply) => {
      try {
        const catalog = teamService.getPermissionsCatalog()
        return reply.send({ success: true, data: catalog })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * POST /team/ensure-system-groups
   * إنشاء مجموعات النظام الافتراضية إن لم تكن موجودة (مرة واحدة)
   */
  fastify.post(
    '/ensure-system-groups',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        // نحتاج organizationId — نجلبه عبر getActor داخلياً في service أو نمرر
        const actor = await (fastify as any).prisma.user.findUnique({
          where: { id: actorId },
          select: { organizationId: true },
        })
        if (!actor?.organizationId) throw new Error('USER_NOT_FOUND')

        const result = await teamService.ensureSystemGroups(
          fastify,
          actor.organizationId,
        )
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  // ================================================================
  // Groups
  // ================================================================

  /**
   * GET /team/groups
   * قائمة المجموعات مع pagination وبحث
   */
  fastify.get(
    '/groups',
    {
      preHandler: [fastify.requirePermission('team:view')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const query = listGroupsQuerySchema.parse(request.query)
        const result = await teamService.listGroups(fastify, actorId, query)
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * GET /team/groups/:groupId
   * تفاصيل مجموعة + أعضاؤها
   */
  fastify.get(
    '/groups/:groupId',
    {
      preHandler: [fastify.requirePermission('team:view')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { groupId } = groupIdParamsSchema.parse(request.params)
        const group = await teamService.getGroup(fastify, actorId, groupId)
        return reply.send({ success: true, data: group })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * POST /team/groups
   * إنشاء مجموعة صلاحيات جديدة
   */
  fastify.post(
    '/groups',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const body = createGroupSchema.parse(request.body)
        const group = await teamService.createGroup(fastify, actorId, body)
        return reply.status(201).send({ success: true, data: group })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * PATCH /team/groups/:groupId
   * تعديل اسم / وصف / صلاحيات
   */
  fastify.patch(
    '/groups/:groupId',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { groupId } = groupIdParamsSchema.parse(request.params)
        const body = updateGroupSchema.parse(request.body)
        const group = await teamService.updateGroup(
          fastify,
          actorId,
          groupId,
          body,
        )
        return reply.send({ success: true, data: group })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * DELETE /team/groups/:groupId
   * حذف مجموعة (غير النظام)
   */
  fastify.delete(
    '/groups/:groupId',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { groupId } = groupIdParamsSchema.parse(request.params)
        const result = await teamService.deleteGroup(fastify, actorId, groupId)
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * POST /team/groups/:groupId/members
   * إضافة أعضاء لمجموعة
   */
  fastify.post(
    '/groups/:groupId/members',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { groupId } = groupIdParamsSchema.parse(request.params)
        const body = addGroupMembersSchema.parse(request.body)
        const result = await teamService.addGroupMembers(
          fastify,
          actorId,
          groupId,
          body,
        )
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * DELETE /team/groups/:groupId/members
   * إزالة أعضاء من مجموعة
   */
  fastify.delete(
    '/groups/:groupId/members',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { groupId } = groupIdParamsSchema.parse(request.params)
        const body = removeGroupMembersSchema.parse(request.body)
        const result = await teamService.removeGroupMembers(
          fastify,
          actorId,
          groupId,
          body,
        )
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  // ================================================================
  // Members
  // ================================================================

  /**
   * GET /team/members
   * قائمة أعضاء المنظمة مع فلاتر
   */
  fastify.get(
    '/members',
    {
      preHandler: [fastify.requirePermission('team:view')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const query = listMembersQuerySchema.parse(request.query)
        const result = await teamService.listMembers(fastify, actorId, query)
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * GET /team/members/:userId
   * تفاصيل عضو + مجموعاته + استثناءاته + الصلاحيات النهائية
   */
  fastify.get(
    '/members/:userId',
    {
      preHandler: [fastify.requirePermission('team:view')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { userId } = userIdParamsSchema.parse(request.params)
        const member = await teamService.getMember(fastify, actorId, userId)
        return reply.send({ success: true, data: member })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * PATCH /team/members/:userId
   * تغيير دور العضو (لا يسمح بـ OWNER)
   */
  fastify.patch(
    '/members/:userId',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { userId } = userIdParamsSchema.parse(request.params)
        const body = updateMemberRoleSchema.parse(request.body)
        const updated = await teamService.updateMemberRole(
          fastify,
          actorId,
          userId,
          body,
        )
        return reply.send({ success: true, data: updated })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * PUT /team/members/:userId/groups
   * تعيين مجموعات العضو (استبدال كامل)
   */
  fastify.put(
    '/members/:userId/groups',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { userId } = userIdParamsSchema.parse(request.params)
        const body = setMemberGroupsSchema.parse(request.body)
        const member = await teamService.setMemberGroups(
          fastify,
          actorId,
          userId,
          body,
        )
        return reply.send({ success: true, data: member })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * POST /team/members/:userId/deactivate
   * إلغاء تفعيل عضو
   */
  fastify.post(
    '/members/:userId/deactivate',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { userId } = userIdParamsSchema.parse(request.params)
        const result = await teamService.deactivateMember(
          fastify,
          actorId,
          userId,
        )
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * POST /team/members/:userId/activate
   * إعادة تفعيل عضو
   */
  fastify.post(
    '/members/:userId/activate',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { userId } = userIdParamsSchema.parse(request.params)
        const result = await teamService.activateMember(
          fastify,
          actorId,
          userId,
        )
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * POST /team/members/:userId/refresh-token
   * إعادة إصدار توكن لعضو بعد تغيير صلاحياته
   */
  fastify.post(
    '/members/:userId/refresh-token',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { userId } = userIdParamsSchema.parse(request.params)
        const result = await teamService.issueRefreshedTokenForMember(
          fastify,
          actorId,
          userId,
        )
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  // ================================================================
  // Overrides (استثناءات فردية)
  // ================================================================

  /**
   * PUT /team/members/:userId/overrides
   * استبدال كامل لقائمة الاستثناءات
   */
  fastify.put(
    '/members/:userId/overrides',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { userId } = userIdParamsSchema.parse(request.params)
        const body = setUserOverridesSchema.parse(request.body)
        const member = await teamService.setUserOverrides(
          fastify,
          actorId,
          userId,
          body,
        )
        return reply.send({ success: true, data: member })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * PATCH /team/members/:userId/overrides
   * إضافة أو تعديل استثناء واحد
   */
  fastify.patch(
    '/members/:userId/overrides',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { userId } = userIdParamsSchema.parse(request.params)
        const body = upsertUserOverrideSchema.parse(request.body)
        const member = await teamService.upsertUserOverride(
          fastify,
          actorId,
          userId,
          body,
        )
        return reply.send({ success: true, data: member })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * DELETE /team/members/:userId/overrides
   * حذف استثناء واحد (permission في body)
   */
  fastify.delete(
    '/members/:userId/overrides',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { userId } = userIdParamsSchema.parse(request.params)
        const body = deleteUserOverrideSchema.parse(request.body)
        const member = await teamService.deleteUserOverride(
          fastify,
          actorId,
          userId,
          body.permission,
        )
        return reply.send({ success: true, data: member })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  // ================================================================
  // Invites
  // ================================================================

  /**
   * GET /team/invites
   * قائمة الدعوات مع فلتر الحالة
   */
  fastify.get(
    '/invites',
    {
      preHandler: [fastify.requirePermission('team:view')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const query = listInvitesQuerySchema.parse(request.query)
        const result = await teamService.listInvites(fastify, actorId, query)
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * POST /team/invites
   * إنشاء دعوة وإرسال إيميل
   */
  fastify.post(
    '/invites',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const body = createTeamInviteSchema.parse(request.body)
        const result = await teamService.createTeamInvite(
          fastify,
          actorId,
          body,
        )
        return reply.status(201).send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * POST /team/invites/:inviteId/resend
   * إعادة إرسال دعوة + تجديد التوكن
   */
  fastify.post(
    '/invites/:inviteId/resend',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { inviteId } = inviteIdParamsSchema.parse(request.params)
        const body = resendTeamInviteSchema.parse(request.body ?? {})
        const result = await teamService.resendTeamInvite(
          fastify,
          actorId,
          inviteId,
          body,
        )
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )

  /**
   * POST /team/invites/:inviteId/revoke
   * إلغاء دعوة
   */
  fastify.post(
    '/invites/:inviteId/revoke',
    {
      preHandler: [fastify.requirePermission('team:manage')],
    },
    async (request, reply) => {
      try {
        const actorId = getActorId(request)
        const { inviteId } = inviteIdParamsSchema.parse(request.params)
        const result = await teamService.revokeTeamInvite(
          fastify,
          actorId,
          inviteId,
        )
        return reply.send({ success: true, data: result })
      } catch (err) {
        return handleServiceError(err, reply)
      }
    },
  )
}

export default teamRoutes