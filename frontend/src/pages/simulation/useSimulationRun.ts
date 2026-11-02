// frontend/src/pages/simulation/useSimulationRun.ts
// ==================================================================
// متابعة Run واحد (الباك هو مصدر الحقيقة):
//   - Polling على GET /simulations/:id كل ~1.5 ثانية أثناء RUNNING
//   - جلب الأحداث (GET /events?simulationRunId=) كل ~3 ثواني + مرة أخيرة عند النهاية
//   - بيوقف الـ Polling أول ما الباك يرجّع حالة نهائية (STOPPED / COMPLETED / FAILED)
//   - بيسجّل لقطات العدادات عشان الـ Timeline Chart والـ RPS التقريبي
// ==================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

import { parseApiError } from '../../services/apiError'
import type { SecurityEvent } from '../../services/eventsService'
import {
  getRunEvents,
  getSimulation,
  isTerminal,
  mergeRun,
  type SimulationRun,
} from '../../services/simulationsService'
import { completeTotals, type Snapshot } from './shared'

const POLL_MS = 1500
const RETRY_MS = 3000
const EVENTS_EVERY_MS = 3000
const EVENTS_LIMIT = 100
const MAX_SNAPSHOTS = 600

export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])
  return now
}

export function useSimulationRun({
  onFinished,
}: {
  /** بيتنادى لما الباك يأكد حالة نهائية. liveObserved = كنا شايفينه RUNNING قبلها */
  onFinished?: (run: SimulationRun, liveObserved: boolean) => void
}) {
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<SimulationRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [pollError, setPollError] = useState<string | null>(null)

  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])

  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished
  // لو الـ Run اتبدأ دلوقتي من الصفحة نفسها فهو "Live" حتى لو أول رد جه نهائي
  const liveHintRef = useRef(false)

  const pushSnapshot = useCallback((next: SimulationRun) => {
    if (next.totals.sent === undefined) return
    const snap: Snapshot = { ts: Date.now(), totals: completeTotals(next.totals) }
    setSnapshots((prev) => [...prev, snap].slice(-MAX_SNAPSHOTS))
  }, [])

  /** بدء متابعة Run (بعد Start، أو View من السجل، أو استئناف Run شغال) */
  const track = useCallback((initial: SimulationRun, opts: { live?: boolean } = {}) => {
    liveHintRef.current = opts.live ?? initial.status === 'RUNNING'
    setRun(initial)
    setEvents([])
    setEventsError(null)
    setEventsLoading(true)
    setSnapshots([])
    setPollError(null)
    setLoading(true)
    setRunId(initial.id)
  }, [])

  const clear = useCallback(() => {
    setRunId(null)
    setRun(null)
    setEvents([])
    setSnapshots([])
    setPollError(null)
    setEventsError(null)
    setLoading(false)
    setEventsLoading(false)
  }, [])

  /** بعد نجاح Stop: بندمج الرد، والـ Polling بيأكد الحالة النهائية ويقفل */
  const applyPartial = useCallback(
    (partial: unknown) => {
      setRun((prev) => {
        if (!prev) return prev
        const merged = mergeRun(prev, partial)
        pushSnapshot(merged)
        return merged
      })
    },
    [pushSnapshot],
  )

  const refreshEvents = useCallback(async () => {
    if (!runId) return
    setEventsLoading(true)
    try {
      setEvents(await getRunEvents(runId, EVENTS_LIMIT))
      setEventsError(null)
    } catch (err) {
      setEventsError(parseApiError(err).message)
    } finally {
      setEventsLoading(false)
    }
  }, [runId])

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let lastEventsAt = 0
    let sawRunning = liveHintRef.current

    const loadEvents = async () => {
      try {
        const list = await getRunEvents(runId, EVENTS_LIMIT)
        if (cancelled) return
        setEvents(list)
        setEventsError(null)
      } catch (err) {
        if (!cancelled) setEventsError(parseApiError(err).message)
      } finally {
        if (!cancelled) setEventsLoading(false)
      }
    }

    const tick = async () => {
      try {
        const next = await getSimulation(runId)
        if (cancelled) return
        failures = 0
        setPollError(null)
        setRun(next)
        setLoading(false)
        pushSnapshot(next)

        if (next.status === 'RUNNING') sawRunning = true

        if (isTerminal(next.status)) {
          // حالة نهائية مؤكدة من الباك: نقفل الـ Polling بعد آخر جلب للأحداث
          await loadEvents()
          if (!cancelled) onFinishedRef.current?.(next, sawRunning)
          return
        }
      } catch (err) {
        if (cancelled) return
        failures += 1
        const parsed = parseApiError(err)
        setLoading(false)
        setEventsLoading(false)
        setPollError(parsed.message)
        // 404/403: الـ Run مش موجود أو مش مسموح، مفيش فايدة من إعادة المحاولة
        if (parsed.status === 404 || parsed.status === 403) return
      }

      if (Date.now() - lastEventsAt >= EVENTS_EVERY_MS) {
        lastEventsAt = Date.now()
        void loadEvents()
      }
      timer = setTimeout(tick, failures > 0 ? RETRY_MS : POLL_MS)
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [runId, pushSnapshot])

  return {
    runId,
    run,
    loading,
    pollError,
    events,
    eventsLoading,
    eventsError,
    snapshots,
    track,
    clear,
    applyPartial,
    refreshEvents,
  }
}