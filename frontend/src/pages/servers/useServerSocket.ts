// frontend/src/pages/servers/useServerSocket.ts
// ==================================================================
// الاستماع لحدث server:status (SocketEvents.SERVER_STATUS في الباك)
// الـ Payload: بيانات السيرفر + السعة + previousStatus + action + updatedAt
// action: created | updated | status_changed | verified | deleted
//   deleted        → نشيل السيرفر من القايمة ونقفل الـ Drawer لو مفتوح عليه
//   created        → نعيد جلب القايمة بصمت (الأعداد والصفحات)
//   باقي الأحداث   → ندمج الحقول اللي جت بس في السيرفر الموجود (من غير Refresh)
// الاشتراك واحد على نفس الـ socket المشترك، وبيتنضف عند الخروج (مفيش تسجيل مزدوج).
// ==================================================================

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

import type { Server } from '../../services/serversService'
import { SocketEvents, getSocket } from '../../services/socket'

export function useServerSocket({
  setServers,
  setDetailId,
  reload,
}: {
  setServers: Dispatch<SetStateAction<Server[]>>
  setDetailId: Dispatch<SetStateAction<string | null>>
  /** إعادة جلب القايمة بصمت (من غير skeleton) */
  reload: () => void
}) {
  // آخر reload في ref عشان المستمع مايتسجلش من جديد مع كل render
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    const socket = getSocket()

    const onStatus = (raw: unknown) => {
      if (typeof raw !== 'object' || raw === null) return
      const p = raw as Partial<Server> & { id?: string; action?: string }
      if (typeof p.id !== 'string') return

      if (p.action === 'deleted') {
        setServers((prev) => prev.filter((s) => s.id !== p.id))
        setDetailId((cur) => (cur === p.id ? null : cur))
        reloadRef.current()
        return
      }
      if (p.action === 'created') {
        reloadRef.current()
        return
      }

      // updated / status_changed / verified: ندمج الحقول اللي جت فقط
      const fields: Record<string, unknown> = { ...p }
      delete fields.action
      delete fields.previousStatus
      setServers((prev) => prev.map((s) => (s.id === p.id ? ({ ...s, ...fields } as Server) : s)))

      // الأعداد (summary) بتتغير مع تغيّر الحالة
      if (p.action === 'status_changed' || p.action === 'verified') reloadRef.current()
    }

    socket.on(SocketEvents.SERVER_STATUS, onStatus)
    return () => {
      socket.off(SocketEvents.SERVER_STATUS, onStatus)
    }
  }, [setServers, setDetailId])
}
