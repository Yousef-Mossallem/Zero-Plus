// frontend/src/pages/team/InvitesTab.tsx
// ==================================================================
// تبويب الدعوات — قائمة + إنشاء + إعادة إرسال + إلغاء
// ==================================================================

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react'

import { Button, Field, TextInput } from '../../components/ui/kit'
import {
  listInvites,
  createInvite,
  resendInvite,
  revokeInvite,
  getTeamErrorMessage,
  type TeamInvite,
  type InviteStatus,
  type EditableRole,
} from '../../services/teamService'
import { selectHasPermission } from '../../store/authStore'
import useAuthStore from '../../store/authStore'
import { formatRole, inviteStatusColor, formatDateTime } from './shared'

// ==================================================================
// Create Invite Modal
// ==================================================================

const EDITABLE_ROLES: EditableRole[] = ['ADMIN', 'ANALYST', 'VIEWER']

function CreateInviteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (invite: TeamInvite, acceptUrl?: string) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<EditableRole>('VIEWER')
  const [expiresInHours, setExpiresInHours] = useState(72)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!email.trim()) {
      setError('البريد الإلكتروني مطلوب')
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await createInvite({
        email: email.trim(),
        role,
        expiresInHours,
      })
      onCreated(result.invite, result.email.acceptUrl)
    } catch (err) {
      setError(getTeamErrorMessage(err, 'فشل إرسال الدعوة'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#080d1a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <h3 className="font-semibold text-white">دعوة عضو جديد</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <Field label="البريد الإلكتروني">
            <TextInput
              type="email"
              icon={Mail}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving}
              placeholder="colleague@company.com"
              dir="ltr"
            />
          </Field>

          <Field label="الدور">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as EditableRole)}
              disabled={saving}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
            >
              {EDITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {formatRole(r)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="تنتهي خلال (ساعة)">
            <input
              type="number"
              min={1}
              max={720}
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(Number(e.target.value))}
              disabled={saving}
              className="w-full rounded-xl border border-white/10 bg-white/3 px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
            />
          </Field>

          {error && (
            <p className="text-xs text-rose-400">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/8 px-5 py-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            icon={Mail}
            loading={saving}
            onClick={() => void handleCreate()}
          >
            إرسال الدعوة
          </Button>
        </div>
      </div>
    </div>
  )
}

// ==================================================================
// Invite Created Toast (shows dev acceptUrl if present)
// ==================================================================

function InviteCreatedBanner({
  invite,
  acceptUrl,
  onClose,
}: {
  invite: TeamInvite
  acceptUrl?: string
  onClose: () => void
}) {
  return (
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/8 px-4 py-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="font-semibold text-emerald-300">
            تم إرسال الدعوة إلى {invite.email} ✓
          </p>
          {acceptUrl && (
            <div>
              <p className="text-xs text-slate-400">رابط القبول (dev only):</p>
              <a
                href={acceptUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-xs text-cyan-400 underline"
              >
                {acceptUrl}
              </a>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ==================================================================
// Invite Row
// ==================================================================

function InviteRow({
  invite,
  canManage,
  onResend,
  onRevoke,
}: {
  invite: TeamInvite
  canManage: boolean
  onResend: (id: string) => Promise<void>
  onRevoke: (id: string) => Promise<void>
}) {
  const [resending, setResending] = useState(false)
  const [revoking, setRevoking] = useState(false)

  return (
    <tr className="border-b border-white/5">
      <td className="px-4 py-3 font-mono text-sm text-slate-300">{invite.email}</td>
      <td className="px-4 py-3">
        <span className="text-xs text-slate-400">{formatRole(invite.role)}</span>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${inviteStatusColor(invite.status)}`}
        >
          {invite.status}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {formatDateTime(invite.expiresAt)}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {formatDateTime(invite.createdAt)}
      </td>
      <td className="px-4 py-3 text-end">
        {canManage && invite.status === 'PENDING' && (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              title="إعادة إرسال"
              disabled={resending}
              onClick={async () => {
                setResending(true)
                await onResend(invite.id)
                setResending(false)
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white/8 hover:text-cyan-400"
            >
              {resending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              title="إلغاء"
              disabled={revoking}
              onClick={async () => {
                setRevoking(true)
                await onRevoke(invite.id)
                setRevoking(false)
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
            >
              {revoking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

// ==================================================================
// Status filter tabs
// ==================================================================

const STATUS_TABS: { label: string; value: InviteStatus | '' }[] = [
  { label: 'الكل', value: '' },
  { label: 'معلّقة', value: 'PENDING' },
  { label: 'مقبولة', value: 'ACCEPTED' },
  { label: 'منتهية', value: 'EXPIRED' },
  { label: 'ملغاة', value: 'REVOKED' },
]

// ==================================================================
// Main: InvitesTab
// ==================================================================

export default function InvitesTab() {
  const { t } = useTranslation('team')
  const canManage = useAuthStore(selectHasPermission('team:manage'))

  const [invites, setInvites] = useState<TeamInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<InviteStatus | ''>('')
  const [showCreate, setShowCreate] = useState(false)
  const [createdBanner, setCreatedBanner] = useState<{ invite: TeamInvite; acceptUrl?: string } | null>(null)
  const LIMIT = 20

  const fetchInvites = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listInvites({
        status: statusFilter || undefined,
        page,
        limit: LIMIT,
      })
      setInvites(res.items)
      setTotal(res.total)
    } catch (err) {
      setError(getTeamErrorMessage(err, 'فشل تحميل الدعوات'))
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  useEffect(() => {
    void fetchInvites()
  }, [fetchInvites])

  useEffect(() => {
    setPage(1)
  }, [statusFilter])

  const handleResend = async (id: string) => {
    try {
      await resendInvite(id)
      void fetchInvites()
    } catch {
      // ignore
    }
  }

  const handleRevoke = async (id: string) => {
    try {
      await revokeInvite(id)
      void fetchInvites()
    } catch {
      // ignore
    }
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status tabs */}
        <div className="flex gap-1 rounded-xl border border-white/8 bg-white/2 p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === tab.value
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Clock className="h-4 w-4" />
          <span>{total} دعوة</span>
        </div>

        <button
          type="button"
          onClick={() => void fetchInvites()}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {canManage && (
          <Button
            variant="primary"
            icon={Plus}
            size="sm"
            onClick={() => setShowCreate(true)}
          >
            {t('invites.create', 'دعوة عضو')}
          </Button>
        )}
      </div>

      {/* Created banner */}
      {createdBanner && (
        <InviteCreatedBanner
          invite={createdBanner.invite}
          acceptUrl={createdBanner.acceptUrl}
          onClose={() => setCreatedBanner(null)}
        />
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/6 px-4 py-3 text-sm text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 text-xs text-slate-500">
              <th className="px-4 py-3 text-start font-medium">البريد الإلكتروني</th>
              <th className="px-4 py-3 text-start font-medium">الدور</th>
              <th className="px-4 py-3 text-start font-medium">الحالة</th>
              <th className="px-4 py-3 text-start font-medium">تنتهي في</th>
              <th className="px-4 py-3 text-start font-medium">أُرسلت في</th>
              <th className="px-4 py-3 text-end font-medium">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/5">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-full animate-pulse rounded-md bg-white/5" />
                      </td>
                    ))}
                  </tr>
                ))
              : invites.map((inv) => (
                  <InviteRow
                    key={inv.id}
                    invite={inv}
                    canManage={canManage}
                    onResend={handleResend}
                    onRevoke={handleRevoke}
                  />
                ))}
            {!loading && invites.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-slate-500">
                  لا توجد دعوات
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} من {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </button>
            <span className="px-2">{page} / {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            </button>
          </div>
        </div>
      )}

      {/* Create Invite Modal */}
      {showCreate && (
        <CreateInviteModal
          onClose={() => setShowCreate(false)}
          onCreated={(invite, acceptUrl) => {
            setShowCreate(false)
            setCreatedBanner({ invite, acceptUrl })
            void fetchInvites()
          }}
        />
      )}
    </div>
  )
}
