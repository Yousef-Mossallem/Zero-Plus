/**
 * backend/src/modules/team/team.service.ts
 * ==================================================================
 * Zero Plus - Team & Permissions Service
 *
 * - مجموعات صلاحيات (CRUD + أعضاء)
 * - استثناءات فردية (grant / deny)
 * - دعوات بالإيميل (Resend عبر lib/email)
 * - إدارة الأعضاء (دور / مجموعات / إزالة)
 * - الصلاحيات النهائية تُحسب في auth عند إصدار JWT
 * ==================================================================
 */

import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import type { TeamInviteStatus, UserRole } from '@prisma/client'
import {
  PERMISSION_CATALOG,
  PERMISSION_LABELS,
  SYSTEM_GROUP_TEMPLATES,
  computeUserPermissions,
  type Permission,
} from '../../lib/permissions.js'
import { sendTeamInviteEmail } from '../../lib/email.js'
import { refreshTokenForUser } from '../auth/auth.service.js'
import type {
  CreateGroupInput,
  UpdateGroupInput,
  AddGroupMembersInput,
  RemoveGroupMembersInput,
  SetUserOverridesInput,
  UpsertUserOverrideInput,
  UpdateMemberRoleInput,
  SetMemberGroupsInput,
  CreateTeamInviteInput,
  ResendTeamInviteInput,
  ListMembersQuery,
  ListGroupsQuery,
  ListInvitesQuery,
} from './team.schema.js'

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------

const DEFAULT_INVITE_TTL_HOURS = Number(
  process.env.INVITE_TTL_HOURS ?? process.env.TEAM_INVITE_TTL_HOURS ?? 72,
)

function inviteTtlHours(override?: number): number {
  const h = override ?? DEFAULT_INVITE_TTL_HOURS
  return Math.min(Math.max(1, h), 720)
}

function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

// ------------------------------------------------------------------
// Helpers — منظمة / صلاحيات المستدعي
// ------------------------------------------------------------------

async function getActor(
  fastify: FastifyInstance,
  actorUserId: string,
) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: actorUserId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      organizationId: true,
      isActive: true,
    },
  })
  if (!user || !user.isActive) {
    throw new Error('USER_NOT_FOUND')
  }
  return user
}

function assertSameOrg(
  actorOrgId: string,
  targetOrgId: string,
): void {
  if (actorOrgId !== targetOrgId) {
    throw new Error('FORBIDDEN_ORG')
  }
}

/** OWNER لا يُمس من غير OWNER آخر — والحماية الأساسية هنا */
function assertCanManageTarget(
  actorRole: UserRole,
  targetRole: UserRole,
  targetUserId: string,
  actorUserId: string,
): void {
  if (targetUserId === actorUserId && targetRole === 'OWNER') {
    // المالك يقدر يعدّل مجموعاته بحذر — الـ routes تمنع حذف نفسه
  }
  if (targetRole === 'OWNER' && actorRole !== 'OWNER') {
    throw new Error('CANNOT_MODIFY_OWNER')
  }
  if (actorRole === 'VIEWER' || actorRole === 'ANALYST') {
    // الفريق يُدار بصلاحية team:manage في الـ plugin؛
    // هنا طبقة إضافية لو اتنادى الخدمة مباشرة
    throw new Error('FORBIDDEN_TEAM_MANAGE')
  }
}

async function getMemberInOrg(
  fastify: FastifyInstance,
  organizationId: string,
  userId: string,
) {
  const user = await fastify.prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      organizationId: true,
      lastLoginAt: true,
      createdAt: true,
      invitedById: true,
    },
  })
  if (!user) throw new Error('MEMBER_NOT_FOUND')
  return user
}

async function getGroupInOrg(
  fastify: FastifyInstance,
  organizationId: string,
  groupId: string,
) {
  const group = await fastify.prisma.permissionGroup.findFirst({
    where: { id: groupId, organizationId },
  })
  if (!group) throw new Error('GROUP_NOT_FOUND')
  return group
}

/** صلاحيات عضو كما ستظهر في JWT */
export async function getMemberEffectivePermissions(
  fastify: FastifyInstance,
  userId: string,
): Promise<Permission[]> {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      groupMemberships: {
        select: { group: { select: { permissions: true } } },
      },
      permissionOverrides: {
        select: { permission: true, isDeny: true },
      },
    },
  })
  if (!user) throw new Error('MEMBER_NOT_FOUND')

  return computeUserPermissions({
    role: user.role,
    groups: user.groupMemberships.map((m) => ({
      permissions: m.group.permissions,
    })),
    overrides: user.permissionOverrides,
  })
}

