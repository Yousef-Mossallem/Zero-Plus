// backend/src/plugins/jwt.plugin.ts
// ==================================================================
// Zero Plus - JWT Plugin
// مسؤول عن كل حاجة تخص المصادقة والتوكنات (الـ Dashboard فقط)
// الـ Gateway له plugin منفصل: gateway-auth.plugin.ts
// ==================================================================

import fp from 'fastify-plugin'
import fjwt from '@fastify/jwt'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

// ------------------------------------------------------------------
// TypeScript Declaration Merging
// عشان TypeScript يعرف شكل request.user
// ------------------------------------------------------------------
declare module '@fastify/jwt' {
  interface FastifyJWT {
    // الشكل اللي هيتحط جوه التوكن لما نعمل sign
    payload: {
      id: string
      email: string
      role: string
      organizationId: string
    }
    // الشكل اللي هيظهر في request.user بعد ما نعمل verify
    user: {
      id: string
      email: string
      role: string
      organizationId: string
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    // فحص الصلاحية بعد authenticate
    // الاستخدام: preHandler: [fastify.authenticate, fastify.requireRole(['OWNER', 'ADMIN'])]
    requireRole: (
      roles: string[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

// ------------------------------------------------------------------
// الـ Plugin نفسه
// ------------------------------------------------------------------
const jwtPlugin: FastifyPluginAsync = async (fastify) => {
  const secret = process.env.JWT_SECRET

  if (!secret) {
    throw new Error('❌ JWT_SECRET is missing in environment variables')
  }

  // تسجيل مكتبة JWT
  await fastify.register(fjwt, {
    secret,
    sign: {
      expiresIn: '7d', // التوكن صالح لمدة 7 أيام (مناسب للـ MVP)
    },
  })

  // ------------------------------------------------------------------
  // ديكوريتر جاهز عشان تحمي أي route بسهولة
  // الاستخدام:
  // fastify.get('/protected', { preHandler: [fastify.authenticate] }, handler)
  // ------------------------------------------------------------------
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify()
      } catch (err) {
        // return ضروري: من غيره الـ handler ممكن يكمل بعد الرد
        return reply.status(401).send({
          success: false,
          message: 'Unauthorized - Invalid or missing token',
        })
      }
    }
  )

  // ------------------------------------------------------------------
  // فحص الدور (Role)
  // لازم يجي بعد fastify.authenticate في الـ preHandler
  // ------------------------------------------------------------------
  fastify.decorate('requireRole', (roles: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user || !roles.includes(request.user.role)) {
        return reply.status(403).send({
          success: false,
          message: 'ليس لديك صلاحية لتنفيذ هذا الإجراء',
        })
      }
    }
  })

  fastify.log.info('✅ JWT plugin registered successfully')
}

export default fp(jwtPlugin, {
  name: 'jwt',
})