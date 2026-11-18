/**
 * backend/src/modules/auth/auth.service.ts
 * ==================================================================
 * Zero Plus - Auth Service
 * WebAuthn / Passkeys + JWT بصلاحيات + قبول TeamInvite
 *
 * التوكن يحتوي: id · email · role · organizationId · permissions[] · passkeyId?
 * ==================================================================
 */

import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server'
import type { UserRole } from '@prisma/client'
import { computeUserPermissions } from '../../lib/permissions.js'
import type {
  RegisterStartInput,
  RegisterFinishInput,
  LoginStartInput,
  LoginFinishInput,
  UpdateProfileInput,
  SetPasswordInput,
  FinishPasskeyInviteInput,
} from './auth.schema.js'

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------

const SALT_ROUNDS = 12

function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID || 'localhost'
}

function getRpName(): string {
  return process.env.WEBAUTHN_RP_NAME || 'Zero Plus'
}

function getOrigin(): string {
  return process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173'
}

function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || process.env.APP_URL || getOrigin()
}

const CHALLENGE_TTL_SEC = Number(process.env.WEBAUTHN_CHALLENGE_TTL_SEC ?? 60)
const INVITE_TTL_MINUTES = Number(process.env.PASSKEY_INVITE_TTL_MINUTES ?? 5)
const TEAM_INVITE_CHALLENGE_PREFIX = 'team-reg:'

// ------------------------------------------------------------------
// Challenge store (Redis أو memory)
// ------------------------------------------------------------------

type ChallengeRecord = {
  challenge: string
  pending?: {
    organizationName: string
    fullName: string
    email: string
    sizeProfile: string
    passwordHash: string | null
  }
  userId?: string
  /** قبول دعوة فريق */
  teamInviteToken?: string
}

type RedisLike = {
  set: (key: string, value: string, mode: string, ttl: number) => Promise<unknown>
  get: (key: string) => Promise<string | null>
  del: (key: string) => Promise<unknown>
}

function getRedis(fastify: FastifyInstance): RedisLike | null {
  const r = (fastify as FastifyInstance & { redis?: RedisLike }).redis
  return r && typeof r.set === 'function' && typeof r.get === 'function' ? r : null
}

async function saveChallenge(
  fastify: FastifyInstance,
  key: string,
  record: ChallengeRecord,
  ttlSec: number = CHALLENGE_TTL_SEC,
): Promise<void> {
  const payload = JSON.stringify(record)
  const redis = getRedis(fastify)
  if (redis) {
    await redis.set(`webauthn:${key}`, payload, 'EX', ttlSec)
    return
  }
  const g = globalThis as unknown as {
    __zpChallenges?: Map<string, { exp: number; data: string }>
  }
  if (!g.__zpChallenges) g.__zpChallenges = new Map()
  g.__zpChallenges.set(key, {
    exp: Date.now() + ttlSec * 1000,
    data: payload,
  })
}

async function takeChallenge(
  fastify: FastifyInstance,
  key: string,
): Promise<ChallengeRecord | null> {
  const redis = getRedis(fastify)
  if (redis) {
    const raw = await redis.get(`webauthn:${key}`)
    if (!raw) return null
    await redis.del(`webauthn:${key}`)
    return JSON.parse(raw) as ChallengeRecord
  }
  const g = globalThis as unknown as {
    __zpChallenges?: Map<string, { exp: number; data: string }>
  }
  const store = g.__zpChallenges
  if (!store) return null
  const entry = store.get(key)
  store.delete(key)
  if (!entry || entry.exp < Date.now()) return null
  return JSON.parse(entry.data) as ChallengeRecord
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * يجلب الدور + المجموعات + الاستثناءات ويحسب permissions[]
 */
export async function loadUserPermissionContext(
  fastify: FastifyInstance,
  userId: string,
): Promise<{
  role: UserRole
  permissions: string[]
  organizationId: string
  email: string
  fullName: string
  isActive: boolean
}> {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      organizationId: true,
      isActive: true,
      groupMemberships: {
        select: {
          group: {
            select: { permissions: true },
          },
        },
      },
      permissionOverrides: {
        select: {
          permission: true,
          isDeny: true,
        },
      },
    },
  })

  if (!user) {
    throw new Error('USER_NOT_FOUND')
  }

  const permissions = computeUserPermissions({
    role: user.role,
    groups: user.groupMemberships.map((m: { group: { permissions: any } }) => ({
      permissions: m.group.permissions,
    })),
    overrides: user.permissionOverrides,
  })

  return {
    role: user.role,
    permissions,
    organizationId: user.organizationId,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
  }
}

