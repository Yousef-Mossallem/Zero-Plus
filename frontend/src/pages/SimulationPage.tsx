// frontend/src/pages/SimulationPage.tsx
// ==================================================================
// Zero Plus - Simulation Lab
// Simulate traffic against a protected server and watch protection
// decisions in real time.
//
// What this page does (Backend is the source of truth for run state
// and results):
//   1) GET /servers + GET /simulations?limit=10 on enter
//   2) Start → POST /simulations  |  Stop → POST /simulations/:id/stop
//   3) Poll GET /simulations/:id and run events until a terminal status
//   4) KPIs + Timeline + Donut + Events + Drawer + Previous Runs
//
// The UI talks to the Backend only (never call the Gateway from the
// browser). Any value not available from the backend is shown as N/A
// instead of inventing numbers.
// ==================================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import {
  Ban,
  FlaskConical,
  Gauge,
  History,
  Percent,
  Play,
  Radio,
  Send,
  ShieldCheck,
  ShieldQuestion,
  Square,
  Timer,
} from 'lucide-react'

import { useToast } from '../components/ui/Toast'
import {
  Badge,
  Button,
  Card,
  PageHeader,
  PageShell,
  PaginationBar,
  StatCard,
} from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import type { SecurityEvent } from '../services/eventsService'
import { listServers, type Server } from '../services/serversService'
import {
  listSimulations,
  startSimulation,
  stopSimulation,
  type SimulationPattern,
  type SimulationRun,
  type SimulationsListResult,
} from '../services/simulationsService'
import { selectUserRole, useAuthStore } from '../store/authStore'
import { cn, formatMs, formatNumber, formatPercent } from '../utils/format'
import { EventDrawer } from './events/EventDrawer'
import { DecisionDonut, TimelineChart } from './simulation/Charts'
import LiveBar from './simulation/LiveBar'
import RunEventsTable from './simulation/RunEventsTable'
import RunsHistory from './simulation/RunsHistory'
import SettingsPanel from './simulation/SettingsPanel'
import {
  DEFAULT_WEIGHTS,
  SIM_ROLES,
  STATUS_TONE,
  approxRps,
  blockedPercent,
  buildStartPayload,
  buildTimeline,
  defaultForm,
  defaultSettings,
  mapBackendFieldErrors,
  progressPercent,
  shortId,
  validateForm,
  type DisplayStatus,
  type FormErrors,
  type SimForm,
} from './simulation/shared'
import { useNow, useSimulationRun } from './simulation/useSimulationRun'

const HISTORY_DEFAULT_LIMIT = 10

