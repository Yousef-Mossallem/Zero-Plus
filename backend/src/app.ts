// backend/src/app.ts
// ==================================================================
// Zero Plus - Fastify Application Builder
// هنا بنجمع كل الـ Plugins والـ Modules مع بعض
// ==================================================================

import Fastify from 'fastify'
import type { FastifyError } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import sensible from '@fastify/sensible'

// ------------------------------------------------------------------
// Plugins
// ------------------------------------------------------------------
import prismaPlugin from './plugins/prisma.plugin.js'
import jwtPlugin from './plugins/jwt.plugin.js'
import gatewayAuthPlugin from './plugins/gateway-auth.plugin.js'
import socketPlugin from './plugins/socket.plugin.js'

// ------------------------------------------------------------------
// Modules (Routes)
// ------------------------------------------------------------------
import * as authRoutes from './modules/auth/auth.routes.js'

import policiesRoutes, {
  policiesInternalRoutes,
} from './modules/policies/policies.routes.js'

import { serverRoutes } from './modules/servers/servers.routes.js'
import { serversInternalRoutes } from './modules/servers/servers.gateway.js'
import { readDnsConfig } from './modules/servers/servers.schema.js'

import reputationRoutes, {
  reputationInternalRoutes,
} from './modules/reputation/reputation.routes.js'

import { organizationRoutes } from './modules/organizations/organizations.routes.js'

import eventRoutes from './modules/events/events.routes.js'
import internalEventRoutes from './modules/events/events.internal.routes.js'

// اسم التصدير في الملف: notificationsRoutes (بالـ s)
import {
  notificationsRoutes,
} from './modules/notifications/notifications.routes.js'

import { reportRoutes } from './modules/reports/reports.routes.js'

import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js'

// import { simulationRoutes } from './modules/simulation/simulation.routes.js'

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
    contentSecurityPolicy: false,
  })

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  await app.register(sensible as any, { errorHandler: false } as any)

  // ================================================================
  // 2. Custom Plugins
  // الترتيب مهم:
  //   prisma → jwt → gateway-auth → socket
  // الـ Routes تعتمد على:
  //   fastify.prisma
  //   fastify.authenticate / fastify.requireRole
  //   fastify.authenticateGateway
  //   fastify.broadcastToOrg / fastify.io
  // ================================================================
  await app.register(prismaPlugin)
  await app.register(jwtPlugin)
  await app.register(gatewayAuthPlugin)
  await app.register(socketPlugin)

  // ================================================================
  // 2.1 DNS config check (تحذير فقط)
  // ================================================================
  const dnsConfig = readDnsConfig()

  if (!dnsConfig.cnameTarget && dnsConfig.gatewayIps.length === 0) {
    app.log.warn(
      'GATEWAY_CNAME_TARGET و GATEWAY_PUBLIC_IPS مش مضبوطين: تعليمات توجيه الـ DNS هتبقى فاضية وخطوة verify (routing) هترجع 503',
    )
  } else {
    app.log.info(
      {
        cnameTarget: dnsConfig.cnameTarget,
        gatewayIps: dnsConfig.gatewayIps,
      },
      'DNS routing config loaded',
    )
  }

  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.PLATFORM_DOMAINS
  ) {
    app.log.warn(
      'PLATFORM_DOMAINS مش مضبوط: أي شركة تقدر تسجّل دومينات المنصة نفسها',
    )
  }

  if (!process.env.GEMINI_API_KEY) {
    app.log.warn(
      'GEMINI_API_KEY مش مضبوط: تقارير Gemini والـ Chat هيفشلوا لحد ما يتضاف المفتاح',
    )
  }

  // ================================================================
  // 3. Error Handlers
  // ================================================================
  app.setErrorHandler((error, request, reply) => {
    const err = error as FastifyError
    const statusCode =
      typeof err.statusCode === 'number' ? err.statusCode : 500

    if (statusCode >= 500) {
      request.log.error({ err }, 'Unhandled error')
    } else {
      request.log.warn({ err }, 'Request error')
    }

    return reply.status(statusCode).send({
      success: false,
      code:
        err.code ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
      message: statusCode >= 500 ? 'Internal Server Error' : err.message,
    })
  })

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      code: 'NOT_FOUND',
      message: 'المسار غير موجود',
      method: request.method,
      path: request.url,
    })
  })

  // ================================================================
  // 4. Health Check
  // ================================================================
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'zero-plus-backend',
      timestamp: new Date().toISOString(),
    }
  })

  // ================================================================
  // 5. Register Modules (Routes)
  // ================================================================

  // Auth
  await app.register(authRoutes.authRoutes, { prefix: '/auth' })

  // Organizations
  await app.register(organizationRoutes, { prefix: '/organizations' })

  // Policies
  await app.register(policiesRoutes, { prefix: '/policies' })
  await app.register(policiesInternalRoutes, {
    prefix: '/internal/gateway',
  })

  // Servers
  await app.register(serverRoutes, { prefix: '/servers' })
  await app.register(serversInternalRoutes, {
    prefix: '/internal/gateway',
  })

  // Reputation
  await app.register(reputationRoutes, { prefix: '/reputation' })
  await app.register(reputationInternalRoutes, {
    prefix: '/internal/gateway',
  })

  // Events
  await app.register(eventRoutes, { prefix: '/events' })
  await app.register(internalEventRoutes, {
    prefix: '/internal/gateway/events',
  })

  // Notifications (Dashboard JWT + Socket من الـ service)
  await app.register(notificationsRoutes, { prefix: '/notifications' })

  // Reports (Gemini)
  await app.register(reportRoutes, { prefix: '/reports' })

  await app.register(dashboardRoutes, { prefix: '/dashboard' })

  // await app.register(simulationRoutes, { prefix: '/simulation' })

  return app
}