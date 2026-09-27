
// ==================================================================
// Zero Plus - Auth Routes
// كل الـ Endpoints الخاصة بالمصادقة
// ==================================================================

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from 'fastify'

import { signupSchema, loginSchema } from './auth.schema.js'
import { signup, login, getMe } from './auth.service.js'

// ------------------------------------------------------------------
// تسجيل الـ Routes
// ------------------------------------------------------------------

export async function authRoutes(fastify: FastifyInstance) {
  // ================================================================
  // POST /auth/signup
  // إنشاء حساب شركة جديدة + مستخدم OWNER
  // ================================================================

  fastify.post(
    '/signup',
    {
      schema: {
        response: {
          201: {
            type: 'object',
            properties: {
              success: {
                type: 'boolean',
              },

              message: {
                type: 'string',
              },

              data: {
                type: 'object',
                properties: {
                  token: {
                    type: 'string',
                  },

                  user: {
                    type: 'object',
                    properties: {
                      id: {
                        type: 'string',
                      },

                      email: {
                        type: 'string',
                      },

                      fullName: {
                        type: 'string',
                      },

                      role: {
                        type: 'string',
                      },

                      organizationId: {
                        type: 'string',
                      },
                    },
                  },

                  organization: {
                    type: 'object',
                    properties: {
                      id: {
                        type: 'string',
                      },

                      name: {
                        type: 'string',
                      },

                      slug: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // ----------------------------------------------------------
        // التحقق من بيانات الطلب باستخدام Zod
        // ----------------------------------------------------------

        const body = signupSchema.parse(request.body)

        // ----------------------------------------------------------
        // تنفيذ عملية إنشاء الحساب
        // ----------------------------------------------------------

        const result = await signup(fastify, body)

        return reply.status(201).send({
          success: true,
          message: 'Account created successfully',
          data: result,
        })
      } catch (error: unknown) {
        // ----------------------------------------------------------
        // Email already exists
        // ----------------------------------------------------------

        if (
          error instanceof Error &&
          error.message === 'EMAIL_ALREADY_EXISTS'
        ) {
          return reply.status(409).send({
            success: false,
            message: 'Email is already registered',
          })
        }

        // ----------------------------------------------------------
        // أخطاء Zod
        // ----------------------------------------------------------

        if (
          error &&
          typeof error === 'object' &&
          'name' in error &&
          error.name === 'ZodError'
        ) {
          const zodError = error as unknown as {
            issues: unknown[]
          }

          return reply.status(400).send({
            success: false,
            message: 'Validation failed',
            errors: zodError.issues,
          })
        }

        // ----------------------------------------------------------
        // أي خطأ غير متوقع
        // ----------------------------------------------------------

        request.log.error(error)

        return reply.status(500).send({
          success: false,
          message: 'Internal server error',
        })
      }
    }
  )

  // ================================================================
  // POST /auth/login
  // تسجيل الدخول
  // ================================================================

  fastify.post(
    '/login',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // ----------------------------------------------------------
        // التحقق من بيانات تسجيل الدخول باستخدام Zod
        // ----------------------------------------------------------

        const body = loginSchema.parse(request.body)

        // ----------------------------------------------------------
        // تنفيذ تسجيل الدخول
        // ----------------------------------------------------------

        const result = await login(fastify, body)

        return reply.status(200).send({
          success: true,
          message: 'Logged in successfully',
          data: result,
        })
      } catch (error: unknown) {
        // ----------------------------------------------------------
        // أخطاء تسجيل الدخول المعروفة
        // ----------------------------------------------------------

        if (error instanceof Error) {
          if (
            error.message === 'INVALID_CREDENTIALS' ||
            error.message === 'ACCOUNT_DISABLED' ||
            error.message === 'ORGANIZATION_DISABLED'
          ) {
            return reply.status(401).send({
              success: false,
              message:
                error.message === 'INVALID_CREDENTIALS'
                  ? 'Invalid email or password'
                  : error.message === 'ACCOUNT_DISABLED'
                    ? 'Your account has been disabled'
                    : 'Your organization has been disabled',
            })
          }
        }

        // ----------------------------------------------------------
        // أخطاء Zod
        // ----------------------------------------------------------

        if (
          error &&
          typeof error === 'object' &&
          'name' in error &&
          error.name === 'ZodError'
        ) {
          const zodError = error as unknown as {
            issues: unknown[]
          }

          return reply.status(400).send({
            success: false,
            message: 'Validation failed',
            errors: zodError.issues,
          })
        }

        // ----------------------------------------------------------
        // أي خطأ غير متوقع
        // ----------------------------------------------------------

        request.log.error(error)

        return reply.status(500).send({
          success: false,
          message: 'Internal server error',
        })
      }
    }
  )

  // ================================================================
  // GET /auth/me
  // بيانات المستخدم الحالي (محمي بالـ JWT)
  // ================================================================

  fastify.get(
    '/me',
    {
      preHandler: [fastify.authenticate],
    },

    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // ----------------------------------------------------------
        // استخراج User ID من الـ JWT
        // ----------------------------------------------------------

        const userId = request.user.id

        // ----------------------------------------------------------
        // جلب بيانات المستخدم
        // ----------------------------------------------------------

        const user = await getMe(fastify, userId)

        return reply.status(200).send({
          success: true,
          data: user,
        })
      } catch (error: unknown) {
        // ----------------------------------------------------------
        // المستخدم غير موجود
        // ----------------------------------------------------------

        if (
          error instanceof Error &&
          error.message === 'USER_NOT_FOUND'
        ) {
          return reply.status(404).send({
            success: false,
            message: 'User not found',
          })
        }

        // ----------------------------------------------------------
        // أي خطأ غير متوقع
        // ----------------------------------------------------------

        request.log.error(error)

        return reply.status(500).send({
          success: false,
          message: 'Internal server error',
        })
      }
    }
  )
}