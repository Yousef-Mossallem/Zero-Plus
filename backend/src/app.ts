// backend/src/app.ts
// ==================================================================
// Zero Plus - Fastify Application Builder
// هنا بنجمع كل الـ Plugins والـ Modules مع بعض
// ==================================================================

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import sensible from '@fastify/sensible'

// ------------------------------------------------------------------
// Plugins
// ------------------------------------------------------------------
import prismaPlugin from './plugins/prisma.plugin.js'
import jwtPlugin from './plugins/jwt.plugin.js'
// import socketPlugin from './plugins/socket.plugin.js' // هيتفعل بعدين

// -------------------------------------------`-----------------------
// Modules (Routes)
// ------------------------------------------------------------------
import * as authRoutes from './modules/auth/auth.routes.js'

// باقي الموديولات هتتضاف هنا تدريجيًا:
import { organizationRoutes } from './modules/organizations/organizations.routes.js'
import { serverRoutes } from './modules/servers/servers.routes.js'
import  eventRoutes  from './modules/events/events.routes.js'
// import { reputationRoutes } from './modules/reputation/reputation.routes'
// import { policyRoutes } from './modules/policies/policies.routes'
// import { notificationRoutes } from './modules/notifications/notifications.routes'
// import { reportRoutes } from './modules/reports/reports.routes'
// import { simulationRoutes } from './modules/simulation/simulation.routes'

// ------------------------------------------------------------------
// بناء التطبيق
// ------------------------------------------------------------------
export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
      ...(process.env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
              },
            },
          }
        : {}),
    },
  })

  // ================================================================
  // 1. Security & Core Plugins
  // ================================================================
  await app.register(helmet, {
    contentSecurityPolicy: false, // بنسيبها مفتوحة دلوقتي عشان التطوير
  })

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  await app.register(sensible) // بيدي helpers مفيدة زي app.httpErrors

  // ================================================================
  // 2. Custom Plugins (Prisma + JWT)
  // ================================================================
  await app.register(prismaPlugin)
  await app.register(jwtPlugin)
  // await app.register(socketPlugin) // هنفعله لما نبدأ الـ Dashboard الحي

  // ================================================================
  // 3. Health Check (مفيد جدًا للـ Docker و Nginx)
  // ================================================================
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'zero-plus-backend',
      timestamp: new Date().toISOString(),
    }
  })

  // ================================================================
  // 4. Register Modules (Routes)
  // ================================================================

  // Auth Module
  await app.register(authRoutes.authRoutes, { prefix: '/auth' })

  // ---------- باقي الموديولات (هتتفتح واحدة واحدة) ----------
  await app.register(organizationRoutes, { prefix: '/organizations' })
  await app.register(serverRoutes, { prefix: '/servers' })
  await app.register(eventRoutes, { prefix: '/events' })
  // await app.register(reputationRoutes, { prefix: '/reputation' })
  // await app.register(policyRoutes, { prefix: '/policies' })
  // await app.register(notificationRoutes, { prefix: '/notifications' })
  // await app.register(reportRoutes, { prefix: '/reports' })
  // await app.register(simulationRoutes, { prefix: '/simulation' })

  // ================================================================
  // 5. Global Error Handler (اختياري بس احترافي)
  // ================================================================
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error)

    // لو الخطأ جاي من Fastify Sensible
    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number') {
      return reply.status(error.statusCode).send({
        success: false,
        message: error.message,
      })
    }

    // خطأ عام
    return reply.status(500).send({
      success: false,
      message: 'Internal Server Error',
    })
  })

  return app
}