// ==================================================================
// Catalog — للـ UI
// ==================================================================

export function getPermissionsCatalog() {
  return {
    permissions: PERMISSION_CATALOG.map((p) => ({
      id: p,
      ...PERMISSION_LABELS[p],
    })),
    systemGroupTemplates: SYSTEM_GROUP_TEMPLATES,
  }
}

/**
 * إنشاء مجموعات النظام الافتراضية لمنظمة جديدة (اختياري عند أول استخدام)
 */
export async function ensureSystemGroups(
  fastify: FastifyInstance,
  organizationId: string,
) {
  const existing = await fastify.prisma.permissionGroup.count({
    where: { organizationId, isSystem: true },
  })
  if (existing > 0) return { created: 0 }

  let created = 0
  for (const t of SYSTEM_GROUP_TEMPLATES) {
    await fastify.prisma.permissionGroup.create({
      data: {
        name: t.name,
        description: t.description,
        permissions: [...t.permissions],
        isSystem: true,
        organizationId,
      },
    })
    created++
  }
  return { created }
}

// ==================================================================
// Groups CRUD
// ==================================================================

export async function listGroups(
  fastify: FastifyInstance,
  actorUserId: string,
  query: ListGroupsQuery,
) {
  const actor = await getActor(fastify, actorUserId)
  const where = {
    organizationId: actor.organizationId,
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            {
              description: {
                contains: query.q,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {}),
  }

  const [total, items] = await Promise.all([
    fastify.prisma.permissionGroup.count({ where }),
    fastify.prisma.permissionGroup.findMany({
      where,
      include: {
        _count: { select: { members: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ])

  return {
    items: items.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      permissions: g.permissions,
      isSystem: g.isSystem,
      membersCount: g._count.members,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })),
    page: query.page,
    limit: query.limit,
    total,
  }
}

export async function getGroup(
  fastify: FastifyInstance,
  actorUserId: string,
  groupId: string,
) {
  const actor = await getActor(fastify, actorUserId)
  const group = await fastify.prisma.permissionGroup.findFirst({
    where: { id: groupId, organizationId: actor.organizationId },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              role: true,
              isActive: true,
            },
          },
        },
      },
    },
  })
  if (!group) throw new Error('GROUP_NOT_FOUND')

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    permissions: group.permissions,
    isSystem: group.isSystem,
    members: group.members.map((m) => m.user),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  }
}

export async function createGroup(
  fastify: FastifyInstance,
  actorUserId: string,
  data: CreateGroupInput,
) {
  const actor = await getActor(fastify, actorUserId)

  const dup = await fastify.prisma.permissionGroup.findFirst({
    where: {
      organizationId: actor.organizationId,
      name: data.name,
    },
  })
  if (dup) throw new Error('GROUP_NAME_EXISTS')

  const group = await fastify.prisma.permissionGroup.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      permissions: data.permissions,
      isSystem: false,
      organizationId: actor.organizationId,
    },
  })

  return group
}

export async function updateGroup(
  fastify: FastifyInstance,
  actorUserId: string,
  groupId: string,
  data: UpdateGroupInput,
) {
  const actor = await getActor(fastify, actorUserId)
  const group = await getGroupInOrg(
    fastify,
    actor.organizationId,
    groupId,
  )

  if (group.isSystem && data.name && data.name !== group.name) {
    throw new Error('CANNOT_RENAME_SYSTEM_GROUP')
  }

  if (data.name && data.name !== group.name) {
    const dup = await fastify.prisma.permissionGroup.findFirst({
      where: {
        organizationId: actor.organizationId,
        name: data.name,
        NOT: { id: groupId },
      },
    })
    if (dup) throw new Error('GROUP_NAME_EXISTS')
  }

  const updated = await fastify.prisma.permissionGroup.update({
    where: { id: groupId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
      ...(data.permissions !== undefined
        ? { permissions: data.permissions }
        : {}),
    },
  })

  return updated
}

