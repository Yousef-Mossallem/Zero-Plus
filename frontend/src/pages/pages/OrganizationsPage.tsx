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
// ==================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Copy,
  Hash,
  Lock,
  RefreshCw,
  Save,
  Server,
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
  StatCard,
  TextInput,
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
          {/* ---------- Overview stats ---------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Team members" value={formatNumber(org?._count?.users)} icon={Users} tone="cyan" loading={loading} delay={0} />
            <StatCard label="Protected servers" value={formatNumber(org?._count?.servers)} icon={Server} tone="emerald" loading={loading} delay={60} />
            <StatCard
              label="Workspace age"
              value={org ? timeAgo(org.createdAt).replace(' ago', '') : '—'}
              icon={CalendarDays}
              tone="indigo"
              loading={loading}
              hint={org ? `Since ${formatDateTime(org.createdAt)}` : undefined}
              delay={120}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* ---------- Edit form ---------- */}
            <Card className="p-6 lg:col-span-2" delay={150} accent>
              <h2 className="text-base font-semibold text-white">Company details</h2>
              <p className="mt-1 text-sm text-slate-500">
                The name appears in the sidebar and in reports. The slug is your unique workspace handle.
              </p>

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

            {/* ---------- Details ---------- */}
            <Card className="p-6" delay={210}>
              <h2 className="mb-2 text-base font-semibold text-white">Workspace info</h2>
              {loading || !org ? (
                <div className="space-y-3 pt-2">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
                </div>
              ) : (
                <>
                  <KeyValue label="Status">
                    <Badge tone={org.isActive ? 'emerald' : 'rose'} dot>
                      {org.isActive ? 'Active' : 'Suspended'}
                    </Badge>
                  </KeyValue>
                  <KeyValue label="Organization ID" mono>
                    <span className="inline-flex items-center gap-2">
                      {org.id}
                      <button
                        type="button"
                        aria-label="Copy organization ID"
                        className="text-slate-500 hover:text-cyan-300"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(org.id)
                            toast.success('Organization ID copied')
                          } catch {
                            toast.error('Copy failed', 'Your browser blocked clipboard access')
                          }
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </KeyValue>
                  <KeyValue label="Created">{formatDateTime(org.createdAt)}</KeyValue>
                  <KeyValue label="Updated">{formatDateTime(org.updatedAt)}</KeyValue>
                </>
              )}

              <div className="mt-5 flex flex-col gap-2">
                <Button icon={Server} onClick={() => navigate('/servers')}>Manage servers</Button>
              </div>
            </Card>
          </div>

          {org && !org.isActive && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-500/25 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              This organization is suspended. Contact support to restore protection.
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}
