// frontend/src/services/socket.ts
// ==================================================================
// Zero Plus - Socket.IO Client (اتصال واحد مشترك لكل التطبيق)
// بيتصل بـ backend/plugins/socket.plugin.ts
//   - التوثيق: handshake auth.token (نفس JWT بتاع الـ HTTP)
//   - فتح/قفل الاتصال بيعمله authStore (login / refresh / logout)
//   - الـ API القديم محفوظ (getSocket / connectSocket(token) / disconnectSocket / SocketEvents)
//     عشان باقي الصفحات تفضل شغالة.
// الـ URL: VITE_SOCKET_URL ← أو origin بتاع VITE_API_URL ← أو http://localhost:4000
// ==================================================================

import { io, type Socket } from 'socket.io-client'

/** أسماء الأحداث (لازم تطابق SocketEvents في socket.plugin.ts) */
export const SocketEvents = {
  NOTIFICATION_NEW: 'notification:new',
  SERVER_STATUS: 'server:status',
  REPORT_STATUS: 'report:status',
  SECURITY_EVENT_NEW: 'security_event:new',
  TRAFFIC_UPDATE: 'traffic:update',
  REPUTATION_UPDATE: 'reputation:update',
} as const

function resolveUrl(): string {
  const explicit = import.meta.env.VITE_SOCKET_URL as string | undefined
  if (explicit) return explicit
  const api = import.meta.env.VITE_API_URL as string | undefined
  if (api) {
    try {
      return new URL(api, window.location.origin).origin
    } catch {
      /* نكمل للافتراضي */
    }
  }
  return 'http://localhost:4000'
}

let socket: Socket | null = null
// آخر token: بنستخدمه في كل محاولة reconnect (مش قيمة قديمة)
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
  }
  return socket
}

/** بيفتح الاتصال (آمن يتنادى أكتر من مرة) */
export const connectSocket = (token: string): Socket => {
  currentToken = token
  const s = getSocket()
  if (!s.connected && !s.active) s.connect()
  return s
}

export const disconnectSocket = (): void => {
  currentToken = ''
  if (socket) {
    socket.removeAllListeners()
    socket.io.removeAllListeners()
    socket.disconnect()
    socket = null
  }
}