export async function deleteGroup(
  fastify: FastifyInstance,
  actorUserId: string,
  groupId: string,
) {
  const actor = await getActor(fastify, actorUserId)
  const group = await getGroupInOrg(
    fastify,
    actor.organizationId,
    groupId,
  )

  if (group.isSystem) {
    throw new Error('CANNOT_DELETE_SYSTEM_GROUP')
  }

  await fastify.prisma.permissionGroup.delete({
    where: { id: groupId },
  })

  return { ok: true }
}

export async function addGroupMembers(
  fastify: FastifyInstance,
  actorUserId: string,
  groupId: string,
  data: AddGroupMembersInput,
) {
  const actor = await getActor(fastify, actorUserId)
  await getGroupInOrg(fastify, actor.organizationId, groupId)

  const users = await fastify.prisma.user.findMany({
    where: {
      id: { in: data.userIds },
      organizationId: actor.organizationId,
    },
    select: { id: true, role: true },
  })

  if (users.length !== data.userIds.length) {
    throw new Error('MEMBER_NOT_FOUND')
  }

  for (const u of users) {
    assertCanManageTarget(actor.role, u.role, u.id, actor.id)
  }

  await fastify.prisma.$transaction(
    users.map((u) =>
      fastify.prisma.groupMembership.upsert({
        where: {
          userId_groupId: { userId: u.id, groupId },
        },
        create: { userId: u.id, groupId },
        update: {},
      }),
    ),
  )

  return { ok: true, added: users.length }
}

export async function removeGroupMembers(
  fastify: FastifyInstance,
  actorUserId: string,
  groupId: string,
  data: RemoveGroupMembersInput,
) {
  const actor = await getActor(fastify, actorUserId)
  await getGroupInOrg(fastify, actor.organizationId, groupId)

  await fastify.prisma.groupMembership.deleteMany({
    where: {
      groupId,
      userId: { in: data.userIds },
      user: { organizationId: actor.organizationId },
    },
  })

  return { ok: true }
}

// ==================================================================
// Members
// ==================================================================

export async function listMembers(
  fastify: FastifyInstance,
  actorUserId: string,
  query: ListMembersQuery,
) {
  const actor = await getActor(fastify, actorUserId)

  const where = {
    organizationId: actor.organizationId,
    ...(query.role ? { role: query.role } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: 'insensitive' as const } },
            {
              fullName: { contains: query.q, mode: 'insensitive' as const },
            },
          ],
        }
      : {}),
    ...(query.groupId
      ? {
          groupMemberships: {
            some: { groupId: query.groupId },
          },
        }
      : {}),
  }

  const [total, users] = await Promise.all([
    fastify.prisma.user.count({ where }),
    fastify.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        invitedById: true,
        groupMemberships: {
          select: {
            group: {
              select: { id: true, name: true },
            },
          },
        },
        permissionOverrides: {
          select: { permission: true, isDeny: true },
        },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ])

  const items = users.map((u) => {
    const permissions = computeUserPermissions({
      role: u.role,
      groups: u.groupMemberships.map((m) => ({
        // نحتاج permissions المجموعة — إعادة جلب خفيفة عبر الاسم فقط للقائمة
        permissions: [], // تُحسب بالتفصيل في getMember
      })),
      overrides: u.permissionOverrides,
    })

    // للقائمة: حسب الدور + overrides فقط إن لم نحمّل permissions المجموعة
    // نحسب صح عبر إعادة استخدام نفس المنطق مع permissions من DB
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      invitedById: u.invitedById,
      groups: u.groupMemberships.map((m) => m.group),
      overrides: u.permissionOverrides,
      // permissions الكاملة في getMember / list مع include permissions
      permissionsPreview: permissions,
    }
  })

  // حساب permissions كاملة دفعة واحدة
  const full = await Promise.all(
    users.map(async (u) => {
      const perms = await getMemberEffectivePermissions(fastify, u.id)
      const row = items.find((i) => i.id === u.id)!
      return {
        ...row,
        permissions: perms,
        permissionsPreview: undefined,
      }
    }),
  )

  return {
    items: full.map(({ permissionsPreview: _, ...rest }) => rest),
    page: query.page,
    limit: query.limit,
    total,
  }
}

