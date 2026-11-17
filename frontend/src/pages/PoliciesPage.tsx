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
import {
  Bot,
  Gauge,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Undo2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/ui/Toast'
import { Button, Card, ErrorState, Field, Modal, PageHeader, PageShell, Skeleton, TextInput } from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import {
  getMyPolicy,
  getPolicyDefaults,
  resetMyPolicy,
  updateMyPolicy,
  type Policy,
  type PolicyChange,
  type PolicyValues,
} from '../services/policiesService'
import { selectUserRole, useAuthStore } from '../store/authStore'
import { cn, timeAgo } from '../utils/format'
import {
  BOOL_KEYS,
  NUM_META,
  buildPatch,
  parseInt10,
  toDraft,
  validate,
  type BoolKey,
  type Draft,
  type NumKey,
} from './policies/form'
import { Section, ToggleRow } from './policies/blocks'

// ==================================================================
// Page
// ==================================================================

export default function PoliciesPage() {
  const { t } = useTranslation(['policies', 'common'])
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
      toast.error(t('toast.loadFailed'), message)
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  useEffect(() => {
    void load()
  }, [load])

  // ---------------- Derived ----------------
  const errors = useMemo(
    () => (draft ? validate(draft, (k, opts) => String(t(k as never, (opts || {}) as never))) : {}),
    [draft, t],
  )
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
      toast.success(res.message, t('toast.updated', { count: res.changes.length }))
    } catch (err) {
      const { message, status } = parseApiError(err)
      toast.error(status === 403 ? t('toast.forbidden') : t('toast.saveFailed'), message)
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
      toast.error(t('toast.resetFailed'), parseApiError(err).message)
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
      { name: t('zones.allow'), range: `0 – ${allow}`, width: allow + 1, cls: 'bg-emerald-400' },
      { name: t('zones.rateLimit'), range: `${allow + 1} – ${rate}`, width: rate - allow, cls: 'bg-amber-400' },
      { name: t('zones.challenge'), range: `${rate + 1} – ${challenge}`, width: challenge - rate, cls: 'bg-indigo-400' },
      { name: t('zones.block'), range: `${challenge + 1} – 100`, width: 100 - challenge, cls: 'bg-rose-500' },
    ]
  }, [draft, errors, policy, t])

  // ---------------- Numeric field renderer ----------------
  const num = (key: NumKey) => {
    if (!draft || !defaults) return null
    const meta = NUM_META[key]
    const def = defaults[key]
    const defStr = def === null ? t('auto') : String(def)
    const hintText = `${t(`fields.${key}.hint` as never)} ${t('defaultSuffix', { val: defStr })}${meta.unit && def !== null ? ` ${meta.unit}` : ''}`

    return (
      <Field
        key={key}
        label={t(`fields.${key}.label` as never) || meta.label}
        error={errors[key]}
        hint={hintText}
      >
        <div className="relative">
          <TextInput
            inputMode="numeric"
            value={draft[key]}
            disabled={!canEdit || saving}
            invalid={Boolean(errors[key])}
            placeholder={meta.nullable ? t('auto') : undefined}
            onChange={(e) => setNum(key, e.target.value)}
            className={cn(isModified(key) && 'border-amber-400/40', meta.unit && 'pe-16')}
          />
          {meta.unit && (
            <span className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
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
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <>
            <Button icon={RefreshCw} onClick={() => void load()} disabled={loading || saving}>
              {t('page.reload')}
            </Button>
            {canEdit && (
              <Button icon={RotateCcw} variant="danger" onClick={() => setResetOpen(true)} disabled={loading || saving}>
                {t('page.reset')}
              </Button>
            )}
          </>
        }
      />

      {!canEdit && !loading && (
        <div className="zp-anim-fade-up flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-400">
          <Lock className="h-4 w-4 shrink-0 text-slate-500" />
          {t('page.readOnly')}
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
            title={t('sections.thresholds.title')}
            description={t('sections.thresholds.desc')}
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
                    aria-label={t(`fields.${key}.label` as never) || NUM_META[key].label}
                  />
                </div>
              ))}
            </div>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* ============ Challenges ============ */}
            <Section
              icon={ShieldCheck}
              title={t('sections.challenges.title')}
              description={t('sections.challenges.desc')}
              delay={60}
            >
              <ToggleRow
                label={t('sections.challenges.silentJs')}
                hint={t('sections.challenges.silentJsHint')}
                checked={draft.enableJsChallenge}
                modified={isModified('enableJsChallenge')}
                disabled={!canEdit || saving}
                onChange={(v) => setBool('enableJsChallenge', v)}
              />
              <ToggleRow
                label={t('sections.challenges.challengeAll')}
                hint={t('sections.challenges.challengeAllHint')}
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
              title={t('sections.ai.title')}
              description={t('sections.ai.desc')}
              delay={120}
            >
              <ToggleRow
                label={t('sections.ai.useAi')}
                hint={t('sections.ai.useAiHint')}
                checked={draft.enableAiAnomaly}
                modified={isModified('enableAiAnomaly')}
                disabled={!canEdit || saving}
                onChange={(v) => setBool('enableAiAnomaly', v)}
              />
              <p className="rounded-xl border border-cyan-400/15 bg-cyan-500/5 px-4 py-3 text-xs leading-relaxed text-slate-400">
                {t('sections.ai.note')}
              </p>
            </Section>

            {/* ============ Rate limiting ============ */}
            <Section
              icon={Timer}
              title={t('sections.rateLimiting.title')}
              description={t('sections.rateLimiting.desc')}
              delay={180}
            >
              <div className="grid gap-5 sm:grid-cols-2">
                {num('rateLimitRequests')}
                {num('rateLimitWindowSec')}
                {num('maxRequestsPerIp')}
                {num('maxRequestsWindowSec')}
              </div>
              <ToggleRow
                label={t('sections.rateLimiting.banOnHard')}
                hint={t('sections.rateLimiting.banOnHardHint')}
                checked={draft.banOnMaxRequests}
                modified={isModified('banOnMaxRequests')}
                disabled={!canEdit || saving}
                onChange={(v) => setBool('banOnMaxRequests', v)}
              />
            </Section>

            {/* ============ Automatic bans ============ */}
            <Section
              icon={ShieldAlert}
              title={t('sections.autoBans.title')}
              description={t('sections.autoBans.desc')}
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
            title={t('sections.capacity.title')}
            description={t('sections.capacity.desc')}
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
                <h3 className="text-sm font-semibold text-white">{t('lastChanges.title')}</h3>
                <button
                  type="button"
                  onClick={() => setLastChanges([])}
                  className="text-slate-500 hover:text-white"
                  aria-label={t('lastChanges.dismiss')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ul className="space-y-1.5">
                {lastChanges.map((c) => (
                  <li key={c.field} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-slate-300">{c.field}</span>
                    <span className="text-slate-600">{String(c.from ?? t('auto'))}</span>
                    <span className="text-slate-600">→</span>
                    <span className="text-emerald-300">{String(c.to ?? t('auto'))}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="text-center text-xs text-slate-600">
            {t('updatedAt', { time: timeAgo(policy.updatedAt) })}
          </p>

          {/* ============ شريط الحفظ (بيظهر مع وجود تعديلات) ============ */}
          {canEdit && dirty && (
            <div className="sticky bottom-4 z-30 flex justify-center">
              <div className="zp-anim-scale-in flex w-full max-w-xl items-center justify-between gap-4 rounded-2xl border border-amber-400/25 bg-[#0b1224]/95 px-5 py-3.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {t('bar.unsaved', { count: dirtyCount })}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {hasErrors ? t('bar.fixErrors') : t('bar.review')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" icon={Undo2} disabled={saving} onClick={() => policy && setDraft(toDraft(policy))}>
                    {t('bar.discard')}
                  </Button>
                  <Button variant="primary" icon={Save} loading={saving} disabled={hasErrors} onClick={() => void save()}>
                    {t('bar.save')}
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
        title={t('resetModal.title')}
        description={t('resetModal.description')}
        icon={RotateCcw}
        tone="amber"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)} disabled={saving}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button variant="danger" loading={saving} onClick={() => void resetAll()}>
              {t('resetModal.confirm')}
            </Button>
          </>
        }
      />
    </PageShell>
  )
}
