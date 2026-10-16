// frontend/src/services/types.ts
// أنواع مشتركة بين كل الـ services

export interface Pagination {
  total: number
  page: number
  limit: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export type Decision = 'ALLOW' | 'MONITOR' | 'RATE_LIMIT' | 'CHALLENGE' | 'BLOCK'

export type IpType =
  | 'RESIDENTIAL'
  | 'MOBILE'
  | 'DATACENTER'
  | 'VPN_PROXY'
  | 'TOR'
  | 'UNKNOWN'

export type BanStatus = 'NONE' | 'TEMPORARY' | 'PERMANENT'

export type ServerStatus =
  | 'PENDING'
  | 'ONLINE'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'MAINTENANCE'

export type ServerMode = 'PROTECT' | 'MONITOR_ONLY'

export type UserRole = 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER'

/** يشيل القيم الفاضية قبل ما نبعت الـ query params للباك (الباك بيرفض '' في بعض الحقول) */
export function cleanParams<T extends object>(params: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return out as Partial<T>
}
