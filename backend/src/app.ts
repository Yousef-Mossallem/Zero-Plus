// backend/src/app.ts
// ==================================================================
// Zero Plus - Fastify Application Builder
// هنا بنجمع كل الـ Plugins والـ Modules مع بعض
//
// Modules:
//   auth · organizations · team · policies · servers · agents
//   reputation · events · notifications · reports · dashboard
//   simulations
//
// Servers setup modes:
//   ORIGIN — DNS / CNAME / Origin Probe
//   GUARD  — Agent tunnel (enable-tunnel + heartbeat)
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

import { notificationsRoutes } from './modules/notifications/notifications.routes.js'

import { reportRoutes } from './modules/reports/reports.routes.js'

import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js'

import { simulationsRoutes } from './modules/simulations/simulations.routes.js'

import teamRoutes from './modules/team/team.routes.js'

import agentsServerRoutes, {
  agentsInternalRoutes,
} from './modules/agents/agents.routes.js'

// Sweeper اختياري — يعلّم Guard الساكت OFFLINE
// لو الدالة مش مُصدَّرة من agents.service احذف السطر والاستدعاء تحت
import { startAgentSweeper } from './modules/agents/agents.service.js'

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
  // الترتيب: prisma → jwt → gateway-auth → socket
  // ================================================================
  await app.register(prismaPlugin)
  await app.register(jwtPlugin)
  await app.register(gatewayAuthPlugin)
  await app.register(socketPlugin)

  // ================================================================
  // 2.1 Startup checks
  // ================================================================
  const dnsConfig = readDnsConfig()

  if (!dnsConfig.cnameTarget && dnsConfig.gatewayIps.length === 0) {
    app.log.warn(
      'GATEWAY_CNAME_TARGET و GATEWAY_PUBLIC_IPS مش مضبوطين: تعليمات توجيه الـ DNS (ORIGIN) هتبقى فاضية وخطوة verify (routing) هترجع 503',
    )
  } else {
    app.log.info(
      {
        cnameTarget: dnsConfig.cnameTarget,
        gatewayIps: dnsConfig.gatewayIps,
      },
      'DNS routing config loaded (ORIGIN setup)',
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

  // Simulation → Gateway
  if (!process.env.GATEWAY_URL && !process.env.ZERO_PLUS_GATEWAY_URL) {
    app.log.warn(
      'GATEWAY_URL مش مضبوط: Simulation Worker هيستخدم http://127.0.0.1:3000',
    )
  }

  const simSecret =
    process.env.SIMULATION_TOKEN_SECRET ||
    process.env.GATEWAY_SECRET ||
    process.env.GATEWAY_INTERNAL_SECRET
  if (!simSecret || simSecret.length < 16) {
    app.log.warn(
      'SIMULATION_TOKEN_SECRET / GATEWAY_SECRET ناقص أو قصير: إصدار توكن المحاكاة هيفشل',
    )
  }

  // Resend (Team invites)
  if (!process.env.RESEND_API_KEY) {
    app.log.warn(
      'RESEND_API_KEY مش مضبوط: إرسال دعوات الفريق والإيميلات هيتخطّى أو يفشل',
    )
  } else if (
    !process.env.RESEND_FROM_EMAIL &&
    process.env.NODE_ENV === 'production'
  ) {
    app.log.warn(
      'RESEND_FROM_EMAIL مش مضبوط في الإنتاج: استخدم دومين متحقّق في Resend',
    )
  }

  // Agent / GUARD — روابط التثبيت و API
  if (
    !process.env.AGENT_INSTALL_SCRIPT_URL &&
    !process.env.AGENT_DOWNLOAD_BASE_URL
  ) {
    app.log.warn(
      'AGENT_INSTALL_SCRIPT_URL / AGENT_DOWNLOAD_BASE_URL مش مضبوطين: أمر تثبيت الـ Agent (GUARD) هيستخدم رابط GitHub افتراضي',
    )
  }
  if (!process.env.AGENT_API_BASE_URL && !process.env.GATEWAY_PUBLIC_URL) {
    app.log.warn(
      'AGENT_API_BASE_URL مش مضبوط: الـ Agent هيستخدم http://127.0.0.1:3000 في أمر التثبيت',
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

  // Auth (Passkeys + قبول دعوة الفريق)
  await app.register(authRoutes.authRoutes, { prefix: '/auth' })

  await app.register(organizationRoutes, { prefix: '/organizations' })

  // Team & Permissions
  await app.register(teamRoutes, { prefix: '/team' })

  // Policies (Dashboard + Gateway resolve — يدعم originIp null / setupMode)
  await app.register(policiesRoutes, { prefix: '/policies' })
  await app.register(policiesInternalRoutes, {
    prefix: '/internal/gateway',
  })

  // Servers — ORIGIN + GUARD عند الإنشاء (setupMode)
  await app.register(serverRoutes, { prefix: '/servers' })
  await app.register(serversInternalRoutes, {
    prefix: '/internal/gateway',
  })

  // Agent dashboard routes على نفس /servers
  // enable-tunnel · rotate · disable · agent-status · heartbeats
  await app.register(agentsServerRoutes, { prefix: '/servers' })

  // Heartbeat من الـ Agent (AGENT_TOKEN فقط)
  await app.register(agentsInternalRoutes, {
    prefix: '/internal/agent',
  })

  await app.register(reputationRoutes, { prefix: '/reputation' })
  await app.register(reputationInternalRoutes, {
    prefix: '/internal/gateway',
  })

  await app.register(eventRoutes, { prefix: '/events' })
  await app.register(internalEventRoutes, {
    prefix: '/internal/gateway/events',
  })

  await app.register(notificationsRoutes, { prefix: '/notifications' })

  await app.register(reportRoutes, { prefix: '/reports' })

  await app.register(dashboardRoutes, { prefix: '/dashboard' })

  await app.register(simulationsRoutes, { prefix: '/simulations' })

  // ================================================================
  // 6. Background jobs (اختياري)
  // ================================================================
  // AGENT_SWEEPER_ENABLED=false لتعطيل التعليم التلقائي لـ Guard الساكت
  const sweeperDisabled =
    process.env.AGENT_SWEEPER_ENABLED === '0' ||
    process.env.AGENT_SWEEPER_ENABLED === 'false'

  if (!sweeperDisabled && typeof startAgentSweeper === 'function') {
    try {
      startAgentSweeper(app)
      app.log.info('Agent stale-guard sweeper started')
    } catch (err) {
      app.log.warn({ err }, 'Failed to start agent sweeper (non-fatal)')
    }
  } else if (sweeperDisabled) {
    app.log.info('Agent sweeper disabled via AGENT_SWEEPER_ENABLED')
  }

  return app
}