export default function SimulationPage() {
  const toast = useToast()
  const role = useAuthStore(selectUserRole)
  const canRun = role !== null && SIM_ROLES.includes(role)

  // ---------------- Form ----------------
  const [form, setForm] = useState<SimForm>(() => defaultForm())
  const [errors, setErrors] = useState<FormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // ---------------- Servers ----------------
  const [servers, setServers] = useState<Server[]>([])
  const [serversLoading, setServersLoading] = useState(true)
  const [serversError, setServersError] = useState<string | null>(null)

  // ---------------- History ----------------
  const [history, setHistory] = useState<SimulationsListResult | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLimit, setHistoryLimit] = useState(HISTORY_DEFAULT_LIMIT)

  // ---------------- Actions ----------------
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [drawerEvent, setDrawerEvent] = useState<SecurityEvent | null>(null)

  // ================================================================
  // History
  // ================================================================

  const loadHistory = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setHistoryLoading(true)
      try {
        const result = await listSimulations({ page: historyPage, limit: historyLimit })
        setHistory(result)
        setHistoryError(null)
        return result
      } catch (err) {
        setHistoryError(parseApiError(err).message)
        return null
      } finally {
        setHistoryLoading(false)
      }
    },
    [historyPage, historyLimit],
  )

  // ================================================================
  // Current run (polling + events + snapshots)
  // ================================================================

  const tracker = useSimulationRun({
    onFinished: (finished, liveObserved) => {
      void loadHistory({ silent: true })
      if (!liveObserved) return
      if (finished.status === 'COMPLETED') {
        toast.success('Simulation completed', 'Final results are ready.')
      } else if (finished.status === 'FAILED') {
        toast.error('Simulation failed', 'The backend reported a failure for this run.')
      }
    },
  })

  const { run } = tracker
  const isRunning = run?.status === 'RUNNING'
  const now = useNow(isRunning)

  // ================================================================
  // Initial load: servers + history
  // ================================================================

  const loadServers = useCallback(async () => {
    setServersLoading(true)
    setServersError(null)
    try {
      const result = await listServers({ limit: 100, sortBy: 'domain', sortOrder: 'asc' })
      setServers(result.data)
      // Default: first ONLINE server (without changing a still-valid user choice)
      setForm((f) => {
        const stillValid = result.data.some((s) => s.id === f.serverId && s.status === 'ONLINE')
        if (stillValid) return f
        const firstOnline = result.data.find((s) => s.status === 'ONLINE')
        return { ...f, serverId: firstOnline?.id ?? '' }
      })
    } catch (err) {
      setServersError(parseApiError(err).message)
    } finally {
      setServersLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  // First load + page/limit changes
  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  // If a run is already RUNNING (page was refreshed), resume tracking it
  const [resumeChecked, setResumeChecked] = useState(false)
  useEffect(() => {
    if (resumeChecked || !history || historyPage !== 1) return
    setResumeChecked(true)
    const active = history.items.find((r) => r.status === 'RUNNING')
    if (active && !tracker.runId) tracker.track(active, { live: true })
  }, [history, historyPage, resumeChecked, tracker])

  // ================================================================
  // Derived
  // ================================================================

  const lastStatus: DisplayStatus = run?.status ?? history?.items[0]?.status ?? 'IDLE'
  const onlineIds = useMemo(
    () => servers.filter((s) => s.status === 'ONLINE').map((s) => s.id),
    [servers],
  )
  const locked = isRunning
  const rps = useMemo(
    () => (isRunning ? approxRps(tracker.snapshots) : null),
    [isRunning, tracker.snapshots],
  )
  const timeline = useMemo(
    () => buildTimeline(run, tracker.snapshots, tracker.events),
    [run, tracker.snapshots, tracker.events],
  )

  const progress = run ? progressPercent(run, now) : null
  const totals = run?.totals ?? null
  const kpiLoading = Boolean(run) && tracker.loading && run?.totals.sent === undefined

  const startDisabledReason: string | null = !canRun
    ? 'Your role can view simulations but cannot start them.'
    : serversLoading
      ? 'Loading servers…'
      : onlineIds.length === 0
        ? 'No ONLINE server is available.'
        : locked
          ? 'A simulation is already running.'
          : null

  // ================================================================
  // Form handlers
  // ================================================================

  const handlePatternChange = (pattern: SimulationPattern) => {
    setErrors({})
    setFormError(null)
    setForm((f) => ({
      ...f,
      pattern,
      // Non-custom patterns use their default weights; custom keeps current weights
      weights: pattern === 'custom' ? { ...f.weights } : { ...DEFAULT_WEIGHTS[pattern] },
    }))
    if (pattern === 'custom') setAdvancedOpen(true)
  }

  const handleCustomize = () => {
    handlePatternChange('custom')
    setAdvancedOpen(true)
  }

  const handleReset = () => {
    setErrors({})
    setFormError(null)
    // Restore defaults for the selected pattern (custom falls back to realistic_mix weights)
    setForm((f) => ({ serverId: f.serverId, ...defaultSettings(f.pattern) }))
    toast.info('Settings reset', 'Defaults restored for the selected pattern.')
  }

  // Any edit clears the related field error
  const handleSetForm: Dispatch<SetStateAction<SimForm>> = (updater) => {
    setForm(updater)
    setFormError(null)
    setErrors((prev) => (Object.keys(prev).length > 0 ? {} : prev))
  }

  // ================================================================
  // Start / Stop
  // ================================================================

  const handleStart = async () => {
    if (startDisabledReason) return

    const found = validateForm(form, onlineIds)
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length > 0) {
      if (
        found.weights ||
        found.ipPoolLegit ||
        found.ipPoolAttack ||
        found.aiFixedScore ||
        found.paths ||
        found.seed
      ) {
        setAdvancedOpen(true)
      }
      toast.warning('Check the highlighted fields', 'Some settings are not valid yet.')
      return
    }

    setStarting(true)
    try {
      const created = await startSimulation(buildStartPayload(form))
      tracker.track(created, { live: true })
      setHistoryPage(1)
      void loadHistory({ silent: true })
      toast.success('Simulation started', `Run ${shortId(created.id)} is now running.`)
    } catch (err) {
      const parsed = parseApiError(err)
      if (parsed.status === 400) {
        const mapped = mapBackendFieldErrors(parsed.fieldErrors)
        setErrors(mapped)
        setFormError(parsed.message)
      } else if (parsed.status === 404) {
        setErrors({ serverId: 'Server not found. Refresh the list and pick another server.' })
        setFormError('The selected server was not found.')
        void loadServers()
      } else if (parsed.status === 409) {
        setFormError(
          'A simulation is already running for this server or company. Stop it or wait until it finishes, then try again.',
        )
        void loadHistory({ silent: true })
      } else {
        setFormError(parsed.message)
      }
      toast.error('Could not start the simulation', parsed.message)
    } finally {
      setStarting(false)
    }
  }

  const handleStop = async () => {
    if (!run || !isRunning || stopping) return
    setStopping(true)
    try {
      const partial = await stopSimulation(run.id)
      tracker.applyPartial(partial)
      toast.info('Simulation stopped', 'Final results are being loaded.')
      void loadHistory({ silent: true })
    } catch (err) {
      const parsed = parseApiError(err)
      toast.error('Could not stop the simulation', parsed.message)
    } finally {
      setStopping(false)
    }
  }

  const handleView = (item: SimulationRun) => {
    tracker.track(item, { live: false })
    setDrawerEvent(null)
  }

  // ================================================================
  // Render
  // ================================================================

  return (
    <PageShell>
      {/* ============================================================
          Header
          ============================================================ */}
      <PageHeader
        icon={FlaskConical}
        title="Simulation Lab"
        subtitle="Traffic simulation through the same protection path according to company policy."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge
              tone={STATUS_TONE[lastStatus]}
              dot
              className={cn(lastStatus === 'RUNNING' && 'animate-pulse')}
            >
              {run ? lastStatus : `Last run: ${lastStatus}`}
            </Badge>

            {isRunning && (
              <Button
                variant="danger"
                icon={Square}
                loading={stopping}
                disabled={!canRun}
                onClick={handleStop}
              >
                Stop
              </Button>
            )}

            <Button
              variant="primary"
              icon={Play}
              loading={starting}
              disabled={startDisabledReason !== null}
              title={startDisabledReason ?? 'Start simulation'}
              onClick={handleStart}
            >
              Start
            </Button>
          </div>
        }
      />

      {/* Clear start-disabled reason (not only a tooltip) */}
      {startDisabledReason && !locked && !serversLoading && (
        <div className="-mt-2 rounded-xl border border-amber-400/20 bg-amber-500/6 px-4 py-2.5">
          <p className="text-xs text-amber-200/90">{startDisabledReason}</p>
        </div>
      )}

      {/* ============================================================
          Settings
          ============================================================ */}
      <section className="space-y-3">
        <SettingsPanel
          form={form}
          setForm={handleSetForm}
          errors={errors}
          formError={formError}
          servers={servers}
          serversLoading={serversLoading}
          serversError={serversError}
          onRetryServers={() => void loadServers()}
          locked={locked}
          advancedOpen={advancedOpen}
          onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
          onPatternChange={handlePatternChange}
          onCustomize={handleCustomize}
          onReset={handleReset}
        />
      </section>

      {/* ============================================================
          Live bar (RUNNING only)
          ============================================================ */}
      {run && isRunning && (
        <section>
          <LiveBar
            run={run}
            now={now}
            rps={rps}
            stopping={stopping}
            canStop={canRun}
            pollError={tracker.pollError}
            onStop={handleStop}
          />
        </section>
      )}

      {/* Non-running poll error (e.g. failed to load an old run) */}
      {run && !isRunning && tracker.pollError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
          <p className="text-sm text-rose-200">{tracker.pollError}</p>
        </div>
      )}

      {/* ============================================================
          KPI cards
          ============================================================ */}
      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
          <StatCard
            label="Total Sent"
            value={formatNumber(totals?.sent)}
            icon={Send}
            tone="cyan"
            loading={kpiLoading}
            delay={60}
          />
          <StatCard
            label="Allowed"
            value={formatNumber(totals?.allowed)}
            icon={ShieldCheck}
            tone="emerald"
            loading={kpiLoading}
            delay={90}
          />
          <StatCard
            label="Challenged"
            value={formatNumber(totals?.challenged)}
            icon={ShieldQuestion}
            tone="indigo"
            loading={kpiLoading}
            delay={120}
          />
          <StatCard
            label="Rate Limited"
            value={formatNumber(totals?.rateLimited)}
            icon={Gauge}
            tone="amber"
            loading={kpiLoading}
            delay={150}
          />
          <StatCard
            label="Blocked"
            value={formatNumber(totals?.blocked)}
            icon={Ban}
            tone="rose"
            hint={totals ? `Blocked ${formatPercent(blockedPercent(totals))}` : undefined}
            loading={kpiLoading}
            delay={180}
          />
          <StatCard
            label="Average Latency"
            value={run && run.avgLatencyMs !== null ? formatMs(run.avgLatencyMs) : 'N/A'}
            icon={Timer}
            tone="slate"
            loading={kpiLoading}
            delay={210}
          />
          <StatCard
            label="Progress"
            value={progress !== null ? `${Math.round(progress)}%` : 'N/A'}
            icon={Percent}
            tone="cyan"
            hint={run ? run.status : undefined}
            loading={kpiLoading}
            delay={240}
          />
        </div>
      </section>

      {/* ============================================================
          Charts
          ============================================================ */}
      <section>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <TimelineChart
            timeline={timeline}
            loading={Boolean(run) && tracker.loading}
          />
          <DecisionDonut
            totals={totals}
            loading={Boolean(run) && tracker.loading}
          />
        </div>
      </section>

      {/* ============================================================
          Live Security Events
          ============================================================ */}
      <section>
        <Card className="overflow-hidden" delay={180}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/6 px-5 py-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">Live Security Events</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {run
                  ? `Filtered by run ${shortId(run.id)} · latest ${Math.min(tracker.events.length, 50)} events`
                  : 'Filtered by the current or selected run'}
              </p>
            </div>
            {isRunning && (
              <Badge tone="cyan" dot className="animate-pulse">
                <Radio className="mr-1 h-3 w-3" />
                Live
              </Badge>
            )}
          </div>

          <RunEventsTable
            events={tracker.events}
            loading={tracker.eventsLoading}
            error={tracker.eventsError}
            hasRun={Boolean(run)}
            running={isRunning}
            onRetry={() => void tracker.refreshEvents()}
            onRowClick={setDrawerEvent}
          />
        </Card>
      </section>

      {/* ============================================================
          Previous runs
          ============================================================ */}
      <section>
        <Card className="overflow-hidden" delay={220}>
          <div className="flex items-center gap-2.5 border-b border-white/6 px-5 py-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
              <History className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">Previous runs</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Open a past run to inspect its results and events
              </p>
            </div>
          </div>

          <RunsHistory
            items={history?.items ?? []}
            loading={historyLoading}
            error={historyError}
            selectedId={tracker.runId}
            lockedRunId={isRunning && run ? run.id : null}
            onRetry={() => void loadHistory()}
            onView={handleView}
          />

          {history && history.pagination.total > 0 && (
            <div className="border-t border-white/6 px-2">
              <PaginationBar
                page={history.pagination.page}
                totalPages={history.pagination.totalPages}
                total={history.pagination.total}
                limit={history.pagination.limit}
                disabled={historyLoading}
                onPage={setHistoryPage}
                onLimit={(n) => {
                  setHistoryLimit(n)
                  setHistoryPage(1)
                }}
              />
            </div>
          )}
        </Card>
      </section>

      {/* ============================================================
          Event details drawer
          ============================================================ */}
      <EventDrawer event={drawerEvent} onClose={() => setDrawerEvent(null)} />
    </PageShell>
  )
}