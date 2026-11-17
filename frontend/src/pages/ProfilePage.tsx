// frontend/src/pages/ProfilePage.tsx
// ==================================================================
// Zero Plus - Profile Page
// Connected to backend/modules/auth
//
//   GET    /auth/me                            → user + organization + devices
//   PATCH  /auth/profile                       → { fullName }
//   GET    /auth/passkeys                      → refresh list after add/delete
//   POST   /auth/passkeys/invite               → { token, url, expiresAt, expiresInSeconds }
//   DELETE /auth/passkeys                      → { passkeyId }  (row id, not credentialId)
//   POST   /auth/password                      → { newPassword } (backup only, not for login)
//
// Notes from the backend:
//   - Email and organization name are read-only.
//   - Deletion is soft and you cannot delete the last device.
//   - Invite URL comes from the backend — never generate it locally.
//   - QR is generated from the backend url field.
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'react-qr-code'
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Clock,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Laptop,
  Lock,
  Mail,
  QrCode,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  Undo2,
  User,
} from 'lucide-react'

import { useToast } from '../components/ui/Toast'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  KeyValue,
  Modal,
  PageHeader,
  PageShell,
  Skeleton,
  TextInput,
  type IconType,
  type Tone,
} from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import {
  createPasskeyInvite,
  getMe,
  listPasskeys,
  revokePasskey,
  setPassword,
  updateProfile,
  type AuthPasskeySummary,
  type PasskeyInviteResult,
} from '../services/authService'
import { useAuthStore } from '../store/authStore'
import { formatDateTime, timeAgo } from '../utils/format'

type MeData = Awaited<ReturnType<typeof getMe>>

// ==================================================================
// Helpers
// ==================================================================

const ROLE_TONE: Record<string, Tone> = {
  OWNER: 'amber',
  ADMIN: 'indigo',
  ANALYST: 'cyan',
  VIEWER: 'slate',
}

function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
  return letters || 'Z'
}

// ---- Browser errors during biometric (section 5 of the guide) ----
const BROWSER_ERRORS: Record<string, string> = {
  NotAllowedError: 'The prompt was cancelled or timed out',
  InvalidStateError: 'This device is already registered',
  NotSupportedError: 'Your device does not support Passkeys',
  SecurityError: 'The domain or origin does not match the backend settings',
  AbortError: 'The operation was cancelled',
}

/**
 * Converts any error (browser or backend) into a display message.
 */
function describePasskeyError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const known = BROWSER_ERRORS[String((err as { name: unknown }).name)]
    if (known) return known
  }

  const parsed = parseApiError(err)
  const msg = parsed.message

  if (msg.includes('Challenge expired')) return 'Time expired, try again'
  if (msg.includes('Biometric verification failed')) return 'Biometric verification failed'
  if (msg.includes('This passkey is already registered')) return 'This device is already registered'
  if (msg.includes('Passkey not found')) return 'The device was already deleted'
  if (msg.includes('Cannot revoke your last passkey')) return 'At least one device must remain'
  if (msg.includes('User not found')) return 'Account not found or disabled'
  if (msg.includes('Internal server error')) return 'A server error occurred, please try again'
  if (msg.includes('INVITE_EXPIRED') || msg.includes('Invite expired')) return 'Invitation expired'
  if (msg.includes('INVITE_ALREADY_USED') || msg.includes('Invite already used')) return 'This invitation was already used'
  if (msg.includes('INVITE_NOT_FOUND') || msg.includes('Invite not found')) return 'Invitation not found'

  if (msg.includes('Validation failed')) {
    const details = Object.values(parsed.fieldErrors)
    return details.length > 0 ? details.join(' • ') : msg
  }

  return msg
}

