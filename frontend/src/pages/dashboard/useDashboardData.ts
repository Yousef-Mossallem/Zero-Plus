// frontend/src/pages/dashboard/useDashboardData.ts
// ==================================================================
// Hook تحميل بيانات الداشبورد (قراءة فقط) من backend/modules/dashboard
//  - overview + timeline + servers + threat-map بالتوازي (Promise.allSettled):
//    لو قسم فشل، الباقي يفضل شغال (كل قسم له loading/error لوحده)
//  - /top بيتحمل لوحده حسب التاب (by)
//  - تحديث تلقائي كل 45 ثانية (يوقف لما التاب مخفي) + refresh() يدوي
//  - 403 (VIEWER) → forbidden=true عشان الصفحة تعرض رسالة صلاحيات واضحة
// ==================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

import { parseApiError } from '../../services/apiError'
import {
  getOverview,
  getServersSummary,
  getThreatMap,
  getTimeline,
  getTop,
  type DashboardRange,
  type OverviewData,
  type ServersSummaryData,
  type ThreatMapData,
  type TimelineData,
  type TopBy,
  type TopData,
} from '../../services/dashboardService'

export interface Section<T> {
  data: T | null
  loading: boolean
  error: string | null
}

function initial<T>(): Section<T> {
  return { data: null, loading: true, error: null }
}

const AUTO_REFRESH_MS = 45_000

export function useDashboardData(range: DashboardRange, serverId: string, topBy: TopBy) {
  const [overview, setOverview] = useState<Section<OverviewData>>(initial)
  const [timeline, setTimeline] = useState<Section<TimelineData>>(initial)
  const [servers, setServers] = useState<Section<ServersSummaryData>>(initial)
  const [threat, setThreat] = useState<Section<ThreatMapData>>(initial)
  const [top, setTop] = useState<Section<TopData>>(initial)
  const [forbidden, setForbidden] = useState(false)
  const [tick, setTick] = useState(0)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const reqId = useRef(0)
  const topReq = useRef(0)

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  // تحديث تلقائي
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1)
    }, AUTO_REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  // الأقسام الأساسية
  useEffect(() => {
    const id = ++reqId.current
    const sid = serverId || undefined

    // بنسيب البيانات القديمة معروضة أثناء التحديث (من غير وميض)
    const busy = <T,>(s: Section<T>): Section<T> => ({ ...s, loading: true, error: null })
    setOverview(busy)
    setTimeline(busy)
    setServers(busy)
    setThreat(busy)

    function settle<T>(r: PromiseSettledResult<T>, set: (s: Section<T>) => void) {
      if (r.status === 'fulfilled') {
        set({ data: r.value, loading: false, error: null })
        return
      }
      const parsed = parseApiError(r.reason)
      if (parsed.status === 403) setForbidden(true)
      set({ data: null, loading: false, error: parsed.message })
    }

    void Promise.allSettled([
      getOverview(range, sid),
      getTimeline(range, sid),
      getServersSummary(),
      getThreatMap(range),
    ]).then(([o, t, s, m]) => {
      if (id !== reqId.current) return // رد قديم
      setForbidden(false)
      settle(o, setOverview)
      settle(t, setTimeline)
      settle(s, setServers)
      settle(m, setThreat)
      setUpdatedAt(new Date())
    })
  }, [range, serverId, tick])

  // Top (حسب التاب)
  useEffect(() => {
    const id = ++topReq.current
    setTop((s) => ({ ...s, loading: true, error: null }))
    getTop(topBy, range, 10, serverId || undefined)
      .then((data) => {
        if (id === topReq.current) setTop({ data, loading: false, error: null })
      })
      .catch((err) => {
        if (id === topReq.current) setTop({ data: null, loading: false, error: parseApiError(err).message })
      })
  }, [topBy, range, serverId, tick])

  return { overview, timeline, servers, threat, top, forbidden, updatedAt, refresh }
}