export async function getMember(
  fastify: FastifyInstance,
  actorUserId: string,
  targetUserId: string,
) {
  const actor = await getActor(fastify, actorUserId)
  const user = await fastify.prisma.user.findFirst({
    where: {
      id: targetUserId,
      organizationId: actor.organizationId,
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      invitedById: true,
      groupMemberships: {
        select: {
          group: {
            select: {
              id: true,
              name: true,
              permissions: true,
              isSystem: true,
            },
          },
        },
      },
      permissionOverrides: {
        select: {
          id: true,
          permission: true,
          isDeny: true,
          createdAt: true,
        },
      },
    },
  })

  if (!user) throw new Error('MEMBER_NOT_FOUND')

  const permissions = computeUserPermissions({
    role: user.role,
    groups: user.groupMemberships.map((m) => ({
      permissions: m.group.permissions,
    })),
    overrides: user.permissionOverrides,
  })

  return {
    ...user,
    groups: user.groupMemberships.map((m) => m.group),
    // نفس شكل القائمة (overrides)؛ permissionOverrides محفوظ للتوافق مع القديم
    overrides: user.permissionOverrides,
    permissions,
  }
}

export async function updateMemberRole(
  fastify: FastifyInstance,
  actorUserId: string,
  targetUserId: string,
  data: UpdateMemberRoleInput,
) {
  const actor = await getActor(fastify, actorUserId)
  const target = await getMemberInOrg(
    fastify,
    actor.organizationId,
    targetUserId,
  )

  assertCanManageTarget(actor.role, target.role, target.id, actor.id)

  if (target.role === 'OWNER') {
    throw new Error('CANNOT_MODIFY_OWNER')
  }
  if (targetUserId === actorUserId && actor.role === 'ADMIN') {
    // أدمن يقدر يغيّر دوره لتحت بمخاطره — نسمح
  }

  await fastify.prisma.user.update({
    where: { id: targetUserId },
    data: { role: data.role },
  })

  // Return full member (same shape as getMember) so clients keep groups/overrides/permissions
  return getMember(fastify, actorUserId, targetUserId)
}

export async function setMemberGroups(
  fastify: FastifyInstance,
  actorUserId: string,
  targetUserId: string,
  data: SetMemberGroupsInput,
) {
  const actor = await getActor(fastify, actorUserId)
  const target = await getMemberInOrg(
    fastify,
    actor.organizationId,
    targetUserId,
  )
  assertCanManageTarget(actor.role, target.role, target.id, actor.id)

  const groups =
    data.groupIds.length === 0
      ? []
      : await fastify.prisma.permissionGroup.findMany({
          where: {
            id: { in: data.groupIds },
            organizationId: actor.organizationId,
          },
          select: { id: true },
        })

  if (groups.length !== data.groupIds.length) {
    throw new Error('GROUP_NOT_FOUND')
  }

  await fastify.prisma.$transaction(async (tx) => {
    await tx.groupMembership.deleteMany({
      where: { userId: targetUserId },
    })
    if (groups.length > 0) {
      await tx.groupMembership.createMany({
        data: groups.map((g) => ({
          userId: targetUserId,
          groupId: g.id,
        })),
      })
    }
  })

  return getMember(fastify, actorUserId, targetUserId)
}

export async function deactivateMember(
  fastify: FastifyInstance,
  actorUserId: string,
  targetUserId: string,
) {
  const actor = await getActor(fastify, actorUserId)
  const target = await getMemberInOrg(
    fastify,
    actor.organizationId,
    targetUserId,
  )

  if (targetUserId === actorUserId) {
    throw new Error('CANNOT_DEACTIVATE_SELF')
  }
  assertCanManageTarget(actor.role, target.role, target.id, actor.id)
  if (target.role === 'OWNER') {
    throw new Error('CANNOT_MODIFY_OWNER')
  }

  await fastify.prisma.user.update({
    where: { id: targetUserId },
    data: { isActive: false },
  })

  return { ok: true }
}

export async function activateMember(
  fastify: FastifyInstance,
  actorUserId: string,
  targetUserId: string,
) {
  const actor = await getActor(fastify, actorUserId)
  const target = await getMemberInOrg(
    fastify,
    actor.organizationId,
    targetUserId,
  )
  assertCanManageTarget(actor.role, target.role, target.id, actor.id)

  await fastify.prisma.user.update({
    where: { id: targetUserId },
    data: { isActive: true },
  })

  return { ok: true }
}

// ==================================================================
// Overrides
// ==================================================================

