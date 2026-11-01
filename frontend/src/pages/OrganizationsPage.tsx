// frontend/src/pages/OrganizationsPage.tsx
// ==================================================================
// Zero Plus - Organization Page
// بيانات الشركة (مربوطة بـ backend/modules/organizations)
//
//   GET   /organizations/me → بيانات الشركة + _count (users, servers)
//   PATCH /organizations/me → { name?, slug? } (بنبعت الحقل اللي اتغير بس)
//
// ملاحظات:
//   - الباك مفيهوش فحص صلاحيات على PATCH، فالواجهة بتسمح بالتعديل لـ
//     OWNER/ADMIN بس (والأفضل إضافة requireRole في الباك لاحقًا).
//   - بعد الحفظ بنحدّث اسم الشركة في authStore عشان الـ Navbar يتغير فورًا.
//   - الـ slug: حروف صغيرة وأرقام وشرطات بس (نفس regex الباك)
//     والباك بيرجع 409 لو مستخدم عند شركة تانية.
//
// التصميم: كارت بروفايل (أفتار + اسم + @slug + أرقام) → [فورم التعديل | معلومات + روابط سريعة]
// ==================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  ChevronRight,
  Copy,
  FileText,
  Hash,
  Lock,
  RefreshCw,
  Save,
  Server,
  SlidersHorizontal,
  Undo2,
  Users,
} from 'lucide-react'

import { useToast } from '../components/ui/Toast'
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  KeyValue,
  PageHeader,
  PageShell,
  Skeleton,
  TextInput,
  type IconType,
} from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import {
  getMyOrganization,
  updateMyOrganization,
  type Organization,
  type UpdateOrganizationInput,
} from '../services/organizationsService'
import { selectUserRole, useAuthStore } from '../store/authStore'
import { formatDateTime, formatNumber, timeAgo } from '../utils/format'

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** اقتراح slug من الاسم (بيتعرض كزرار، مش بيتطبق لوحده) */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** حروف الأفتار: أول حرف من أول كلمتين */
function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
  return letters || 'Z'
}

// ==================================================================
// خلية رقم في كارت البروفايل
// ==================================================================

