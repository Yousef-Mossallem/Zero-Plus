// frontend/src/services/socket.ts
// ==================================================================
// Zero Plus - Socket.IO Client (اتصال واحد مشترك لكل التطبيق)
// بيتصل بـ backend/plugins/socket.plugin.ts
//   - التوثيق: handshake auth.token (نفس JWT بتاع الـ HTTP)
//   - فتح/قفل الاتصال بيعمله useNotificationsLive (مش authStore)
//   - الـ API: getSocket / connectSocket(token) / disconnectSocket / SocketEvents
// الـ URL: VITE_SOCKET_URL ← origin بتاع VITE_API_URL ← DEV:localhost:4000 ← PROD: window.location.origin
// ==================================================================

import { io, type Socket } from 'socket.io-client'

export const SocketEvents = {
  NOTIFICATION_NEW: 'notification:new',
  SERVER_STATUS: 'server:status',
  REPORT_STATUS: 'report:status',
  SECURITY_EVENT_NEW: 'security_event:new',
  TRAFFIC_UPDATE: 'traffic:update',
  REPUTATION_UPDATE: 'reputation:update',
  SIMULATION_UPDATE: 'simulation:update',
  SIMULATION_STATUS: 'simulation:status',
  PING: 'ping',
  SUBSCRIBE_TRAFFIC: 'subscribe:traffic',
  SUBSCRIBE_SIMULATION: 'subscribe:simulation',
  UNSUBSCRIBE_SIMULATION: 'unsubscribe:simulation',
} as const

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents]

function resolveUrl(): string {
  const explicit = (import.meta.env.VITE_SOCKET_URL as string | undefined)?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const api = (import.meta.env.VITE_API_URL as string | undefined)?.trim()
  if (api) {
    try {
      return new URL(api, window.location.origin).origin
    } catch { /* fallthrough */ }
  }

  if (import.meta.env.DEV) return 'http://localhost:4000'
  return window.location.origin
}

let socket: Socket | null = null
let currentToken = ''

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(resolveUrl(), {
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: currentToken }),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    })

    if (import.meta.env.DEV) {
      let logged = false
      socket.on('connect', () => {
        console.info('[socket] connected', socket?.id)
      })
      socket.on('connect_error', (err) => {
        if (!logged) {
          logged = true
          console.warn('[socket] connect_error', err.message, (err as { description?: string }).description)
        }
      })
    }
  }
  return socket
}

export const connectSocket = (token: string): Socket => {
  const prev = currentToken
  currentToken = token || ''
  const s = getSocket()

  if (!currentToken) {
    if (s.connected || s.active) s.disconnect()
    return s
  }

  if (prev && prev !== currentToken && (s.connected || s.active)) {
    s.disconnect()
  }

  if (!s.connected && !s.active) s.connect()
  return s
}

export const disconnectSocket = (): void => {
  currentToken = ''
  if (socket) {
    socket.disconnect()
  }
}
