// frontend/src/pages/ReputationPage.tsx
// ==================================================================
// Zero Plus - Reputation Page
// الأجهزة المسجلة ودرجة سمعتها (مربوطة بـ backend/modules/reputation)
//
//   القراءة (أي مستخدم):  GET /reputation • /reputation/stats • /:id/challenges
//   الإجراءات (OWNER / ADMIN / ANALYST فقط):
//       POST /:id/ban • /:id/unban • /:id/allowlist • /:id/reset
//
// ملاحظات:
//   - الـ VIEWER بيشوف كل حاجة لكن أزرار الإجراءات مخفية (الباك أصلاً هيرفض بـ 403)
//   - بعد أي إجراء بنحدّث الصف من رد الباك مباشرة (من غير إعادة تحميل الجدول)
//   - الدرجة من 1 لـ 10 (scoreBand: CLEAN → CRITICAL) وده تصنيف الباك مش حسابنا
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Ban, Bot, CheckCircle2, Clock, Fingerprint, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Unlock, Users, X } from 'lucide-react'
import { useToast } from '../components/ui/Toast'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageShell, PaginationBar, SelectInput, Skeleton, StatCard, TextInput } from '../components/ui/kit'
import { useDebounce } from '../hooks/useDebounce'
import { parseApiError } from '../services/apiError'
import { banEntry, getReputationStats, listReputation, resetEntry, setAllowlist, unbanEntry, type ActionResult, type ReputationEntry, type ReputationQuery, type ReputationSortBy, type ReputationStats } from '../services/reputationService'
import type { BanStatus, IpType } from '../services/types'
import { selectUserRole, useAuthStore } from '../store/authStore'
import { cn, formatNumber, timeAgo } from '../utils/format'
import { ACTION_ROLES, BAND_META, BAND_ORDER, BanBadge, IP_TYPES, ScorePips, isCurrentlyBanned } from './reputation/shared'
import { ActionModal, type ActionKind } from './reputation/ActionModal'
import { EntryDrawer } from './reputation/EntryDrawer'


// ==================================================================
// Page
// ==================================================================

