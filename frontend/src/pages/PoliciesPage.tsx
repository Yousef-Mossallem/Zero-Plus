// frontend/src/pages/PoliciesPage.tsx
// ==================================================================
// Zero Plus - Policies Page
// تعديل حدود الـ Risk Score وإعدادات الحماية للشركة
// (مربوطة بـ backend/modules/policies)
//
//   GET   /policies/me        → الإعدادات الحالية
//   GET   /policies/defaults  → القيم الافتراضية (للمقارنة وزرار Reset)
//   PATCH /policies/me        → بنبعت الحقول اللي اتغيرت بس (Partial)
//   POST  /policies/me/reset  → { confirm: true } يرجّع كل حاجة للافتراضي
//
// فكرة الصفحة:
//   - الأرقام بتتخزن كنصوص جوه الفورم (عشان المستخدم يقدر يمسح ويكتب براحته)
//   - بنعمل نفس Validation بتاع الباك (policies.schema.ts) قبل الإرسال:
//       allow ≤ rateLimit ≤ challenge  •  الحد الأقصى لكل IP ≥ الـ Rate limit الناعم
//   - شريط ثابت بيظهر لما فيه تعديلات غير محفوظة (Save / Discard)
//   - الـ VIEWER بيشوف الإعدادات بس (الحقول معطلة) والباك أصلاً بيرفض تعديله
// ==================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Gauge, Lock, RefreshCw, RotateCcw, Save, Server, ShieldAlert, ShieldCheck, SlidersHorizontal, Timer, Undo2, X } from 'lucide-react'
import { useToast } from '../components/ui/Toast'
import { Button, Card, ErrorState, Field, Modal, PageHeader, PageShell, Skeleton, TextInput } from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import { getMyPolicy, getPolicyDefaults, resetMyPolicy, updateMyPolicy, type Policy, type PolicyChange, type PolicyValues } from '../services/policiesService'
import { selectUserRole, useAuthStore } from '../store/authStore'
import { cn, timeAgo } from '../utils/format'
import { BOOL_KEYS, NUM_META, buildPatch, parseInt10, toDraft, validate, type BoolKey, type Draft, type NumKey } from './policies/form'
import { Section, ToggleRow } from './policies/blocks'


// ==================================================================
// Page
// ==================================================================