// ==================================================================
// Small pieces
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
        <Skeleton className="mt-2 h-7 w-24 rounded-md" />
      ) : (
        <p dir="auto" className="mt-1 truncate text-lg font-bold tracking-tight text-white">
          {value}
        </p>
      )}
      {hint && !loading && <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function PasskeyRow({
  passkey,
  canDelete,
  onDelete,
}: {
  passkey: AuthPasskeySummary
  canDelete: boolean
  onDelete: () => void
}) {
  const name = passkey.deviceName || 'Passkey'
  const transports = passkey.transports ?? []
  const isPhone = /iphone|ipad|android|phone/i.test(name) || transports.includes('hybrid')
  const Icon = isPhone ? Smartphone : Laptop

  return (
    <li className="flex items-center gap-4 px-6 py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate text-sm font-medium text-white">
          {name}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          Last used {passkey.lastUsedAt ? timeAgo(passkey.lastUsedAt) : '—'} · Added{' '}
          {formatDateTime(passkey.createdAt)}
        </p>
        {transports.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {transports.map((t) => (
              <Badge key={t} tone="slate">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Button
        variant="danger"
        size="sm"
        icon={Trash2}
        disabled={!canDelete}
        title={canDelete ? 'Remove this device' : 'At least one device must remain'}
        onClick={onDelete}
      >
        Remove
      </Button>
    </li>
  )
}

// ==================================================================
// Page
// ==================================================================

export default function ProfilePage() {
  const toast = useToast()

  // ---------------- Data ----------------
  const [me, setMe] = useState<MeData | null>(null)
  const [passkeys, setPasskeys] = useState<AuthPasskeySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ---------------- Name ----------------
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameServerError, setNameServerError] = useState<string | undefined>()

  // ---------------- Add device (QR Invite) ----------------
  const [addOpen, setAddOpen] = useState(false)
  const [invite, setInvite] = useState<PasskeyInviteResult | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ---------------- Delete device ----------------
  const [deleteTarget, setDeleteTarget] = useState<AuthPasskeySummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ---------------- Password ----------------
  const [pwd, setPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [savingPwd, setSavingPwd] = useState(false)
  const [pwdServerError, setPwdServerError] = useState<string | undefined>()

  // ---------------- Load (single request: /auth/me includes devices) ----------------
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getMe()
      setMe(data)
      setName(data.fullName)
      setPasskeys(data.passkeys ?? [])
      setError(null)
    } catch (err) {
      const message = describePasskeyError(err)
      setError(message)
      toast.error('Failed to load profile', message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  /** Refresh the list after add and delete: GET /auth/passkeys */
  const refreshPasskeys = useCallback(async () => {
    try {
      setPasskeys(await listPasskeys())
    } catch (err) {
      toast.error('Could not refresh devices', describePasskeyError(err))
    }
  }, [toast])

  // ==================================================================
  // Name (same backend rules: 2–100 characters, leading/trailing spaces are trimmed)
  // ==================================================================

  const trimmedName = name.trim()
  const nameError =
    trimmedName.length < 2
      ? 'Name must be at least 2 characters'
      : trimmedName.length > 100
        ? 'Name is too long'
        : undefined
  const nameDirty = me !== null && trimmedName !== me.fullName

  const saveName = async () => {
    if (!nameDirty || nameError) return
    setSavingName(true)
    setNameServerError(undefined)
    try {
      // We only send fullName (schema is strict)
      const updated = await updateProfile(trimmedName)
      setMe((prev) => (prev ? { ...prev, fullName: updated.fullName } : prev))
      setName(updated.fullName)

      // Update the name in the store so the Navbar changes immediately
      const current = useAuthStore.getState().user
      if (current) {
        useAuthStore.setState({ user: { ...current, fullName: updated.fullName } })
      }
      toast.success('Profile updated')
    } catch (err) {
      const parsed = parseApiError(err)
      setNameServerError(parsed.fieldErrors.fullName)
      toast.error('Could not update profile', describePasskeyError(err))
    } finally {
      setSavingName(false)
    }
  }

  // ==================================================================
  // Add device: POST /auth/passkeys/invite → show QR with countdown
  // ==================================================================

  /** يوقف الـ timer لو شغال */
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const openAdd = async () => {
    setInvite(null)
    setInviteError(null)
    setTimeLeft(0)
    setAddOpen(true)
    setInviteLoading(true)
    clearTimer()
    try {
      const result = await createPasskeyInvite()
      setInvite(result)
      setTimeLeft(result.expiresInSeconds)
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearTimer()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (err) {
      setInviteError(describePasskeyError(err))
    } finally {
      setInviteLoading(false)
    }
  }

  const closeAdd = () => {
    clearTimer()
    setAddOpen(false)
    setInvite(null)
    setInviteError(null)
    setTimeLeft(0)
  }

  // ==================================================================
  // Delete device (soft delete)
  // ==================================================================

  const canDelete = passkeys.length > 1

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      // passkeyId = the row id in the list (not credentialId)
      await revokePasskey(deleteTarget.id)
      toast.success('Device removed', deleteTarget.deviceName ?? undefined)
      setDeleteTarget(null)
      await refreshPasskeys()
    } catch (err) {
      const message = describePasskeyError(err)
      if (parseApiError(err).message.includes('Passkey not found')) {
        // The device was already deleted: close and refresh the list
        setDeleteTarget(null)
        toast.error(message)
        await refreshPasskeys()
      } else {
        setDeleteError(message)
      }
    } finally {
      setDeleting(false)
    }
  }

  // ==================================================================
  // Backup password (8–128, lowercase + uppercase + number)
  // ==================================================================

  const pwdError = useMemo(() => {
    if (!pwd) return undefined
    if (pwd.length < 8) return 'Password must be at least 8 characters'
    if (pwd.length > 128) return 'Password is too long'
    if (!/[a-z]/.test(pwd)) return 'Must contain a lowercase letter'
    if (!/[A-Z]/.test(pwd)) return 'Must contain an uppercase letter'
    if (!/[0-9]/.test(pwd)) return 'Must contain a number'
    return undefined
  }, [pwd])

  const savePassword = async () => {
    if (!pwd || pwdError) return
    setSavingPwd(true)
    setPwdServerError(undefined)
    try {
      await setPassword(pwd)
      setPwd('')
      setShowPwd(false)
      toast.success('Backup password saved')
    } catch (err) {
      setPwdServerError(parseApiError(err).fieldErrors.newPassword)
      toast.error('Could not set password', describePasskeyError(err))
    } finally {
      setSavingPwd(false)
    }
  }

  // ==================================================================
  // Render
  // ==================================================================

  const organization = me?.organization

  return (
    <PageShell>
      <PageHeader
        icon={User}
        title="Profile"
        subtitle="Your account details, devices and security."
        actions={
          <Button
            icon={RefreshCw}
            onClick={() => void load()}
            disabled={loading || savingName || deleting || inviteLoading}
          >
            Refresh
          </Button>
        }
      />

      {error && !me ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : (
        <>
          {/* ---------- Profile card ---------- */}
          <Card accent delay={60}>
            <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-cyan-400/25 to-blue-600/25 text-2xl font-bold text-cyan-200 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-400/25">
                {loading || !me ? <User className="h-7 w-7" /> : initials(me.fullName)}
              </div>

              <div className="min-w-0 flex-1">
                {loading || !me ? (
                  <>
                    <Skeleton className="h-7 w-48 rounded-md" />
                    <Skeleton className="mt-2 h-4 w-40 rounded-md" />
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 dir="auto" className="truncate text-2xl font-bold tracking-tight text-white">
                        {me.fullName}
                      </h2>
                      <Badge tone={ROLE_TONE[me.role] ?? 'slate'} dot>
                        {me.role}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate font-mono text-sm text-slate-400">{me.email}</p>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 divide-white/6 border-t border-white/6 sm:grid-cols-3 sm:divide-x">
              <ProfileStat
                icon={Building2}
                label="Organization"
                value={organization?.name ?? '—'}
                hint={organization ? `@${organization.slug}` : undefined}
                loading={loading}
              />
              <ProfileStat
                icon={Clock}
                label="Last login"
                value={me?.lastLoginAt ? timeAgo(me.lastLoginAt) : '—'}
                hint={me?.lastLoginAt ? formatDateTime(me.lastLoginAt) : undefined}
                loading={loading}
              />
              <ProfileStat
                icon={CalendarDays}
                label="Member since"
                value={me?.createdAt ? formatDateTime(me.createdAt) : '—'}
                loading={loading}
              />
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {/* ================= Main column ================= */}
            <div className="space-y-6">
              {/* ---------- Edit name ---------- */}
              <Card className="p-6" delay={150}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-white">Personal details</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Your name appears in the sidebar and across the workspace.
                    </p>
                  </div>
                  {nameDirty && !loading && (
                    <Badge tone="amber" dot>
                      Unsaved changes
                    </Badge>
                  )}
                </div>

                {loading ? (
                  <div className="mt-6 space-y-5">
                    <Skeleton className="h-11 w-full rounded-xl" />
                    <Skeleton className="h-11 w-full rounded-xl" />
                  </div>
                ) : (
                  <div className="mt-6 space-y-5">
                    <Field label="Full name" error={nameError ?? nameServerError}>
                      <TextInput
                        icon={User}
                        dir="auto"
                        value={name}
                        disabled={savingName}
                        invalid={Boolean(nameError ?? nameServerError)}
                        onChange={(e) => {
                          setName(e.target.value)
                          setNameServerError(undefined)
                        }}
                        maxLength={100}
                        autoComplete="name"
                      />
                    </Field>

                    {/* Email: read-only (no edit from the current backend) */}
                    <Field label="Email" hint="Email can’t be changed.">
                      <TextInput icon={Mail} value={me?.email ?? ''} disabled readOnly />
                    </Field>

                    <div className="flex items-center justify-end gap-2 border-t border-white/6 pt-5">
                      {nameDirty && (
                        <Button
                          variant="ghost"
                          icon={Undo2}
                          disabled={savingName}
                          onClick={() => {
                            setName(me?.fullName ?? '')
                            setNameServerError(undefined)
                          }}
                        >
                          Discard
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        icon={Save}
                        loading={savingName}
                        disabled={!nameDirty || Boolean(nameError)}
                        onClick={() => void saveName()}
                      >
                        Save changes
                      </Button>
                    </div>
                  </div>
                )}
              </Card>

              {/* ---------- Devices (Passkeys) ---------- */}
              <Card className="overflow-hidden" delay={210}>
                <div className="flex flex-col gap-3 p-6 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-base font-semibold text-white">Your devices</h2>
                      {!loading && <Badge tone="cyan">{passkeys.length}</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Devices that can sign in to your account with biometrics.
                    </p>
                  </div>

                  {/* Add device via QR — works from any device */}
                  <Button variant="primary" icon={QrCode} disabled={loading} onClick={() => void openAdd()}>
                    Add device
                  </Button>
                </div>



                {!loading && passkeys.length === 1 && (
                  <div className="mx-6 mb-4 flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-400">
                    <Lock className="h-4 w-4 shrink-0 text-slate-500" />
                    <span dir="auto">
                      At least one device must remain, so you cannot delete the last device.
                    </span>
                  </div>
                )}

                {loading ? (
                  <div className="space-y-3 border-t border-white/6 p-6">
                    {[0, 1].map((i) => (
                      <Skeleton key={i} className="h-14 w-full rounded-xl" />
                    ))}
                  </div>
                ) : passkeys.length === 0 ? (
                  <div className="border-t border-white/6">
                    <EmptyState
                      icon={Fingerprint}
                      title="No devices yet"
                      description="Add a device to sign in with your fingerprint or face."
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-white/6 border-t border-white/6">
                    {passkeys.map((p) => (
                      <PasskeyRow
                        key={p.id}
                        passkey={p}
                        canDelete={canDelete}
                        onDelete={() => {
                          setDeleteError(null)
                          setDeleteTarget(p)
                        }}
                      />
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* ================= Sidebar column ================= */}
            <div className="space-y-6">
              {/* ---------- Account info (read-only) ---------- */}
              <Card className="p-6" delay={270}>
                <h2 className="mb-2 text-base font-semibold text-white">Account info</h2>
                {loading || !me ? (
                  <div className="space-y-3 pt-2">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-5 w-full" />
                    ))}
                  </div>
                ) : (
                  <>
                    <KeyValue label="Company">{organization?.name}</KeyValue>
                    <KeyValue label="Slug" mono>
                      {organization?.slug}
                    </KeyValue>
                    <KeyValue label="Plan">
                      <Badge tone="indigo">{organization?.plan ?? '—'}</Badge>
                    </KeyValue>
                    <KeyValue label="Size">{organization?.sizeProfile ?? '—'}</KeyValue>
                    <KeyValue label="Role">{me.role}</KeyValue>
                    <KeyValue label="User ID" mono>
                      {me.id}
                    </KeyValue>
                  </>
                )}
              </Card>

              {/* ---------- Backup password ---------- */}
              <Card className="p-6" delay={330}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <h2 className="text-base font-semibold text-white">Backup password</h2>
                </div>

                <div className="mt-3 flex items-start gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-xs text-slate-400">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
                  <span dir="auto">
                    Backup password only. It does not let anyone in because sign-in is biometric only.
                  </span>
                </div>

                <div className="mt-5 space-y-4">
                  <Field
                    label="New password"
                    error={pwdError ?? pwdServerError}
                    hint="8–128 characters, with a lowercase letter, an uppercase letter and a number."
                  >
                    <div className="relative">
                      <TextInput
                        icon={Lock}
                        type={showPwd ? 'text' : 'password'}
                        value={pwd}
                        disabled={savingPwd}
                        invalid={Boolean(pwdError ?? pwdServerError)}
                        onChange={(e) => {
                          setPwd(e.target.value)
                          setPwdServerError(undefined)
                        }}
                        maxLength={128}
                        autoComplete="new-password"
                        className="pr-11"
                      />
                      <button
                        type="button"
                        aria-label={showPwd ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPwd((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-cyan-300"
                      >
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>

                  <Button
                    variant="primary"
                    icon={Save}
                    className="w-full"
                    loading={savingPwd}
                    disabled={!pwd || Boolean(pwdError)}
                    onClick={() => void savePassword()}
                  >
                    Save password
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* ================= Modal: Add device (QR Invite) ================= */}
      <Modal
        open={addOpen}
        onClose={closeAdd}
        icon={QrCode}
        title="Add a new device"
        description="Scan this QR code from the device you want to add, then follow the on-screen instructions."
        footer={
          <Button variant="ghost" onClick={closeAdd}>
            Close
          </Button>
        }
      >
        {inviteLoading && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Skeleton className="h-48 w-48 rounded-xl" />
            <p className="text-sm text-slate-400">Generating QR code…</p>
          </div>
        )}

        {inviteError && !inviteLoading && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/6 px-4 py-3 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span dir="auto">{inviteError}</span>
          </div>
        )}

        {invite && !inviteLoading && (
          <div className="flex flex-col items-center gap-5">
            {/* QR Code — البيانات جاية من الباك اند */}
            <div className="rounded-2xl bg-white p-4 shadow-lg shadow-cyan-500/10">
              <QRCode value={invite.url} size={192} />
            </div>

            {/* Countdown timer */}
            <div className="flex items-center gap-2 text-sm">
              {timeLeft > 0 ? (
                <>
                  <Clock className="h-4 w-4 text-cyan-400" />
                  <span className={timeLeft < 60 ? 'text-amber-400 font-semibold' : 'text-slate-300'}>
                    Expires in {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                  <span className="text-rose-400 font-semibold">Invitation expired</span>
                </>
              )}
            </div>

            {/* Instructions */}
            <div className="w-full space-y-2 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-xs text-slate-400">
              <p className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400 font-semibold text-[10px]">1</span>
                Open the camera on the new device and scan the QR code.
              </p>
              <p className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400 font-semibold text-[10px]">2</span>
                Follow the on-screen instructions to register your biometrics.
              </p>
              <p className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400 font-semibold text-[10px]">3</span>
                Once done, your device list updates automatically.
              </p>
            </div>

            {timeLeft > 0 && (
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void openAdd()}>
                Generate new QR
              </Button>
            )}

            {timeLeft === 0 && (
              <Button variant="primary" size="sm" icon={QrCode} onClick={() => void openAdd()}>
                Generate new QR
              </Button>
            )}
          </div>
        )}
      </Modal>

      {/* ================= Modal: Confirm delete ================= */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        icon={Trash2}
        tone="rose"
        title="Remove this device?"
        description={`“${deleteTarget?.deviceName || 'Passkey'}” will no longer be able to sign in to your account.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              loading={deleting}
              onClick={() => void confirmDelete()}
            >
              Remove device
            </Button>
          </>
        }
      >
        {deleteError && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/6 px-4 py-3 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span dir="auto">{deleteError}</span>
          </div>
        )}
      </Modal>
    </PageShell>
  )
}