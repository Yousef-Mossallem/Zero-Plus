// frontend/src/hooks/useNotificationsLive.ts
// ==================================================================
// بيربط الإشعارات اللحظية طول ما المستخدم مسجّل دخول.
// الـ hook ده هو المسؤول عن دورة حياة السوكيت:
//   - authenticated=true  → يفتح الاتصال بالتوكن الحالي ويسجّل المستمعين
//   - authenticated=false (logout / انتهاء الجلسة) → store.reset() + disconnectSocket()
//   - UNAUTHORIZED → نقفل الاتصال؛ الـ effect (المعتمد على token) هو اللي يعيد الاتصال لما التوكن يتجدد
//   - notification:new → store
//   - security_event:new → window CustomEvent 'zp:security-event'
//   - online/offline
// بيتنادى مرة واحدة في App.tsx
// ==================================================================

import { useEffect } from 'react'

import type { NotificationSocketPayload } from '../services/notificationsService'
import { SocketEvents, connectSocket, disconnectSocket } from '../services/socket'
import useAuthStore from '../store/authStore'
import useNotificationStore from '../store/notificationStore'
import { unlockAudio } from '../utils/notificationSound'

export const SECURITY_EVENT_WINDOW_EVENT = 'zp:security-event'

function isNotificationPayload(value: unknown): value is NotificationSocketPayload {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.type === 'string' &&
    typeof v.title === 'string' &&
    typeof v.message === 'string' &&
    typeof v.severity === 'number' &&
    typeof v.createdAt === 'string'
  )
}

export function useNotificationsLive(): void {
  const token = useAuthStore((s) => s.token)
  const status = useAuthStore((s) => s.status)
  const authenticated = Boolean(token) && status === 'authenticated'

  useEffect(() => {
    const store = useNotificationStore.getState()
    if (!authenticated || !token) {
      store.reset()
      disconnectSocket()
      return
    }

    unlockAudio()
    const socket = connectSocket(token)
    let hadConnection = socket.connected
    store.setConnection(socket.connected ? 'connected' : 'connecting')
    void store.fetchUnreadCount()

    const onConnect = () => {
      const s = useNotificationStore.getState()
      s.setConnection('connected')
      if (hadConnection) void s.sync()
      hadConnection = true
    }
    const onDisconnect = (reason: string) => {
      useNotificationStore.getState().setConnection('disconnected')
      if (reason === 'io server disconnect') socket.connect()
    }
    const onAttempt = () => useNotificationStore.getState().setConnection('connecting')
    const onError = (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        useNotificationStore.getState().setConnection('unauthorized')
        socket.disconnect()
        return
      }
      useNotificationStore.getState().setConnection('disconnected')
    }
    const onNotification = (payload: unknown) => {
      if (!isNotificationPayload(payload)) return
      const { bumpUnread, ...notification } = payload
      useNotificationStore.getState().receive(notification, bumpUnread ?? true)
    }
    const onSecurityEvent = (payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) return
      window.dispatchEvent(new CustomEvent(SECURITY_EVENT_WINDOW_EVENT, { detail: payload }))
    }
    const onOffline = () => useNotificationStore.getState().setConnection('disconnected')
    const onOnline = () => {
      if (!socket.connected) {
        useNotificationStore.getState().setConnection('connecting')
        socket.connect()
      }
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onError)
    socket.io.on('reconnect_attempt', onAttempt)
    socket.on(SocketEvents.NOTIFICATION_NEW, onNotification)
    socket.on(SocketEvents.SECURITY_EVENT_NEW, onSecurityEvent)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onError)
      socket.io.off('reconnect_attempt', onAttempt)
      socket.off(SocketEvents.NOTIFICATION_NEW, onNotification)
      socket.off(SocketEvents.SECURITY_EVENT_NEW, onSecurityEvent)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [authenticated, token])
}
