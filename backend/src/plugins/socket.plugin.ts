// backend/src/plugins/socket.plugin.ts
// ==================================================================
// Zero Plus - Socket.IO Plugin
// Real-time channel: Backend → Dashboard (per organization)
// NOT on the visitor/Gateway hot path
// ==================================================================

import fp from 'fastify-plugin'
import { Server as SocketIOServer, type Socket } from 'socket.io'
import type { FastifyPluginAsync, FastifyInstance } from 'fastify'

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

/** JWT payload shape (must match jwt.plugin.ts) */
export interface SocketAuthUser {
  id: string
  email: string
  role: string
  organizationId: string
  passkeyId?: string
}

/** Standard realtime event names used across the app */
export const SocketEvents = {
  // server → client
  NOTIFICATION_NEW: 'notification:new',
  SECURITY_EVENT_NEW: 'security_event:new',
  TRAFFIC_UPDATE: 'traffic:update',
  SERVER_STATUS: 'server:status',
  REPUTATION_UPDATE: 'reputation:update',
  // client → server (optional light commands)
  PING: 'ping',
  SUBSCRIBE_TRAFFIC: 'subscribe:traffic',
} as const

export type SocketEventName =
  (typeof SocketEvents)[keyof typeof SocketEvents]

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer
    /**
     * Emit an event to every connected dashboard user in an organization.
     */
    broadcastToOrg: (
      organizationId: string,
      event: string,
      payload: unknown,
    ) => void
    /**
     * Emit to a single user (all their sockets, if multiple tabs).
     */
    broadcastToUser: (
      userId: string,
      event: string,
      payload: unknown,
    ) => void
  }
}

// ------------------------------------------------------------------
// Room helpers
// ------------------------------------------------------------------

function orgRoom(organizationId: string): string {
  return `org:${organizationId}`
}

function userRoom(userId: string): string {
  return `user:${userId}`
}

// ------------------------------------------------------------------
// Auth from handshake
// ------------------------------------------------------------------

function extractToken(socket: Socket): string | null {
  // Preferred: auth.token (socket.io client: { auth: { token } })
  const fromAuth = socket.handshake.auth?.token
  if (typeof fromAuth === 'string' && fromAuth.trim()) {
    return fromAuth.replace(/^Bearer\s+/i, '').trim()
  }

  // Fallback: Authorization header
  const header = socket.handshake.headers.authorization
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim()
  }

  // Fallback: query ?token= (less ideal; useful for quick tests)
  const fromQuery = socket.handshake.query?.token
  if (typeof fromQuery === 'string' && fromQuery.trim()) {
    return fromQuery.trim()
  }

  return null
}

// ------------------------------------------------------------------
// Plugin
// ------------------------------------------------------------------

const socketPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // CORS: mirror frontend origin in production via env
  const frontendOrigin =
    process.env.FRONTEND_ORIGIN ??
    process.env.CORS_ORIGIN ??
    true // reflect request origin in dev if unset

  const io = new SocketIOServer(fastify.server, {
    path: '/socket.io',
    cors: {
      origin: frontendOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Dashboard is low-volume vs Gateway traffic
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
  })

  // ------------------------------------------------------------------
  // Connection auth + rooms
  // ------------------------------------------------------------------

  io.use(async (socket, next) => {
    try {
      const token = extractToken(socket)

      if (!token) {
        return next(new Error('UNAUTHORIZED'))
      }

      // Same secret/verify path as HTTP JWT plugin
      const payload = fastify.jwt.verify<SocketAuthUser>(token)

      if (!payload?.id || !payload?.organizationId) {
        return next(new Error('UNAUTHORIZED'))
      }

      socket.data.user = {
        id: payload.id,
        email: payload.email,
        role: payload.role,
        organizationId: payload.organizationId,
        ...(payload.passkeyId ? { passkeyId: payload.passkeyId } : {}),
      } satisfies SocketAuthUser

      return next()
    } catch {
      return next(new Error('UNAUTHORIZED'))
    }
  })

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as SocketAuthUser

    const oRoom = orgRoom(user.organizationId)
    const uRoom = userRoom(user.id)

    void socket.join(oRoom)
    void socket.join(uRoom)

    fastify.log.info(
      {
        socketId: socket.id,
        userId: user.id,
        organizationId: user.organizationId,
      },
      'Socket connected',
    )

    // Client can measure RTT
    socket.on(SocketEvents.PING, (ack?: (ts: number) => void) => {
      if (typeof ack === 'function') {
        ack(Date.now())
      }
    })

    // Optional: client asks to flag interest in live traffic
    // (room is already org-scoped; this is just a hook for future filtering)
    socket.on(SocketEvents.SUBSCRIBE_TRAFFIC, () => {
      void socket.join(`${oRoom}:traffic`)
    })

    socket.on('disconnect', (reason) => {
      fastify.log.info(
        {
          socketId: socket.id,
          userId: user.id,
          reason,
        },
        'Socket disconnected',
      )
    })
  })

  // ------------------------------------------------------------------
  // Decorators for other modules (notifications, events, servers, …)
  // ------------------------------------------------------------------

  fastify.decorate('io', io)

  fastify.decorate(
    'broadcastToOrg',
    (organizationId: string, event: string, payload: unknown) => {
      io.to(orgRoom(organizationId)).emit(event, payload)
    },
  )

  fastify.decorate(
    'broadcastToUser',
    (userId: string, event: string, payload: unknown) => {
      io.to(userRoom(userId)).emit(event, payload)
    },
  )

  // Clean shutdown
  fastify.addHook('onClose', (_instance, done) => {
    void io.close()
    done()
  })

  fastify.log.info('✅ Socket.IO plugin registered successfully')
}

export default fp(socketPlugin, {
  name: 'socket',
  // Ensure JWT is registered first
  dependencies: ['jwt'],
})