export default function PoliciesPage() {
  const toast = useToast()
  const role = useAuthStore(selectUserRole)
  const canEdit = role !== null && ['OWNER', 'ADMIN', 'ANALYST'].includes(role)

  const [policy, setPolicy] = useState<Policy | null>(null)
  const [defaults, setDefaults] = useState<PolicyValues | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [lastChanges, setLastChanges] = useState<PolicyChange[]>([])

  // ---------------- Load ----------------
  const load = useCallback(async () => {
    setLoading(true)
    try {
      // الاتنين مع بعض: الإعدادات الحالية + الافتراضي
      const [p, d] = await Promise.all([getMyPolicy(), getPolicyDefaults()])
      setPolicy(p)
      setDefaults(d)
      setDraft(toDraft(p))
      setError(null)
    } catch (err) {
      const { message } = parseApiError(err)
      setError(message)
      toast.error('Failed to load policy', message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  // ---------------- Derived ----------------
  const errors = useMemo(() => (draft ? validate(draft) : {}), [draft])
  const hasErrors = Object.keys(errors).length > 0
  const patch = useMemo(() => (draft && policy ? buildPatch(draft, policy) : {}), [draft, policy])
  const dirtyCount = Object.keys(patch).length
  const dirty = dirtyCount > 0

  // تحذير لو المستخدم حاول يقفل الصفحة وفي تعديلات مش محفوظة
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // ---------------- Handlers ----------------
  const setNum = (key: NumKey, value: string) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  const setBool = (key: BoolKey, value: boolean) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d))

  const isModified = (key: NumKey | BoolKey) => {
    if (!draft || !policy) return false
    if ((BOOL_KEYS as string[]).includes(key)) return draft[key as BoolKey] !== policy[key as BoolKey]
    return draft[key as NumKey].trim() !== (policy[key as NumKey] === null ? '' : String(policy[key as NumKey]))
  }

  const save = async () => {
    if (!dirty || hasErrors) return
    setSaving(true)
    try {
      const res = await updateMyPolicy(patch)
      setPolicy(res.policy)
      setDraft(toDraft(res.policy))
      setLastChanges(res.changes)
      toast.success(res.message, `${res.changes.length} setting${res.changes.length === 1 ? '' : 's'} updated`)
    } catch (err) {
      const { message, status } = parseApiError(err)
      toast.error(status === 403 ? 'You are not allowed to edit policies' : 'Could not save policy', message)
    } finally {
      setSaving(false)
    }
  }

  const resetAll = async () => {
    setSaving(true)
    try {
      const res = await resetMyPolicy()
      setPolicy(res.policy)
      setDraft(toDraft(res.policy))
      setLastChanges(res.changes)
      setResetOpen(false)
      toast.success(res.message)
    } catch (err) {
      toast.error('Reset failed', parseApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  // ---------------- Zone preview (من القيم الصحيحة بس، وإلا نرجع للمحفوظ) ----------------
  const zones = useMemo(() => {
    const read = (key: NumKey) => {
      const n = draft && !errors[key] ? parseInt10(draft[key]) : undefined
      return n ?? (policy ? (policy[key] as number) : 0)
    }
    const allow = read('allowMaxScore')
    const rate = Math.max(allow, read('rateLimitMaxScore'))
    const challenge = Math.max(rate, read('challengeMaxScore'))
    return [
      { name: 'Allow', range: `0 – ${allow}`, width: allow + 1, cls: 'bg-emerald-400' },
      { name: 'Rate limit', range: `${allow + 1} – ${rate}`, width: rate - allow, cls: 'bg-amber-400' },
      { name: 'Challenge', range: `${rate + 1} – ${challenge}`, width: challenge - rate, cls: 'bg-indigo-400' },
      { name: 'Block', range: `${challenge + 1} – 100`, width: 100 - challenge, cls: 'bg-rose-500' },
    ]
  }, [draft, errors, policy])

  // ---------------- Numeric field renderer ----------------
  const num = (key: NumKey) => {
    if (!draft || !defaults) return null
    const meta = NUM_META[key]
    const def = defaults[key]
    return (
      <Field
        key={key}
        label={meta.label}
        error={errors[key]}
        hint={`${meta.hint} Default: ${def === null ? 'auto' : def}${meta.unit && def !== null ? ` ${meta.unit}` : ''}`}
      >
        <div className="relative">
          <TextInput
            inputMode="numeric"
            value={draft[key]}
            disabled={!canEdit || saving}
            invalid={Boolean(errors[key])}
            placeholder={meta.nullable ? 'Auto' : undefined}
            onChange={(e) => setNum(key, e.target.value)}
            className={cn(isModified(key) && 'border-amber-400/40', meta.unit && 'pr-16')}
          />
          {meta.unit && (
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
              {meta.unit}
            </span>
          )}
        </div>
      </Field>
    )
  }

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <PageHeader
        icon={SlidersHorizontal}
        title="Protection Policies"
        subtitle="Tune how the Gateway turns a risk score into a decision for your organization."
        actions={
          <>
            <Button icon={RefreshCw} onClick={() => void load()} disabled={loading || saving}>
              Reload
            </Button>
            {canEdit && (
              <Button icon={RotateCcw} variant="danger" onClick={() => setResetOpen(true)} disabled={loading || saving}>
                Reset to defaults
              </Button>
            )}
          </>
        }
      />

      {!canEdit && !loading && (
        <div className="zp-anim-fade-up flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-400">
          <Lock className="h-4 w-4 shrink-0 text-slate-500" />
          Your role has read-only access. Ask an Owner, Admin or Analyst to change these settings.
        </div>
      )}

      {error && !policy ? (
        <Card><ErrorState message={error} onRetry={() => void load()} /></Card>
      ) : loading || !draft || !defaults || !policy ? (
        <div className="space-y-6">
          <Skeleton className="h-52 w-full rounded-2xl" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-72 w-full rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
        </div>
      ) : (
        <>
          {/* ============ Risk thresholds + live preview ============ */}
          <Section
            icon={Gauge}
            title="Risk thresholds"
            description="A request's risk score (0–100) decides what happens to it."
            delay={0}
          >
            {/* معاينة المناطق: بتتحدث مباشرة مع كل تعديل */}
            <div>
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-white/6">
                {zones.map((z) => (
                  <div
                    key={z.name}
                    className={cn('h-full transition-all duration-500 ease-out', z.cls)}
                    style={{ width: `${z.width}%` }}
                    title={`${z.name}: ${z.range}`}
                  />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {zones.map((z) => (
                  <div key={z.name} className="flex items-center gap-2.5 text-xs">
                    <span className={cn('h-2.5 w-2.5 rounded-full', z.cls)} />
                    <span className="text-slate-300">{z.name}</span>
                    <span className="text-slate-500">{z.range}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-5 border-t border-white/6 pt-5 sm:grid-cols-3">
              {(['allowMaxScore', 'rateLimitMaxScore', 'challengeMaxScore'] as const).map((key) => (
                <div key={key} className="space-y-3">
                  {num(key)}
                  <input
                    type="range"
                    min={0}
                    max={99}
                    disabled={!canEdit || saving}
                    value={Math.min(99, Math.max(0, parseInt10(draft[key]) ?? 0))}
                    onChange={(e) => setNum(key, e.target.value)}
                    className="h-1.5 w-full cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={NUM_META[key].label}
                  />
                </div>
              ))}
            </div>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* ============ Challenges ============ */}
            <Section
              icon={ShieldCheck}
              title="Challenges"
              description="Silent verification for visitors the Gateway is unsure about."
              delay={60}
            >
              <ToggleRow
                label="Silent JS challenge"
                hint="Runs invisibly in the browser to filter simple bots."
                checked={draft.enableJsChallenge}
                modified={isModified('enableJsChallenge')}
                disabled={!canEdit || saving}
                onChange={(v) => setBool('enableJsChallenge', v)}
              />
              <ToggleRow
                label="Challenge all new visitors"
                hint="Every first-time visitor gets one silent check, then a clearance."
                checked={draft.challengeAllVisitors}
                modified={isModified('challengeAllVisitors')}
                disabled={!canEdit || saving}
                onChange={(v) => setBool('challengeAllVisitors', v)}
              />
              {num('passTokenTtlMinutes')}
            </Section>

            {/* ============ AI ============ */}
            <Section
              icon={Bot}
              title="AI anomaly detection"
              description="Behavioral model that adds a signal to the risk score."
              delay={120}
            >
              <ToggleRow
                label="Use AI anomaly score"
                hint="When off, decisions rely on rules and reputation only."
                checked={draft.enableAiAnomaly}
                modified={isModified('enableAiAnomaly')}
                disabled={!canEdit || saving}
                onChange={(v) => setBool('enableAiAnomaly', v)}
              />
              <p className="rounded-xl border border-cyan-400/15 bg-cyan-500/5 px-4 py-3 text-xs leading-relaxed text-slate-400">
                The AI score is only one signal. The final decision always comes from the risk engine
                and these thresholds.
              </p>
            </Section>

            {/* ============ Rate limiting ============ */}
            <Section
              icon={Timer}
              title="Rate limiting"
              description="Per-IP request limits. The soft limit slows traffic, the hard limit caps it."
              delay={180}
            >
              <div className="grid gap-5 sm:grid-cols-2">
                {num('rateLimitRequests')}
                {num('rateLimitWindowSec')}
                {num('maxRequestsPerIp')}
                {num('maxRequestsWindowSec')}
              </div>
              <ToggleRow
                label="Ban on hard limit"
                hint="Ban the device when it exceeds the hard limit."
                checked={draft.banOnMaxRequests}
                modified={isModified('banOnMaxRequests')}
                disabled={!canEdit || saving}
                onChange={(v) => setBool('banOnMaxRequests', v)}
              />
            </Section>

            {/* ============ Automatic bans ============ */}
            <Section
              icon={ShieldAlert}
              title="Automatic bans"
              description="When repeat offenders are banned, and for how long."
              delay={240}
            >
              <div className="grid gap-5 sm:grid-cols-2">
                {num('autoBanAfterFails')}
                {num('temporaryBanMinutes')}
              </div>
              {num('permanentBanScore')}
            </Section>
          </div>

          {/* ============ Server capacity ============ */}
          <Section
            icon={Server}
            title="Server capacity"
            description="Used to warn you before an origin server is overwhelmed."
            delay={300}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              {num('maxServerRps')}
              {num('capacityWarnPercent')}
            </div>
          </Section>

          {/* ============ آخر تعديل اتحفظ ============ */}
          {lastChanges.length > 0 && (
            <Card className="p-5" accent>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Last saved changes</h3>
                <button
                  type="button"
                  onClick={() => setLastChanges([])}
                  className="text-slate-500 hover:text-white"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ul className="space-y-1.5">
                {lastChanges.map((c) => (
                  <li key={c.field} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-slate-300">{c.field}</span>
                    <span className="text-slate-600">{String(c.from ?? 'auto')}</span>
                    <span className="text-slate-600">→</span>
                    <span className="text-emerald-300">{String(c.to ?? 'auto')}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="text-center text-xs text-slate-600">
            Policy last updated {timeAgo(policy.updatedAt)}
          </p>

          {/* ============ شريط الحفظ (بيظهر مع وجود تعديلات) ============ */}
          {canEdit && dirty && (
            <div className="sticky bottom-4 z-30 flex justify-center">
              <div className="zp-anim-scale-in flex w-full max-w-xl items-center justify-between gap-4 rounded-2xl border border-amber-400/25 bg-[#0b1224]/95 px-5 py-3.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {hasErrors ? 'Fix the highlighted fields to save' : 'Review and save to apply'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" icon={Undo2} disabled={saving} onClick={() => policy && setDraft(toDraft(policy))}>
                    Discard
                  </Button>
                  <Button variant="primary" icon={Save} loading={saving} disabled={hasErrors} onClick={() => void save()}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ============ Reset confirm ============ */}
      <Modal
        open={resetOpen}
        onClose={() => !saving && setResetOpen(false)}
        title="Reset all policies?"
        description="Every setting returns to its default value. This applies immediately to the Gateway."
        icon={RotateCcw}
        tone="amber"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="danger" loading={saving} onClick={() => void resetAll()}>
              Reset everything
            </Button>
          </>
        }
      />
    </PageShell>
  )
}
