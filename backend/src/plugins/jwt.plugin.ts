// backend/src/plugins/jwt.plugin.ts
// ==================================================================
// Zero Plus - JWT Plugin
// مسؤول عن كل حاجة تخص المصادقة والتوكنات
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
    // ممكن تضيف options تانية هنا لو احتجت (issuer, audience...)
  })

  // ------------------------------------------------------------------
  // ديكوريتر جاهز عشان تحمي أي route بسهولة
  // الاستخدام:
  // fastify.get('/protected', { preHandler: [fastify.authenticate] }, handler)
  // ------------------------------------------------------------------
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch (err) {
      reply.status(401).send({
        success: false,
        message: 'Unauthorized - Invalid or missing token',
      })
    }
  })

  fastify.log.info('✅ JWT plugin registered successfully')
}

export default fp(jwtPlugin, {
  name: 'jwt',
})