export async function setUserOverrides(
  fastify: FastifyInstance,
  actorUserId: string,
  targetUserId: string,
  data: SetUserOverridesInput,
) {
  const actor = await getActor(fastify, actorUserId)
  const target = await getMemberInOrg(
    fastify,
    actor.organizationId,
    targetUserId,
  )
  assertCanManageTarget(actor.role, target.role, target.id, actor.id)

  await fastify.prisma.$transaction(async (tx) => {
    await tx.userPermissionOverride.deleteMany({
      where: { userId: targetUserId },
    })
    if (data.overrides.length > 0) {
      await tx.userPermissionOverride.createMany({
        data: data.overrides.map((o) => ({
          userId: targetUserId,
          permission: o.permission,
          isDeny: o.isDeny,
        })),
      })
    }
  })

  return getMember(fastify, actorUserId, targetUserId)
}

export async function upsertUserOverride(
  fastify: FastifyInstance,
  actorUserId: string,
  targetUserId: string,
  data: UpsertUserOverrideInput,
) {
  const actor = await getActor(fastify, actorUserId)
  const target = await getMemberInOrg(
    fastify,
    actor.organizationId,
    targetUserId,
  )
  assertCanManageTarget(actor.role, target.role, target.id, actor.id)

  await fastify.prisma.userPermissionOverride.upsert({
    where: {
      userId_permission: {
        userId: targetUserId,
        permission: data.permission,
      },
    },
    create: {
      userId: targetUserId,
      permission: data.permission,
      isDeny: data.isDeny,
    },
    update: { isDeny: data.isDeny },
  })

  return getMember(fastify, actorUserId, targetUserId)
}

export async function deleteUserOverride(
  fastify: FastifyInstance,
  actorUserId: string,
  targetUserId: string,
  permission: string,
) {
  const actor = await getActor(fastify, actorUserId)
  const target = await getMemberInOrg(
    fastify,
    actor.organizationId,
    targetUserId,
  )
  assertCanManageTarget(actor.role, target.role, target.id, actor.id)

  await fastify.prisma.userPermissionOverride.deleteMany({
    where: { userId: targetUserId, permission },
  })

  return getMember(fastify, actorUserId, targetUserId)
}

// ==================================================================
// Invites
// ==================================================================

