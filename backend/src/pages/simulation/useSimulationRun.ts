// frontend/src/pages/simulation/useSimulationRun.ts
// ==================================================================
// متابعة Run واحد (الباك هو مصدر الحقيقة):
//   - Socket.IO: simulation:update / simulation:status (+ subscribe:simulation للـ Run الحالي)
//       بيحدّث الـ run + اللقطات لحظيًا. أي حالة نهائية جاية من السوكت بتتأكد بجلب
//       GET /simulations/:id فورًا (وده اللي بينادي onFinished).
//   - Polling على GET /simulations/:id = fallback:
//       كل ~1.5 ثانية لو السوكت مش متصل، وكل ~10 ثواني (شبكة أمان) لو متصل
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
import { SocketEvents, getSocket } from '../../services/socket'
import { completeTotals, type Snapshot } from './shared'

const POLL_MS = 1500
/** لما السوكت متصل: Polling بطيء كشبكة أمان لو حدث ضاع */
const SOCKET_SAFETY_POLL_MS = 10_000
const RETRY_MS = 3000
const EVENTS_EVERY_MS = 3000
const EVENTS_LIMIT = 100
const MAX_SNAPSHOTS = 600

/** الحالات اللي نقبلها من السوكت (PENDING وأي قيمة تانية بنتجاهلها عشان normalizeStatus مايحوّلهاش FAILED) */
const SOCKET_STATUSES = ['RUNNING', 'STOPPED', 'COMPLETED', 'FAILED'] as const

interface SimulationSocketPayload {
  runId: string
  status?: string
  totals: Record<string, unknown>
  avgLatencyMs?: number | null
  stoppedAt?: string | null
}

/** فحص شكل الـ payload (runId string + totals object) قبل ما نثق فيه */
function parseSocketPayload(value: unknown): SimulationSocketPayload | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.runId !== 'string' || !v.runId) return null
  if (typeof v.totals !== 'object' || v.totals === null || Array.isArray(v.totals)) return null
  return {
    runId: v.runId,
    totals: v.totals as Record<string, unknown>,
    ...(typeof v.status === 'string' ? { status: v.status.toUpperCase() } : {}),
    ...(typeof v.avgLatencyMs === 'number' || v.avgLatencyMs === null
      ? { avgLatencyMs: v.avgLatencyMs }
      : {}),
    ...(typeof v.stoppedAt === 'string' || v.stoppedAt === null ? { stoppedAt: v.stoppedAt } : {}),
  }
}

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
  // آخر run (للسوكت: بنبني عليه من غير side-effects جوه setState)
  const runRef = useRef<SimulationRun | null>(null)
  runRef.current = run
  const sawRunningRef = useRef(false)
  // أفعال بيعرضها الـ polling effect للـ socket effect
  const actionsRef = useRef<{ poke: () => void; maybeLoadEvents: () => void } | null>(null)

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

  // ----------------------------------------------------------------
  // Polling (مصدر الحقيقة + fallback للسوكت)
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let lastEventsAt = 0
    let inFlight = false
    let pokeAgain = false
    sawRunningRef.current = liveHintRef.current

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

    const maybeLoadEvents = () => {
      if (cancelled || Date.now() - lastEventsAt < EVENTS_EVERY_MS) return
      lastEventsAt = Date.now()
      void loadEvents()
    }

    const tick = async () => {
      inFlight = true
      try {
        const next = await getSimulation(runId)
        if (cancelled) return
        failures = 0
        setPollError(null)
        setRun(next)
        setLoading(false)
        pushSnapshot(next)

        if (next.status === 'RUNNING') sawRunningRef.current = true

        if (isTerminal(next.status)) {
          // حالة نهائية مؤكدة من الباك: نقفل الـ Polling بعد آخر جلب للأحداث
          await loadEvents()
          if (!cancelled) onFinishedRef.current?.(next, sawRunningRef.current)
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
      } finally {
        inFlight = false
      }

      maybeLoadEvents()

      const socketUp = getSocket().connected
      const delay = pokeAgain
        ? 0
        : failures > 0
          ? RETRY_MS
          : socketUp
            ? SOCKET_SAFETY_POLL_MS
            : POLL_MS
      pokeAgain = false
      timer = setTimeout(() => void tick(), delay)
    }

    /** جلب فوري (تأكيد حالة نهائية جت من السوكت / السوكت فصل) */
    const poke = () => {
      if (cancelled) return
      if (inFlight) {
        pokeAgain = true
        return
      }
      if (timer) clearTimeout(timer)
      void tick()
    }

    actionsRef.current = { poke, maybeLoadEvents }
    void tick()

    return () => {
      cancelled = true
      actionsRef.current = null
      if (timer) clearTimeout(timer)
    }
  }, [runId, pushSnapshot])

  // ----------------------------------------------------------------
  // Socket: simulation:update / simulation:status للـ Run الحالي
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!runId) return
    const socket = getSocket()

    // بيتنادى عند كل connect (اشتراك الغرف بيضيع مع الـ reconnect)
    const subscribe = () => {
      socket.emit(SocketEvents.SUBSCRIBE_SIMULATION, { runId })
      actionsRef.current?.poke() // نجيب اللي فاتنا أثناء الفصل
    }
    const onDisconnect = () => actionsRef.current?.poke() // رجوع لسرعة الـ polling
    if (socket.connected) socket.emit(SocketEvents.SUBSCRIBE_SIMULATION, { runId })

    const onPayload = (raw: unknown) => {
      const payload = parseSocketPayload(raw)
      if (!payload || payload.runId !== runId) return

      const prev = runRef.current
      if (!prev || prev.id !== runId) return
      // حدث متأخر بعد حالة نهائية: نتجاهله (الـ GET هو المرجع)
      if (isTerminal(prev.status)) return

      const status =
        payload.status && (SOCKET_STATUSES as readonly string[]).includes(payload.status)
          ? payload.status
          : undefined
      const merged = mergeRun(prev, {
        totals: payload.totals,
        ...(status !== undefined ? { status } : {}),
        ...(payload.avgLatencyMs !== undefined ? { avgLatencyMs: payload.avgLatencyMs } : {}),
        ...(payload.stoppedAt !== undefined ? { stoppedAt: payload.stoppedAt } : {}),
      })

      if (merged.status === 'RUNNING') sawRunningRef.current = true
      runRef.current = merged
      setRun(merged)
      setLoading(false)
      setPollError(null)
      pushSnapshot(merged)

      if (isTerminal(merged.status)) {
        actionsRef.current?.poke() // تأكيد من الباك + onFinished
      } else {
        actionsRef.current?.maybeLoadEvents()
      }
    }

    socket.on('connect', subscribe)
    socket.on('disconnect', onDisconnect)
    socket.on(SocketEvents.SIMULATION_UPDATE, onPayload)
    socket.on(SocketEvents.SIMULATION_STATUS, onPayload)

    return () => {
      socket.off('connect', subscribe)
      socket.off('disconnect', onDisconnect)
      socket.off(SocketEvents.SIMULATION_UPDATE, onPayload)
      socket.off(SocketEvents.SIMULATION_STATUS, onPayload)
      if (socket.connected) socket.emit(SocketEvents.UNSUBSCRIBE_SIMULATION, { runId })
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