/**
 * يوقّع JWT بالصلاحيات (يستخدم signAccessToken من الـ plugin إن وُجد)
 */
export function issueAccessToken(
  fastify: FastifyInstance,
  payload: {
    id: string
    email: string
    role: string
    organizationId: string
    permissions: string[]
    passkeyId?: string
    tokenVersion?: number
  },
): string {
  if (typeof fastify.signAccessToken === 'function') {
    return fastify.signAccessToken({
      id: payload.id,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
      permissions: payload.permissions,
      passkeyId: payload.passkeyId,
      tokenVersion: payload.tokenVersion,
    })
  }

  // fallback لو الـ plugin لسه ما اتحملش في اختبارات
  return fastify.jwt.sign({
    id: payload.id,
    email: payload.email,
    role: payload.role,
    organizationId: payload.organizationId,
    permissions: payload.permissions,
    ...(payload.passkeyId ? { passkeyId: payload.passkeyId } : {}),
    ...(typeof payload.tokenVersion === 'number'
      ? { tokenVersion: payload.tokenVersion }
      : {}),
  })
}

// ==================================================================
// REGISTER START
// ==================================================================

export async function registerStart(
  fastify: FastifyInstance,
  data: RegisterStartInput,
) {
  const {
    organizationName,
    fullName,
    email,
    sizeProfile = 'medium',
    password,
  } = data

  const existingUser = await fastify.prisma.user.findUnique({
    where: { email },
  })
  if (existingUser) {
    throw new Error('EMAIL_ALREADY_EXISTS')
  }

  const passwordHash = password ? await hashPassword(password) : null

  const options = await generateRegistrationOptions({
    rpName: getRpName(),
    rpID: getRpId(),
    userName: email,
    userDisplayName: fullName,
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
      requireResidentKey: false,
    },
    supportedAlgorithmIDs: [-7, -257],
  })

  await saveChallenge(fastify, `reg:${email}`, {
    challenge: options.challenge,
    pending: {
      organizationName,
      fullName,
      email,
      sizeProfile,
      passwordHash,
    },
  })

  return {
    options,
    rpId: getRpId(),
  }
}

// ==================================================================
// REGISTER FINISH — Org + User OWNER + Passkey + Policy + JWT بصلاحيات
// ==================================================================

