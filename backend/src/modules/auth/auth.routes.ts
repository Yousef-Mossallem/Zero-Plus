/**
 * backend/src/modules/auth/auth.routes.ts
 * ==================================================================
 * Zero Plus - Auth Routes
 * WebAuthn / Passkeys + Team Invite accept
 * ==================================================================
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from 'fastify'

import {
  registerStartSchema,
  registerFinishSchema,
  loginStartSchema,
  loginFinishSchema,
  revokePasskeySchema,
  updateProfileSchema,
  setPasswordSchema,
  createPasskeyInviteSchema,
  finishPasskeyInviteSchema,
  teamInviteRegisterStartSchema,
  teamInviteRegisterFinishSchema,
} from './auth.schema.js'

import {
  registerStart,
  registerFinish,
  loginStart,
  loginFinish,
  revokePasskey,
  listPasskeys,
  getMe,
  updateProfile,
  setPassword,
  createPasskeyInvite,
  getPasskeyInviteOptions,
  finishPasskeyInvite,
  getTeamInvitePreview,
  teamInviteRegisterStart,
  teamInviteRegisterFinish,
} from './auth.service.js'

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

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

function sendZodError(reply: FastifyReply, error: { issues: unknown[] }) {
  return reply.status(400).send({
    success: false,
    message: 'Validation failed',
    errors: error.issues,
  })
}

function mapAuthError(
  message: string,
): { status: number; message: string } | null {
  const table: Record<string, { status: number; message: string }> = {
    EMAIL_ALREADY_EXISTS: {
      status: 409,
      message: 'Email is already registered',
    },
    PASSKEY_ALREADY_REGISTERED: {
      status: 409,
      message: 'This passkey is already registered',
    },
    CHALLENGE_EXPIRED: {
      status: 400,
      message: 'Challenge expired — please try again',
    },
    WEBAUTHN_VERIFICATION_FAILED: {
      status: 401,
      message: 'Biometric verification failed',
    },
    INVALID_CREDENTIALS: {
      status: 401,
      message: 'Invalid credentials',
    },
    ACCOUNT_DISABLED: {
      status: 401,
      message: 'Your account has been disabled',
    },
    ORGANIZATION_DISABLED: {
      status: 401,
      message: 'Your organization has been disabled',
    },
    PASSKEY_NOT_FOUND: {
      status: 404,
      message: 'Passkey not found',
    },
    CANNOT_REVOKE_LAST_PASSKEY: {
      status: 400,
      message: 'Cannot revoke your last passkey',
    },
    USER_NOT_FOUND: {
      status: 404,
      message: 'User not found',
    },
    INVITE_NOT_FOUND: {
      status: 404,
      message: 'Invite not found',
    },
    INVITE_ALREADY_USED: {
      status: 400,
      message: 'Invite already used',
    },
    INVITE_EXPIRED: {
      status: 400,
      message: 'Invite expired',
    },
    INVITE_REVOKED: {
      status: 400,
      message: 'Invite was revoked',
    },
  }
  return table[message] ?? null
}

async function handleError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof Error) {
    const mapped = mapAuthError(error.message)
    if (mapped) {
      return reply.status(mapped.status).send({
        success: false,
        message: mapped.message,
      })
    }
  }

  if (isZodError(error)) {
    return sendZodError(reply, error)
  }

  request.log.error(error)
  return reply.status(500).send({
    success: false,
    message: 'Internal server error',
  })
}

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------

export async function authRoutes(fastify: FastifyInstance) {
  // ================================================================
  // POST /auth/register/start
  // ================================================================
  fastify.post(
    '/register/start',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = registerStartSchema.parse(request.body)
        const result = await registerStart(fastify, body)

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // POST /auth/register/finish
  // ================================================================
  fastify.post(
    '/register/finish',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = registerFinishSchema.parse(request.body)
        const result = await registerFinish(fastify, body)

        return reply.status(201).send({
          success: true,
          message: 'Account created successfully',
          data: result,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // POST /auth/login/start
  // ================================================================
  fastify.post(
    '/login/start',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = loginStartSchema.parse(request.body)
        const result = await loginStart(fastify, body)

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // POST /auth/login/finish
  // ================================================================
  fastify.post(
    '/login/finish',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = loginFinishSchema.parse(request.body)
        const result = await loginFinish(fastify, body)

        return reply.status(200).send({
          success: true,
          message: 'Logged in successfully',
          data: result,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // GET /auth/me  — يرجع permissions + groups
  // ================================================================
  fastify.get(
    '/me',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = await getMe(fastify, request.user.id)

        return reply.status(200).send({
          success: true,
          data: user,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // PATCH /auth/profile
  // ================================================================
  fastify.patch(
    '/profile',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = updateProfileSchema.parse(request.body)
        const user = await updateProfile(fastify, request.user.id, body)

        return reply.status(200).send({
          success: true,
          message: 'Profile updated',
          data: user,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // GET /auth/passkeys
  // ================================================================
  fastify.get(
    '/passkeys',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const passkeys = await listPasskeys(fastify, request.user.id)

        return reply.status(200).send({
          success: true,
          data: passkeys,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // POST /auth/passkeys/invite  — إضافة جهاز لمستخدم موجود (QR)
  // ================================================================
  fastify.post(
    '/passkeys/invite',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // body اختياري / فاضي
        createPasskeyInviteSchema.parse(request.body ?? {})
        const result = await createPasskeyInvite(fastify, request.user.id)

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // GET /auth/passkeys/invite/:token
  // ================================================================
  fastify.get(
    '/passkeys/invite/:token',
    async (
      request: FastifyRequest<{ Params: { token: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { token } = request.params
        const result = await getPasskeyInviteOptions(fastify, token)

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // POST /auth/passkeys/invite/:token/finish
  // ================================================================
  fastify.post(
    '/passkeys/invite/:token/finish',
    async (
      request: FastifyRequest<{ Params: { token: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { token } = request.params
        const body = finishPasskeyInviteSchema.parse(request.body)
        const result = await finishPasskeyInvite(fastify, token, body)

        return reply.status(201).send({
          success: true,
          message: result.message,
          data: result.passkey,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // DELETE /auth/passkeys
  // ================================================================
  fastify.delete(
    '/passkeys',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = revokePasskeySchema.parse(request.body)
        await revokePasskey(fastify, request.user.id, body.passkeyId)

        return reply.status(200).send({
          success: true,
          message: 'Passkey revoked',
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // POST /auth/password
  // ================================================================
  fastify.post(
    '/password',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = setPasswordSchema.parse(request.body)
        await setPassword(fastify, request.user.id, body)

        return reply.status(200).send({
          success: true,
          message: 'Password set successfully',
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // ================================================================
  // ✅ جديد — TEAM INVITE (عضو جديد للمنظمة)
  // مسار عام بدون JWT — التوكن في الـ URL من الإيميل
  // ================================================================

  // معاينة الدعوة قبل ما يبدأ Passkey
  // GET /auth/team-invite/:token
  fastify.get(
    '/team-invite/:token',
    async (
      request: FastifyRequest<{ Params: { token: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { token } = request.params
        const result = await getTeamInvitePreview(fastify, token)

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // بداية تسجيل Passkey للمدعو
  // POST /auth/team-invite/:token/start
  fastify.post(
    '/team-invite/:token/start',
    async (
      request: FastifyRequest<{ Params: { token: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { token } = request.params
        const body = teamInviteRegisterStartSchema.parse(request.body ?? {})
        const result = await teamInviteRegisterStart(
          fastify,
          token,
          body.fullName,
        )

        return reply.status(200).send({
          success: true,
          data: result,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )

  // إنهاء التسجيل → User + Passkey + مجموعات + JWT
  // POST /auth/team-invite/:token/finish
  fastify.post(
    '/team-invite/:token/finish',
    async (
      request: FastifyRequest<{ Params: { token: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { token } = request.params
        const body = teamInviteRegisterFinishSchema.parse(request.body)
        const result = await teamInviteRegisterFinish(fastify, token, body)

        return reply.status(201).send({
          success: true,
          message: 'Invite accepted successfully',
          data: result,
        })
      } catch (error: unknown) {
        return handleError(error, request, reply)
      }
    },
  )
}