function ProfileStat({
  icon: Icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: IconType
  label: string
  value: string
  hint?: string
  loading: boolean
}) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <Icon className="h-3.5 w-3.5 text-cyan-400" />
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16 rounded-md" />
      ) : (
        <p className="mt-1 truncate text-2xl font-bold tracking-tight tabular-nums text-white">{value}</p>
      )}
      {hint && !loading && <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

// ==================================================================
// Page
// ==================================================================

export default function OrganizationsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const role = useAuthStore(selectUserRole)
  const canEdit = role === 'OWNER' || role === 'ADMIN'

  const [org, setOrg] = useState<Organization | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})

  // ---------------- Load ----------------
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getMyOrganization()
      setOrg(data)
      setName(data.name)
      setSlug(data.slug)
      setError(null)
    } catch (err) {
      const { message } = parseApiError(err)
      setError(message)
      toast.error('Failed to load organization', message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  // ---------------- Validation (نفس قواعد organizations.schema.ts) ----------------
  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    const n = name.trim()
    if (n.length < 2) e.name = 'Name must be at least 2 characters'
    else if (n.length > 100) e.name = 'Name must be at most 100 characters'
    if (slug.length < 2) e.slug = 'Slug must be at least 2 characters'
    else if (slug.length > 100) e.slug = 'Slug must be at most 100 characters'
    else if (!SLUG_REGEX.test(slug)) e.slug = 'Lowercase letters, numbers and single dashes only'
    return e
  }, [name, slug])

  const patch = useMemo<UpdateOrganizationInput>(() => {
    if (!org) return {}
    return {
      ...(name.trim() !== org.name && { name: name.trim() }),
      ...(slug !== org.slug && { slug }),
    }
  }, [org, name, slug])

  const dirty = Object.keys(patch).length > 0
  const hasErrors = Object.keys(errors).length > 0

  // ---------------- Save ----------------
  const save = async () => {
    if (!dirty || hasErrors) return
    setSaving(true)
    setServerErrors({})
    try {
      const res = await updateMyOrganization(patch)
      // PATCH مبيرجعش _count فنحافظ على القديم
      const merged: Organization = { ...res.organization, ...(org?._count && { _count: org._count }) }
      setOrg(merged)
      setName(merged.name)
      setSlug(merged.slug)

      // تحديث اسم الشركة في الـ store (الـ Navbar بيقرأ منه)
      const current = useAuthStore.getState().organization
      if (current) {
        useAuthStore.setState({ organization: { ...current, name: merged.name, slug: merged.slug } })
      }
      toast.success(res.message)
    } catch (err) {
      const parsed = parseApiError(err)
      // 409 = الـ slug مستخدم عند شركة تانية
      if (parsed.status === 409) setServerErrors({ slug: parsed.message })
      else setServerErrors(parsed.fieldErrors)
      toast.error('Could not update organization', parsed.message)
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (!org) return
    setName(org.name)
    setSlug(org.slug)
    setServerErrors({})
  }

  const copyId = async () => {
    if (!org) return
    try {
      await navigator.clipboard.writeText(org.id)
      toast.success('Organization ID copied')
    } catch {
      toast.error('Copy failed', 'Your browser blocked clipboard access')
    }
  }

  const quickLinks: { label: string; hint: string; path: string; icon: IconType }[] = [
    { label: 'Protected servers', hint: 'Domains, DNS and health', path: '/servers', icon: Server },
    { label: 'Security policies', hint: 'Rules the Gateway enforces', path: '/policies', icon: SlidersHorizontal },
    { label: 'Reports', hint: 'AI-written security reports', path: '/reports', icon: FileText },
  ]

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <PageHeader
        icon={Building2}
        title="Organization"
        subtitle="Your company profile and workspace overview."
        actions={
          <Button icon={RefreshCw} onClick={() => void load()} disabled={loading || saving}>
            Refresh
          </Button>
        }
      />

      {error && !org ? (
        <Card><ErrorState message={error} onRetry={() => void load()} /></Card>
      ) : (
        <>
          {/* ---------- تنبيه الإيقاف ---------- */}
          {org && !org.isActive && (
            <div className="zp-anim-fade-up flex items-center gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/6 px-5 py-4 text-sm text-rose-200">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              This organization is suspended. Contact support to restore protection.
            </div>
          )}

          {/* ---------- كارت البروفايل ---------- */}
          <Card accent delay={60}>
            <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-cyan-400/25 to-blue-600/25 text-2xl font-bold text-cyan-200 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-400/25">
                {loading || !org ? <Building2 className="h-7 w-7" /> : initials(org.name)}
              </div>

              <div className="min-w-0 flex-1">
                {loading || !org ? (
                  <>
                    <Skeleton className="h-7 w-48 rounded-md" />
                    <Skeleton className="mt-2 h-4 w-32 rounded-md" />
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 dir="auto" className="truncate text-2xl font-bold tracking-tight text-white">
                        {org.name}
                      </h2>
                      <Badge tone={org.isActive ? 'emerald' : 'rose'} dot>
                        {org.isActive ? 'Active' : 'Suspended'}
                      </Badge>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm text-slate-400">
                      <span>@{org.slug}</span>
                      <button
                        type="button"
                        onClick={() => void copyId()}
                        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-slate-500 hover:bg-white/5 hover:text-cyan-300"
                      >
                        <Copy className="h-3 w-3" />
                        Copy ID
                      </button>
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 divide-white/6 border-t border-white/6 sm:grid-cols-3 sm:divide-x">
              <ProfileStat
                icon={Users}
                label="Team members"
                value={formatNumber(org?._count?.users)}
                loading={loading}
              />
              <ProfileStat
                icon={Server}
                label="Protected servers"
                value={formatNumber(org?._count?.servers)}
                loading={loading}
              />
              <ProfileStat
                icon={CalendarDays}
                label="Workspace age"
                value={org ? timeAgo(org.createdAt).replace(' ago', '') : '—'}
                hint={org ? `Since ${formatDateTime(org.createdAt)}` : undefined}
                loading={loading}
              />
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {/* ---------- Edit form ---------- */}
            <Card className="p-6" delay={150}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Company details</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    The name appears in the sidebar and in reports. The slug is your unique workspace handle.
                  </p>
                </div>
                {dirty && !loading && <Badge tone="amber" dot>Unsaved changes</Badge>}
              </div>

              {!canEdit && !loading && (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-400">
                  <Lock className="h-4 w-4 shrink-0 text-slate-500" />
                  Only Owners and Admins can edit organization details.
                </div>
              )}

              {loading ? (
                <div className="mt-6 space-y-5">
                  <Skeleton className="h-11 w-full rounded-xl" />
                  <Skeleton className="h-11 w-full rounded-xl" />
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  <Field label="Company name" error={errors.name ?? serverErrors.name}>
                    <TextInput
                      icon={Building2}
                      value={name}
                      disabled={!canEdit || saving}
                      invalid={Boolean(errors.name ?? serverErrors.name)}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={100}
                    />
                  </Field>

                  <Field
                    label="Workspace slug"
                    error={errors.slug ?? serverErrors.slug}
                    hint="Lowercase letters, numbers and dashes — e.g. acme-corp"
                  >
                    <TextInput
                      icon={Hash}
                      value={slug}
                      disabled={!canEdit || saving}
                      invalid={Boolean(errors.slug ?? serverErrors.slug)}
                      onChange={(e) => {
                        setSlug(e.target.value.toLowerCase())
                        setServerErrors((s) => ({ ...s, slug: '' }))
                      }}
                      maxLength={100}
                      autoComplete="off"
                    />
                  </Field>

                  {canEdit && name.trim() && slugify(name) !== slug && SLUG_REGEX.test(slugify(name)) && (
                    <button
                      type="button"
                      onClick={() => setSlug(slugify(name))}
                      className="text-xs text-cyan-400/80 hover:text-cyan-300"
                    >
                      Use “{slugify(name)}” from the company name
                    </button>
                  )}

                  {canEdit && (
                    <div className="flex items-center justify-end gap-2 border-t border-white/6 pt-5">
                      {dirty && (
                        <Button variant="ghost" icon={Undo2} onClick={discard} disabled={saving}>
                          Discard
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        icon={Save}
                        loading={saving}
                        disabled={!dirty || hasErrors}
                        onClick={() => void save()}
                      >
                        Save changes
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* ---------- العمود الجانبي ---------- */}
            <div className="space-y-6">
              <Card className="p-6" delay={210}>
                <h2 className="mb-2 text-base font-semibold text-white">Workspace info</h2>
                {loading || !org ? (
                  <div className="space-y-3 pt-2">
                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
                  </div>
                ) : (
                  <>
                    <KeyValue label="Organization ID" mono>
                      <span className="inline-flex items-center gap-2">
                        {org.id}
                        <button
                          type="button"
                          aria-label="Copy organization ID"
                          className="text-slate-500 hover:text-cyan-300"
                          onClick={() => void copyId()}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </KeyValue>
                    <KeyValue label="Created">{formatDateTime(org.createdAt)}</KeyValue>
                    <KeyValue label="Updated">{formatDateTime(org.updatedAt)}</KeyValue>
                  </>
                )}
              </Card>

              <Card className="p-3" delay={270}>
                <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Quick links
                </p>
                <ul>
                  {quickLinks.map((l) => (
                    <li key={l.path}>
                      <button
                        type="button"
                        onClick={() => navigate(l.path)}
                        className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/5"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
                          <l.icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-white">{l.label}</span>
                          <span className="block truncate text-xs text-slate-500">{l.hint}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-cyan-300" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </PageShell>
  )
}