export async function registerFinish(
  fastify: FastifyInstance,
  data: RegisterFinishInput,
) {
  const { email, deviceName, credential } = data

  const record = await takeChallenge(fastify, `reg:${email}`)
  if (!record?.pending || !record.challenge) {
    throw new Error('CHALLENGE_EXPIRED')
  }

  const pending = record.pending

  let verification: VerifiedRegistrationResponse
  try {
    verification = await verifyRegistrationResponse({
      response: credential as any,
      expectedChallenge: record.challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpId(),
      requireUserVerification: true,
    })
  } catch {
    throw new Error('WEBAUTHN_VERIFICATION_FAILED')
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('WEBAUTHN_VERIFICATION_FAILED')
  }

  const { credential: regCred, credentialDeviceType } =
    verification.registrationInfo

  const credentialId = regCred.id
  const counter = regCred.counter
  const transports = (credential.response.transports ?? []) as string[]
  const aaguid =
    (verification.registrationInfo as any).aaguid?.toString?.() ?? null

  const existingUser = await fastify.prisma.user.findUnique({
    where: { email: pending.email },
  })
  if (existingUser) {
    throw new Error('EMAIL_ALREADY_EXISTS')
  }

  const existingCred = await fastify.prisma.passkeyCredential.findUnique({
    where: { credentialId },
  })
  if (existingCred) {
    throw new Error('PASSKEY_ALREADY_REGISTERED')
  }

  let slug = generateSlug(pending.organizationName)
  const existingOrg = await fastify.prisma.organization.findUnique({
    where: { slug },
  })
  if (existingOrg) {
    slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`
  }

  const result = await fastify.prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: pending.organizationName,
        slug,
        plan: 'free',
        isActive: true,
        sizeProfile: pending.sizeProfile,
      },
    })

    const user = await tx.user.create({
      data: {
        email: pending.email,
        fullName: pending.fullName,
        passwordHash: pending.passwordHash,
        role: 'OWNER',
        organizationId: organization.id,
        isActive: true,
        lastLoginAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        organizationId: true,
        createdAt: true,
      },
    })

    const passkey = await tx.passkeyCredential.create({
      data: {
        credentialId,
        publicKey: new Uint8Array(regCred.publicKey),
        counter,
        transports,
        deviceName: deviceName ?? credentialDeviceType ?? 'Passkey',
        aaguid,
        userId: user.id,
        lastUsedAt: new Date(),
      },
      select: {
        id: true,
        deviceName: true,
        transports: true,
        createdAt: true,
      },
    })

    await tx.policy.create({
      data: { organizationId: organization.id },
    })

    return { user, organization, passkey }
  })

  // OWNER → كل الصلاحيات من الكتالوج
  const permissions = computeUserPermissions({
    role: result.user.role as UserRole,
    groups: [],
    overrides: [],
  })

  const token = issueAccessToken(fastify, {
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    organizationId: result.user.organizationId,
    permissions,
    passkeyId: result.passkey.id,
  })

  return {
    token,
    user: {
      id: result.user.id,
      email: result.user.email,
      fullName: result.user.fullName,
      role: result.user.role,
      organizationId: result.user.organizationId,
      permissions,
    },
    organization: {
      id: result.organization.id,
      name: result.organization.name,
      slug: result.organization.slug,
      sizeProfile: result.organization.sizeProfile,
    },
    passkey: {
      id: result.passkey.id,
      deviceName: result.passkey.deviceName,
      transports: result.passkey.transports,
    },
  }
}

// ==================================================================
// LOGIN START
// ==================================================================

export async function loginStart(
  fastify: FastifyInstance,
  data: LoginStartInput,
) {
  const { email } = data

  const user = await fastify.prisma.user.findUnique({
    where: { email },
    include: {
      passkeys: {
        where: { isRevoked: false },
        select: {
          credentialId: true,
          transports: true,
        },
      },
      organization: {
        select: { isActive: true },
      },
    },
  })

  if (
    !user ||
    !user.isActive ||
    !user.organization.isActive ||
    user.passkeys.length === 0
  ) {
    throw new Error('INVALID_CREDENTIALS')
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: 'required',
    allowCredentials: user.passkeys.map((pk) => ({
      id: pk.credentialId,
      transports: pk.transports as AuthenticatorTransport[],
    })),
  })

  await saveChallenge(fastify, `login:${email}`, {
    challenge: options.challenge,
    userId: user.id,
  })

  return {
    options,
    rpId: getRpId(),
  }
}

// ==================================================================
// LOGIN FINISH — JWT بالصلاحيات المحسوبة من DB
// ==================================================================

export async function loginFinish(
  fastify: FastifyInstance,
  data: LoginFinishInput,
) {
  const { email, credential } = data

  const record = await takeChallenge(fastify, `login:${email}`)
  if (!record?.challenge || !record.userId) {
    throw new Error('CHALLENGE_EXPIRED')
  }

  const passkey = await fastify.prisma.passkeyCredential.findFirst({
    where: {
      credentialId: credential.id,
      isRevoked: false,
      userId: record.userId,
    },
    include: {
      user: {
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              isActive: true,
              sizeProfile: true,
            },
          },
        },
      },
    },
  })

  if (!passkey?.user) {
    throw new Error('INVALID_CREDENTIALS')
  }

  const user = passkey.user

  if (!user.isActive) throw new Error('ACCOUNT_DISABLED')
  if (!user.organization.isActive) throw new Error('ORGANIZATION_DISABLED')

  let verification: VerifiedAuthenticationResponse
  try {
    verification = await verifyAuthenticationResponse({
      response: credential as any,
      expectedChallenge: record.challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpId(),
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports as AuthenticatorTransport[],
      },
      requireUserVerification: true,
    })
  } catch {
    throw new Error('WEBAUTHN_VERIFICATION_FAILED')
  }

  if (!verification.verified) {
    throw new Error('WEBAUTHN_VERIFICATION_FAILED')
  }

  const newCounter = verification.authenticationInfo.newCounter

  await fastify.prisma.$transaction([
    fastify.prisma.passkeyCredential.update({
      where: { id: passkey.id },
      data: {
        counter: newCounter,
        lastUsedAt: new Date(),
      },
    }),
    fastify.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
  ])

  const ctx = await loadUserPermissionContext(fastify, user.id)

  const token = issueAccessToken(fastify, {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    permissions: ctx.permissions,
    passkeyId: passkey.id,
  })

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      permissions: ctx.permissions,
    },
    organization: {
      id: user.organization.id,
      name: user.organization.name,
      slug: user.organization.slug,
      sizeProfile: user.organization.sizeProfile,
    },
    passkey: {
      id: passkey.id,
      deviceName: passkey.deviceName,
    },
  }
}

// ==================================================================
// TEAM INVITE — قبول دعوة عضو جديد (Passkey أول مرة)
// مختلف عن PasskeyInvite (إضافة جهاز لمستخدم موجود)
// ==================================================================

/**
 * بداية تسجيل عضو مدعو: التحقق من TeamInvite + registration options
 */
export async function teamInviteRegisterStart(
  fastify: FastifyInstance,
  inviteToken: string,
  fullName?: string,
) {
  const invite = await fastify.prisma.teamInvite.findUnique({
    where: { token: inviteToken },
    include: {
      organization: {
        select: { id: true, name: true, isActive: true },
      },
    },
  })

  if (!invite) throw new Error('INVITE_NOT_FOUND')
  if (invite.status === 'REVOKED') throw new Error('INVITE_REVOKED')
  if (invite.status === 'ACCEPTED') throw new Error('INVITE_ALREADY_USED')
  if (invite.expiresAt < new Date() || invite.status === 'EXPIRED') {
    throw new Error('INVITE_EXPIRED')
  }
  if (!invite.organization.isActive) throw new Error('ORGANIZATION_DISABLED')

  const existing = await fastify.prisma.user.findUnique({
    where: { email: invite.email },
  })
  if (existing) throw new Error('EMAIL_ALREADY_EXISTS')

  const displayName = (fullName || invite.email.split('@')[0] || 'User').trim()

  const options = await generateRegistrationOptions({
    rpName: getRpName(),
    rpID: getRpId(),
    userName: invite.email,
    userDisplayName: displayName,
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
      requireResidentKey: false,
    },
    supportedAlgorithmIDs: [-7, -257],
  })

  await saveChallenge(
    fastify,
    `${TEAM_INVITE_CHALLENGE_PREFIX}${inviteToken}`,
    {
      challenge: options.challenge,
      teamInviteToken: inviteToken,
      pending: {
        organizationName: invite.organization.name,
        fullName: displayName,
        email: invite.email,
        sizeProfile: 'medium',
        passwordHash: null,
      },
    },
    Math.max(CHALLENGE_TTL_SEC, 120),
  )

  return {
    options,
    rpId: getRpId(),
    invite: {
      email: invite.email,
      role: invite.role,
      organizationName: invite.organization.name,
      expiresAt: invite.expiresAt,
    },
  }
}

/**
 * إنهاء قبول الدعوة: User + Passkey + مجموعات أولية + JWT
 */
export async function teamInviteRegisterFinish(
  fastify: FastifyInstance,
  inviteToken: string,
  data: {
    fullName?: string
    deviceName?: string
    credential: FinishPasskeyInviteInput['credential']
  },
) {
  const record = await takeChallenge(
    fastify,
    `${TEAM_INVITE_CHALLENGE_PREFIX}${inviteToken}`,
  )
  if (!record?.challenge || record.teamInviteToken !== inviteToken) {
    throw new Error('CHALLENGE_EXPIRED')
  }

  const invite = await fastify.prisma.teamInvite.findUnique({
    where: { token: inviteToken },
    include: {
      organization: { select: { id: true, name: true, slug: true, isActive: true, sizeProfile: true } },
    },
  })

  if (!invite) throw new Error('INVITE_NOT_FOUND')
  if (invite.status !== 'PENDING') throw new Error('INVITE_ALREADY_USED')
  if (invite.expiresAt < new Date()) throw new Error('INVITE_EXPIRED')
  if (!invite.organization.isActive) throw new Error('ORGANIZATION_DISABLED')

  let verification: VerifiedRegistrationResponse
  try {
    verification = await verifyRegistrationResponse({
      response: data.credential as any,
      expectedChallenge: record.challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpId(),
      requireUserVerification: true,
    })
  } catch {
    throw new Error('WEBAUTHN_VERIFICATION_FAILED')
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('WEBAUTHN_VERIFICATION_FAILED')
  }

  const { credential: regCred, credentialDeviceType } =
    verification.registrationInfo

  const existingUser = await fastify.prisma.user.findUnique({
    where: { email: invite.email },
  })
  if (existingUser) throw new Error('EMAIL_ALREADY_EXISTS')

  const existingCred = await fastify.prisma.passkeyCredential.findUnique({
    where: { credentialId: regCred.id },
  })
  if (existingCred) throw new Error('PASSKEY_ALREADY_REGISTERED')

  const fullName =
    (data.fullName || record.pending?.fullName || invite.email.split('@')[0] || 'User').trim()

  const initialGroupIds = Array.isArray(invite.initialGroupIds)
    ? invite.initialGroupIds.filter(Boolean)
    : []

  const result = await fastify.prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: invite.email,
        fullName,
        role: invite.role,
        organizationId: invite.organizationId,
        invitedById: invite.invitedById,
        isActive: true,
        lastLoginAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        organizationId: true,
      },
    })

    const passkey = await tx.passkeyCredential.create({
      data: {
        credentialId: regCred.id,
        publicKey: new Uint8Array(regCred.publicKey),
        counter: regCred.counter,
        transports: (data.credential.response.transports ?? []) as string[],
        deviceName:
          data.deviceName ?? credentialDeviceType ?? 'Passkey',
        aaguid:
          (verification.registrationInfo as any).aaguid?.toString?.() ?? null,
        userId: user.id,
        lastUsedAt: new Date(),
      },
      select: {
        id: true,
        deviceName: true,
        transports: true,
      },
    })

    // ربط المجموعات الأولية (لو موجودة وتابعة لنفس المنظمة)
    if (initialGroupIds.length > 0) {
      const groups = await tx.permissionGroup.findMany({
        where: {
          id: { in: initialGroupIds },
          organizationId: invite.organizationId,
        },
        select: { id: true },
      })
      for (const g of groups) {
        await tx.groupMembership.create({
          data: { userId: user.id, groupId: g.id },
        })
      }
    }

    await tx.teamInvite.update({
      where: { id: invite.id },
      data: {
        status: 'ACCEPTED',
        usedAt: new Date(),
        acceptedByUserId: user.id,
      },
    })

    return { user, passkey }
  })

  const ctx = await loadUserPermissionContext(fastify, result.user.id)

  const token = issueAccessToken(fastify, {
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    organizationId: result.user.organizationId,
    permissions: ctx.permissions,
    passkeyId: result.passkey.id,
  })

  return {
    token,
    user: {
      id: result.user.id,
      email: result.user.email,
      fullName: result.user.fullName,
      role: result.user.role,
      organizationId: result.user.organizationId,
      permissions: ctx.permissions,
    },
    organization: {
      id: invite.organization.id,
      name: invite.organization.name,
      slug: invite.organization.slug,
      sizeProfile: invite.organization.sizeProfile,
    },
    passkey: {
      id: result.passkey.id,
      deviceName: result.passkey.deviceName,
      transports: result.passkey.transports,
    },
  }
}

/**
 * معاينة دعوة فريق (بدون challenge) — للصفحة قبل Passkey
 */
export async function getTeamInvitePreview(
  fastify: FastifyInstance,
  inviteToken: string,
) {
  const invite = await fastify.prisma.teamInvite.findUnique({
    where: { token: inviteToken },
    include: {
      organization: { select: { name: true, isActive: true } },
      invitedBy: { select: { fullName: true, email: true } },
    },
  })

  if (!invite) throw new Error('INVITE_NOT_FOUND')
  if (invite.status === 'REVOKED') throw new Error('INVITE_REVOKED')
  if (invite.status === 'ACCEPTED') throw new Error('INVITE_ALREADY_USED')
  if (invite.expiresAt < new Date()) throw new Error('INVITE_EXPIRED')

  return {
    email: invite.email,
    role: invite.role,
    organizationName: invite.organization.name,
    invitedByName: invite.invitedBy.fullName,
    expiresAt: invite.expiresAt,
    status: invite.status,
  }
}

// ==================================================================
// CREATE PASSKEY INVITE (جهاز إضافي لمستخدم موجود)
// ==================================================================

export async function createPasskeyInvite(
  fastify: FastifyInstance,
  userId: string,
) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    include: {
      passkeys: {
        where: { isRevoked: false },
        select: { credentialId: true, transports: true },
      },
    },
  })

  if (!user || !user.isActive) {
    throw new Error('USER_NOT_FOUND')
  }

  const token = generateInviteToken()

  const options = await generateRegistrationOptions({
    rpName: getRpName(),
    rpID: getRpId(),
    userName: user.email,
    userDisplayName: user.fullName,
    excludeCredentials: user.passkeys.map((pk) => ({
      id: pk.credentialId,
      transports: pk.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257],
  })

  const expiresAt = new Date(Date.now() + INVITE_TTL_MINUTES * 60 * 1000)

  await fastify.prisma.passkeyInvite.create({
    data: {
      token,
      challenge: options.challenge,
      expiresAt,
      userId,
    },
  })

  const inviteUrl = `${getFrontendUrl()}/add-device/${token}`

  return {
    token,
    url: inviteUrl,
    expiresAt,
    expiresInSeconds: INVITE_TTL_MINUTES * 60,
    options,
    rpId: getRpId(),
  }
}

// ==================================================================
// GET / FINISH PASSKEY INVITE
// ==================================================================

export async function getPasskeyInviteOptions(
  fastify: FastifyInstance,
  token: string,
) {
  const invite = await fastify.prisma.passkeyInvite.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          isActive: true,
          passkeys: {
            where: { isRevoked: false },
            select: { credentialId: true, transports: true },
          },
        },
      },
    },
  })

  if (!invite) throw new Error('INVITE_NOT_FOUND')
  if (invite.usedAt) throw new Error('INVITE_ALREADY_USED')
  if (invite.expiresAt < new Date()) throw new Error('INVITE_EXPIRED')
  if (!invite.user.isActive) throw new Error('USER_NOT_FOUND')

  const options = await generateRegistrationOptions({
    rpName: getRpName(),
    rpID: getRpId(),
    userName: invite.user.email,
    userDisplayName: invite.user.fullName,
    excludeCredentials: invite.user.passkeys.map((pk) => ({
      id: pk.credentialId,
      transports: pk.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257],
  })

  await fastify.prisma.passkeyInvite.update({
    where: { id: invite.id },
    data: { challenge: options.challenge },
  })

  return {
    options,
    rpId: getRpId(),
    user: {
      fullName: invite.user.fullName,
      email: invite.user.email,
    },
    expiresAt: invite.expiresAt,
  }
}

export async function finishPasskeyInvite(
  fastify: FastifyInstance,
  token: string,
  data: FinishPasskeyInviteInput,
) {
  const { deviceName, credential } = data

  const invite = await fastify.prisma.passkeyInvite.findUnique({
    where: { token },
    include: {
      user: { select: { id: true, isActive: true } },
    },
  })

  if (!invite) throw new Error('INVITE_NOT_FOUND')
  if (invite.usedAt) throw new Error('INVITE_ALREADY_USED')
  if (invite.expiresAt < new Date()) throw new Error('INVITE_EXPIRED')
  if (!invite.user.isActive) throw new Error('USER_NOT_FOUND')
  if (!invite.challenge) throw new Error('CHALLENGE_EXPIRED')

  let verification: VerifiedRegistrationResponse
  try {
    verification = await verifyRegistrationResponse({
      response: credential as any,
      expectedChallenge: invite.challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpId(),
      requireUserVerification: true,
    })
  } catch {
    throw new Error('WEBAUTHN_VERIFICATION_FAILED')
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('WEBAUTHN_VERIFICATION_FAILED')
  }

  const { credential: regCred, credentialDeviceType } =
    verification.registrationInfo

  const existingCred = await fastify.prisma.passkeyCredential.findUnique({
    where: { credentialId: regCred.id },
  })
  if (existingCred) throw new Error('PASSKEY_ALREADY_REGISTERED')

  const passkey = await fastify.prisma.$transaction(async (tx) => {
    const created = await tx.passkeyCredential.create({
      data: {
        credentialId: regCred.id,
        publicKey: new Uint8Array(regCred.publicKey),
        counter: regCred.counter,
        transports: (credential.response.transports ?? []) as string[],
        deviceName: deviceName ?? credentialDeviceType ?? 'Passkey',
        aaguid:
          (verification.registrationInfo as any).aaguid?.toString?.() ?? null,
        userId: invite.userId,
        lastUsedAt: new Date(),
      },
      select: {
        id: true,
        deviceName: true,
        transports: true,
        createdAt: true,
      },
    })

    await tx.passkeyInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    })

    return created
  })

  return {
    passkey,
    message: 'Device added successfully',
  }
}

// ==================================================================
// REVOKE / LIST PASSKEYS
// ==================================================================

export async function revokePasskey(
  fastify: FastifyInstance,
  userId: string,
  passkeyId: string,
) {
  const passkey = await fastify.prisma.passkeyCredential.findFirst({
    where: { id: passkeyId, userId },
  })

  if (!passkey) throw new Error('PASSKEY_NOT_FOUND')

  const activeCount = await fastify.prisma.passkeyCredential.count({
    where: { userId, isRevoked: false },
  })

  if (activeCount <= 1 && !passkey.isRevoked) {
    throw new Error('CANNOT_REVOKE_LAST_PASSKEY')
  }

  await fastify.prisma.passkeyCredential.update({
    where: { id: passkeyId },
    data: { isRevoked: true },
  })

  return { ok: true }
}

export async function listPasskeys(fastify: FastifyInstance, userId: string) {
  return fastify.prisma.passkeyCredential.findMany({
    where: { userId, isRevoked: false },
    select: {
      id: true,
      deviceName: true,
      transports: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { lastUsedAt: 'desc' },
  })
}

// ==================================================================
// GET ME — مع permissions حالية من DB
// ==================================================================

export async function getMe(fastify: FastifyInstance, userId: string) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      organizationId: true,
      lastLoginAt: true,
      createdAt: true,
      uiPreferences: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          sizeProfile: true,
        },
      },
      passkeys: {
        where: { isRevoked: false },
        select: {
          id: true,
          deviceName: true,
          transports: true,
          lastUsedAt: true,
          createdAt: true,
        },
      },
      groupMemberships: {
        select: {
          group: {
            select: {
              id: true,
              name: true,
              permissions: true,
            },
          },
        },
      },
    },
  })

  if (!user) throw new Error('USER_NOT_FOUND')

  const ctx = await loadUserPermissionContext(fastify, userId)

  return {
    ...user,
    permissions: ctx.permissions,
    groups: (user.groupMemberships as unknown as Array<{
      group: { id: string; name: string; permissions: unknown }
    }>).map((m) => {
      return ({
        id: m.group.id,
        name: m.group.name,
        permissions: m.group.permissions,
      })
    }),
  }
}

/**
 * إعادة إصدار توكن بعد تغيير صلاحيات المستخدم (من team.service)
 */
export async function refreshTokenForUser(
  fastify: FastifyInstance,
  userId: string,
  passkeyId?: string,
) {
  const ctx = await loadUserPermissionContext(fastify, userId)
  if (!ctx.isActive) throw new Error('ACCOUNT_DISABLED')

  return issueAccessToken(fastify, {
    id: userId,
    email: ctx.email,
    role: ctx.role,
    organizationId: ctx.organizationId,
    permissions: ctx.permissions,
    passkeyId,
  })
}

// ==================================================================
// UPDATE PROFILE / SET PASSWORD
// ==================================================================

export async function updateProfile(
  fastify: FastifyInstance,
  userId: string,
  data: UpdateProfileInput,
) {
  return fastify.prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.fullName ? { fullName: data.fullName } : {}),
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      organizationId: true,
    },
  })
}

export async function setPassword(
  fastify: FastifyInstance,
  userId: string,
  data: SetPasswordInput,
) {
  const passwordHash = await hashPassword(data.newPassword)
  await fastify.prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  })
  return { ok: true }
}