export async function listInvites(
  fastify: FastifyInstance,
  actorUserId: string,
  query: ListInvitesQuery,
) {
  const actor = await getActor(fastify, actorUserId)

  // تعليم المنتهي تلقائيًا
  await fastify.prisma.teamInvite.updateMany({
    where: {
      organizationId: actor.organizationId,
      status: 'PENDING',
      expiresAt: { lt: new Date() },
    },
    data: { status: 'EXPIRED' },
  })

  const where = {
    organizationId: actor.organizationId,
    ...(query.status
      ? { status: query.status as TeamInviteStatus }
      : {}),
  }

  const [total, items] = await Promise.all([
    fastify.prisma.teamInvite.count({ where }),
    fastify.prisma.teamInvite.findMany({
      where,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        usedAt: true,
        initialGroupIds: true,
        createdAt: true,
        invitedBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ])

  return { items, page: query.page, limit: query.limit, total }
}

export async function createTeamInvite(
  fastify: FastifyInstance,
  actorUserId: string,
  data: CreateTeamInviteInput,
) {
  const actor = await getActor(fastify, actorUserId)
  const org = await fastify.prisma.organization.findUnique({
    where: { id: actor.organizationId },
    select: { id: true, name: true, isActive: true },
  })
  if (!org?.isActive) throw new Error('ORGANIZATION_DISABLED')

  if (data.role === 'OWNER') throw new Error('CANNOT_ASSIGN_OWNER')

  const existingUser = await fastify.prisma.user.findUnique({
    where: { email: data.email },
  })
  if (existingUser) {
    if (existingUser.organizationId === actor.organizationId) {
      throw new Error('USER_ALREADY_IN_ORG')
    }
    throw new Error('EMAIL_ALREADY_EXISTS')
  }

  const pending = await fastify.prisma.teamInvite.findFirst({
    where: {
      organizationId: actor.organizationId,
      email: data.email,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
  })
  if (pending) throw new Error('INVITE_ALREADY_PENDING')

  // تحقق المجموعات تابعة لنفس المنظمة
  const groupIds = data.initialGroupIds ?? []
  if (groupIds.length > 0) {
    const count = await fastify.prisma.permissionGroup.count({
      where: {
        id: { in: groupIds },
        organizationId: actor.organizationId,
      },
    })
    if (count !== groupIds.length) throw new Error('GROUP_NOT_FOUND')
  }

  const hours = inviteTtlHours(data.expiresInHours)
  const token = generateInviteToken()
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)

  const invite = await fastify.prisma.teamInvite.create({
    data: {
      email: data.email,
      token,
      role: data.role,
      status: 'PENDING',
      expiresAt,
      initialGroupIds: groupIds,
      organizationId: actor.organizationId,
      invitedById: actor.id,
    },
  })

  const emailResult = await sendTeamInviteEmail({
    to: data.email,
    inviteToken: token,
    organizationName: org.name,
    inviterName: actor.fullName,
    role: data.role,
    expiresInHours: hours,
  })

  return {
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
      initialGroupIds: invite.initialGroupIds,
      createdAt: invite.createdAt,
    },
    email: {
      ok: emailResult.ok,
      skipped: emailResult.skipped ?? false,
      id: emailResult.id,
      acceptUrl: emailResult.acceptUrl,
      error: emailResult.error,
    },
  }
}

export async function resendTeamInvite(
  fastify: FastifyInstance,
  actorUserId: string,
  inviteId: string,
  data: ResendTeamInviteInput = {},
) {
  const actor = await getActor(fastify, actorUserId)
  const invite = await fastify.prisma.teamInvite.findFirst({
    where: {
      id: inviteId,
      organizationId: actor.organizationId,
    },
    include: {
      organization: { select: { name: true, isActive: true } },
    },
  })

  if (!invite) throw new Error('INVITE_NOT_FOUND')
  if (invite.status === 'ACCEPTED') throw new Error('INVITE_ALREADY_USED')
  if (invite.status === 'REVOKED') throw new Error('INVITE_REVOKED')
  if (!invite.organization.isActive) throw new Error('ORGANIZATION_DISABLED')

  const hours = inviteTtlHours(data.expiresInHours)
  const token = generateInviteToken()
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)

  const updated = await fastify.prisma.teamInvite.update({
    where: { id: invite.id },
    data: {
      token,
      status: 'PENDING',
      expiresAt,
      usedAt: null,
    },
  })

  const emailResult = await sendTeamInviteEmail({
    to: updated.email,
    inviteToken: token,
    organizationName: invite.organization.name,
    inviterName: actor.fullName,
    role: updated.role,
    expiresInHours: hours,
  })

  return {
    invite: {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      status: updated.status,
      expiresAt: updated.expiresAt,
    },
    email: {
      ok: emailResult.ok,
      skipped: emailResult.skipped ?? false,
      acceptUrl: emailResult.acceptUrl,
      error: emailResult.error,
    },
  }
}

export async function revokeTeamInvite(
  fastify: FastifyInstance,
  actorUserId: string,
  inviteId: string,
) {
  const actor = await getActor(fastify, actorUserId)
  const invite = await fastify.prisma.teamInvite.findFirst({
    where: {
      id: inviteId,
      organizationId: actor.organizationId,
    },
  })

  if (!invite) throw new Error('INVITE_NOT_FOUND')
  if (invite.status === 'ACCEPTED') throw new Error('INVITE_ALREADY_USED')

  await fastify.prisma.teamInvite.update({
    where: { id: invite.id },
    data: { status: 'REVOKED' },
  })

  return { ok: true }
}

// ==================================================================
// اختياري: إعادة إصدار توكن لعضو بعد تغيير صلاحياته
// (الفرونت يعتمد على login من جديد أو X-Access-Token refresh)
// ==================================================================

export async function issueRefreshedTokenForMember(
  fastify: FastifyInstance,
  actorUserId: string,
  targetUserId: string,
) {
  const actor = await getActor(fastify, actorUserId)
  await getMemberInOrg(fastify, actor.organizationId, targetUserId)
  const token = await refreshTokenForUser(fastify, targetUserId)
  return { token }
}

// ------------------------------------------------------------------
// تصدير موحّد
// ------------------------------------------------------------------

export default {
  getPermissionsCatalog,
  ensureSystemGroups,
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  addGroupMembers,
  removeGroupMembers,
  listMembers,
  getMember,
  updateMemberRole,
  setMemberGroups,
  deactivateMember,
  activateMember,
  setUserOverrides,
  upsertUserOverride,
  deleteUserOverride,
  listInvites,
  createTeamInvite,
  resendTeamInvite,
  revokeTeamInvite,
  getMemberEffectivePermissions,
  issueRefreshedTokenForMember,
}