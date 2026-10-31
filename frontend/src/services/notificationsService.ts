// frontend/src/services/notificationsService.ts
// ==================================================================
// Zero Plus - Notifications Service (REST)
// مربوط بـ backend/modules/notifications (notifications.routes.ts)
//   GET  /notifications              → { success, data[], pagination, summary:{unreadCount} }
//   GET  /notifications/unread-count → { success, data:{unreadCount} }
//   POST /notifications/:id/read     → { success, data:{id,isRead,changed} }
//   POST /notifications/read-all     → { success, data:{updatedCount} }
// الباك بيستخدم zod .strict() فبنبعت الحقول المعروفة بس.
// ملحوظة: isRead على مستوى الشركة كلها (مفيش userId في جدول Notification).
// ==================================================================

import api from './api'
import { cleanParams } from './types'
import type { Pagination } from './types'
import type { NotificationType } from '../utils/notificationMeta'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message: string
  severity: number // 1-5
  isRead: boolean
  metadata: Record<string, unknown> | null
  organizationId: string
  createdAt: string
}

/** نفس الشكل اللي بيوصل من السوكيت (notification:new) */
export interface NotificationSocketPayload extends AppNotification {
  bumpUnread?: boolean
}

export interface NotificationsQuery {
  page?: number
  limit?: number
  unreadOnly?: boolean
  /** بنبعتها CSV لأن الباك بيقبل: نوع واحد | array | CSV */
  types?: NotificationType[]
  minSeverity?: number
  search?: string
}

export interface NotificationsListResult {
  data: AppNotification[]
  pagination: Pagination
  unreadCount: number
}

export async function listNotifications(
  query: NotificationsQuery = {},
): Promise<NotificationsListResult> {
  const { types, ...rest } = query
  const params = cleanParams({
    ...rest,
    ...(types && types.length > 0 && { type: types.join(',') }),
  })

  const { data } = await api.get<{
    data: AppNotification[]
    pagination: Pagination
    summary?: { unreadCount: number }
  }>('/notifications', { params })

  return {
    data: data.data,
    pagination: data.pagination,
    unreadCount: data.summary?.unreadCount ?? 0,
  }
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await api.get<{ data: { unreadCount: number } }>('/notifications/unread-count')
  return data.data.unreadCount
}

// الـ body الفاضي {} عشان Fastify مايرفضش طلب JSON من غير body
export async function markNotificationRead(id: string): Promise<{ changed: boolean }> {
  const { data } = await api.post<{ data: { changed: boolean } }>(
    `/notifications/${encodeURIComponent(id)}/read`,
    {},
  )
  return { changed: data.data.changed }
}

export async function markAllNotificationsRead(): Promise<{ updatedCount: number }> {
  const { data } = await api.post<{ data: { updatedCount: number } }>('/notifications/read-all', {})
  return { updatedCount: data.data.updatedCount }
}