export default function ReputationPage() {
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const role = useAuthStore(selectUserRole)
  const canAct = role !== null && ACTION_ROLES.includes(role)

  // ---------------- Filters ----------------
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [banStatus, setBanStatus] = useState('')
  const [ipType, setIpType] = useState('')
  const [flag, setFlag] = useState('') // '' | allowlisted | botnet | manual
  const [minScore, setMinScore] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [sortBy, setSortBy] = useState<ReputationSortBy>('lastSeenAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const debouncedSearch = useDebounce(search)

  // ---------------- Data ----------------
  const [entries, setEntries] = useState<ReputationEntry[]>([])
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 })
  const [stats, setStats] = useState<ReputationStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ---------------- UI state ----------------
  const [selected, setSelected] = useState<ReputationEntry | null>(null)
  const [modal, setModal] = useState<{ kind: ActionKind; entry: ReputationEntry } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const requestId = useRef(0)

  // ---------------- Query ----------------
  const query = useMemo<ReputationQuery>(
    () => ({
      page,
      limit,
      sortBy,
      sortOrder,
      ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
      ...(banStatus && { banStatus: banStatus as BanStatus }),
      ...(ipType && { ipType: ipType as IpType }),
      ...(minScore && { minScore: Number(minScore) }),
      ...(flag === 'allowlisted' && { isAllowlisted: true }),
      ...(flag === 'botnet' && { isKnownBotnet: true }),
      ...(flag === 'manual' && { isManualBan: true }),
    }),
    [page, limit, sortBy, sortOrder, debouncedSearch, banStatus, ipType, minScore, flag],
  )

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await listReputation(query)
      if (id !== requestId.current) return
      setEntries(res.data)
      setPagination({ total: res.pagination.total, totalPages: res.pagination.totalPages })
      setError(null)
    } catch (err) {
      if (id !== requestId.current) return
      const { message } = parseApiError(err)
      setError(message)
      toast.error('Failed to load reputation entries', message)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [query, toast])

  const loadStats = useCallback(async () => {
    try {
      setStats(await getReputationStats())
    } catch {
      /* الكروت اختيارية: لو فشلت منعطلش الجدول */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  // ---------------- Helpers ----------------
  const resetPage = () => setPage(1)
  const hasFilters = Boolean(search || banStatus || ipType || flag || minScore)

  const clearFilters = () => {
    setSearch('')
    setBanStatus('')
    setIpType('')
    setFlag('')
    setMinScore('')
    resetPage()
  }

  /** تحديث الصف في الجدول والـ Drawer من رد الباك (من غير request إضافي) */
  const applyEntry = (updated: ReputationEntry) => {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
    setSelected((prev) => (prev && prev.id === updated.id ? updated : prev))
  }

  /** تنفيذ إجراء: بيعمل toast بحسب رد الباك، وبيحدّث الصف والإحصائيات */
  const runAction = async (entry: ReputationEntry, fn: () => Promise<ActionResult>) => {
    setBusyId(entry.id)
    try {
      const res = await fn()
      applyEntry(res.entry)
      // changed === false → الحالة المطلوبة كانت موجودة، فنعرضها كمعلومة مش نجاح
      if (res.changed === false) toast.info(res.message)
      else toast.success(res.message)
      void loadStats()
      return true
    } catch (err) {
      const { message, status } = parseApiError(err)
      toast.error(status === 403 ? 'Not allowed' : 'Action failed', message)
      return false
    } finally {
      setBusyId(null)
    }
  }

  const toggleAllow = (entry: ReputationEntry) =>
    void runAction(entry, () => setAllowlist(entry.id, !entry.isAllowlisted))

  const handleSort = (field: ReputationSortBy) => {
    if (field === sortBy) setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(field)
      setSortOrder('desc')
    }
    resetPage()
  }

  // ---------------- Derived stats ----------------
  const bannedCount = stats ? stats.byBanStatus.TEMPORARY + stats.byBanStatus.PERMANENT : null
  const riskyCount = stats ? stats.byBand.HIGH + stats.byBand.CRITICAL : null

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <PageHeader
        icon={Fingerprint}
        title="Device Reputation"
        subtitle="Every device the Gateway has seen, with its trust score and ban status."
        actions={
          <Button
            icon={RefreshCw}
            loading={loading && entries.length > 0}
            onClick={() => {
              void load()
              void loadStats()
            }}
          >
            Refresh
          </Button>
        }
      />

      {/* ---------- Stats ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tracked devices" value={formatNumber(stats?.total)} icon={Users} tone="cyan" loading={!stats} delay={0} />
        <StatCard label="Currently banned" value={formatNumber(bannedCount)} icon={Ban} tone="rose" loading={!stats} delay={60}
          hint={stats ? `${stats.byBanStatus.PERMANENT} permanent` : undefined} />
        <StatCard label="High risk" value={formatNumber(riskyCount)} icon={Clock} tone="amber" loading={!stats} delay={120}
          hint="Score 7 – 10" />
        <StatCard label="Known botnets" value={formatNumber(stats?.knownBotnets)} icon={Bot} tone="indigo" loading={!stats} delay={180}
          hint={stats ? `${stats.allowlisted} trusted devices` : undefined} />
      </div>

      {/* ---------- Score distribution ---------- */}
      <Card className="p-5" delay={150}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Score distribution</h3>
          <span className="text-xs text-slate-500">All tracked devices</span>
        </div>
        {!stats ? (
          <Skeleton className="h-3 w-full rounded-full" />
        ) : stats.total === 0 ? (
          <p className="text-sm text-slate-600">No devices tracked yet.</p>
        ) : (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/6">
              {BAND_ORDER.map((band) => {
                const count = stats.byBand[band]
                if (!count) return null
                return (
                  <div
                    key={band}
                    title={`${BAND_META[band].label}: ${count}`}
                    className="zp-anim-bar h-full"
                    style={{ width: `${(count / stats.total) * 100}%`, backgroundColor: BAND_META[band].hex }}
                  />
                )
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {BAND_ORDER.map((band) => (
                <span key={band} className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: BAND_META[band].hex }} />
                  {BAND_META[band].label}
                  <span className="text-slate-200">{stats.byBand[band]}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ---------- Filters ---------- */}
      <Card className="p-5" delay={200} accent>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <TextInput
              icon={Search}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                resetPage()
              }}
              placeholder="Search IP, fingerprint, JA3/JA4, country…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:flex">
            <SelectInput value={banStatus} onChange={(e) => { setBanStatus(e.target.value); resetPage() }} className="lg:w-40">
              <option value="">All ban states</option>
              <option value="NONE" className="bg-[#0b1224]">Not banned</option>
              <option value="TEMPORARY" className="bg-[#0b1224]">Temporary</option>
              <option value="PERMANENT" className="bg-[#0b1224]">Permanent</option>
            </SelectInput>
            <SelectInput value={ipType} onChange={(e) => { setIpType(e.target.value); resetPage() }} className="lg:w-40">
              <option value="">All IP types</option>
              {IP_TYPES.map((t) => (
                <option key={t} value={t} className="bg-[#0b1224]">{t.replace('_', ' / ')}</option>
              ))}
            </SelectInput>
            <SelectInput value={flag} onChange={(e) => { setFlag(e.target.value); resetPage() }} className="lg:w-40">
              <option value="">Any flag</option>
              <option value="allowlisted" className="bg-[#0b1224]">Trusted</option>
              <option value="botnet" className="bg-[#0b1224]">Known botnet</option>
              <option value="manual" className="bg-[#0b1224]">Manual ban</option>
            </SelectInput>
            <SelectInput value={minScore} onChange={(e) => { setMinScore(e.target.value); resetPage() }} className="lg:w-36">
              <option value="">Any score</option>
              {[3, 5, 7, 9].map((n) => (
                <option key={n} value={n} className="bg-[#0b1224]">Score ≥ {n}</option>
              ))}
            </SelectInput>
          </div>
          {hasFilters && (
            <Button icon={X} variant="ghost" onClick={clearFilters}>Clear</Button>
          )}
        </div>
      </Card>

      {/* ---------- Table ---------- */}
      <Card delay={250}>
        {error && entries.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-225 text-left">
                <thead>
                  <tr className="border-b border-white/6">
                    {[
                      { label: 'Device', sort: null },
                      { label: 'Score', sort: 'score' as const },
                      { label: 'Ban status', sort: 'bannedUntil' as const },
                      { label: 'Failed', sort: 'failedChecksCount' as const },
                      { label: 'Requests', sort: 'totalRequests' as const },
                      { label: 'Last seen', sort: 'lastSeenAt' as const },
                      { label: '', sort: null },
                    ].map((col) => (
                      <th key={col.label || 'actions'} className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {col.sort ? (
                          <button
                            type="button"
                            onClick={() => handleSort(col.sort)}
                            className={cn('inline-flex items-center gap-1.5 hover:text-slate-300', sortBy === col.sort && 'text-slate-300')}
                          >
                            {col.label}
                            {sortBy === col.sort &&
                              (sortOrder === 'asc' ? (
                                <ArrowUp className="h-3 w-3 text-cyan-400" />
                              ) : (
                                <ArrowDown className="h-3 w-3 text-cyan-400" />
                              ))}
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {loading && entries.length === 0 &&
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-white/4">
                        {Array.from({ length: 7 }).map((__, j) => (
                          <td key={j} className="px-5 py-4"><Skeleton className="h-4 w-full max-w-28" /></td>
                        ))}
                      </tr>
                    ))}

                  {entries.map((entry, index) => {
                    const busy = busyId === entry.id
                    const banned = isCurrentlyBanned(entry)
                    return (
                      <tr
                        key={entry.id}
                        onClick={() => setSelected(entry)}
                        style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
                        className={cn('zp-anim-fade-up cursor-pointer border-b border-white/4 hover:bg-white/3', (loading || busy) && 'opacity-60')}
                      >
                        <td className="px-5 py-3.5">
                          <p className="font-mono text-sm text-white">{entry.ipAddress}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            <span>{[entry.countryCode, entry.ipType.replace('_', '/')].filter(Boolean).join(' · ')}</span>
                            {entry.isAllowlisted && <Badge tone="emerald">Trusted</Badge>}
                            {entry.isKnownBotnet && <Badge tone="rose">Botnet</Badge>}
                          </div>
                        </td>
                        <td className="px-5 py-3.5"><ScorePips score={entry.score} band={entry.scoreBand} /></td>
                        <td className="px-5 py-3.5"><BanBadge entry={entry} /></td>
                        <td className="px-5 py-3.5 text-sm tabular-nums text-slate-300">{entry.failedChecksCount}</td>
                        <td className="px-5 py-3.5 text-sm tabular-nums text-slate-300">{formatNumber(entry.totalRequests)}</td>
                        <td className="px-5 py-3.5 text-sm text-slate-400">{timeAgo(entry.lastSeenAt)}</td>
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                          {canAct && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                disabled={busy}
                                title={banned ? 'Lift ban' : 'Ban device'}
                                onClick={() => setModal({ kind: banned ? 'unban' : 'ban', entry })}
                                className={cn(
                                  'rounded-lg p-2 disabled:opacity-40',
                                  banned ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-rose-400 hover:bg-rose-500/10',
                                )}
                              >
                                {banned ? <Unlock className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                title={entry.isAllowlisted ? 'Remove trust' : 'Mark as trusted'}
                                onClick={() => toggleAllow(entry)}
                                className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-cyan-300 disabled:opacity-40"
                              >
                                {entry.isAllowlisted ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <ShieldCheck className="h-4 w-4" />}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {!loading && entries.length === 0 && (
                <EmptyState
                  icon={SlidersHorizontal}
                  title={hasFilters ? 'No devices match these filters' : 'No devices tracked yet'}
                  description={hasFilters ? 'Try widening the filters.' : 'Devices appear here as soon as the Gateway reports signals about them.'}
                  action={hasFilters ? <Button icon={X} onClick={clearFilters}>Clear filters</Button> : undefined}
                />
              )}
            </div>

            {(pagination.total > 0 || loading) && (
              <PaginationBar
                page={page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                limit={limit}
                disabled={loading}
                onPage={setPage}
                onLimit={(n) => { setLimit(n); resetPage() }}
              />
            )}
          </>
        )}
      </Card>


      <EntryDrawer
        entry={selected}
        canAct={canAct}
        busy={busyId === selected?.id}
        onClose={() => setSelected(null)}
        onAction={(kind) => selected && setModal({ kind, entry: selected })}
        onToggleAllow={() => selected && toggleAllow(selected)}
      />

      <ActionModal
        kind={modal?.kind ?? null}
        entry={modal?.entry ?? null}
        onClose={() => setModal(null)}
        onBan={(input) => runAction(modal!.entry, () => banEntry(modal!.entry.id, input))}
        onUnban={(input) => runAction(modal!.entry, () => unbanEntry(modal!.entry.id, input))}
        onReset={(reason) => runAction(modal!.entry, () => resetEntry(modal!.entry.id, reason))}
      />
    </PageShell>
  )
}
