// frontend/src/hooks/useNotificationsLive.ts
// ==================================================================
// بيربط الإشعارات اللحظية طول ما المستخدم مسجّل دخول.
// فتح/قفل السوكيت بيعمله authStore، والـ hook ده بس:
//   - يضمن إن الاتصال مفتوح ويسجّل المستمعين، ويحدّث حالة الاتصال في الـ store
//   - يجيب عدّاد غير المقروء، ويعمل sync بعد أي reconnect
//   - يستقبل notification:new ويديه للـ store (toast + صوت + badge)
//   - يسمع online/offline في المتصفح (قطع النت ورجوعه)
// بيتنادى مرة واحدة في App.tsx، وبينضّف مستمعينه عند الخروج (مفيش تسجيل مزدوج).
// ==================================================================

import { useEffect } from 'react'

import type { NotificationSocketPayload } from '../services/notificationsService'
import { SocketEvents, connectSocket, getSocket } from '../services/socket'
import useAuthStore from '../store/authStore'
import useNotificationStore from '../store/notificationStore'
import { unlockAudio } from '../utils/notificationSound'

/** حماية: مانثقش في payload جاي من الشبكة من غير فحص الشكل */
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
      if (hadConnection) void s.sync() // reconnect: نجيب اللي فاتنا
      hadConnection = true
    }
    const onDisconnect = (reason: string) => {
      useNotificationStore.getState().setConnection('disconnected')
      if (reason === 'io server disconnect') socket.connect() // السيرفر هو اللي قفل
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
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)

    return () => {
      // بننضّف مستمعينا بس (باقي الصفحات ليها مستمعينها)
      const s = getSocket()
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      s.off('connect_error', onError)
      s.io.off('reconnect_attempt', onAttempt)
      s.off(SocketEvents.NOTIFICATION_NEW, onNotification)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [authenticated, token])
}
