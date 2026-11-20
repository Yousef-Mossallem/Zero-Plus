// frontend/src/pages/team/InvitesTab.tsx
// ==================================================================
// تبويب الدعوات — قائمة + إنشاء + إعادة إرسال + إلغاء
// ==================================================================

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react'

import { Button, EmptyState, ErrorState, Field, Modal, TextInput } from '../../components/ui/kit'
import {
  listGroups,
  listInvites,
  createInvite,
  resendInvite,
  revokeInvite,
  getTeamErrorMessage,
  type TeamGroup,
  type TeamInvite,
  type InviteStatus,
  type EditableRole,
} from '../../services/teamService'
import { selectHasPermission } from '../../store/authStore'
import useAuthStore from '../../store/authStore'
import { useNotice } from './Notice'
import Pager from './Pager'
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
  const { t } = useTranslation('team')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<EditableRole>('VIEWER')
  const [expiresInHours, setExpiresInHours] = useState(72)
  const [groups, setGroups] = useState<TeamGroup[]>([])
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listGroups({ limit: 100 })
      .then((r) => setGroups(r.items))
      .catch(() => undefined) // المجموعات اختيارية — الدعوة تشتغل من غيرها
  }, [])

  const handleCreate = async () => {
    const value = email.trim()
    if (!value) return setError(t('invites.emailRequired'))
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setError(t('invites.emailInvalid'))
    if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) {
      return setError(t('invites.expiresInvalid'))
    }
    setSaving(true)
    setError('')
    try {
      const result = await createInvite({
        email: value,
        role,
        expiresInHours,
        ...(groupIds.length > 0 ? { initialGroupIds: groupIds } : {}),
      })
      onCreated(result.invite, result.email.acceptUrl)
    } catch (err) {
      setError(getTeamErrorMessage(err, t('invites.errors.send')))
    } finally {
      setSaving(false)
    }
  }

  const selectCls =
    'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500/50 disabled:opacity-50 [&>option]:bg-[#0b1224]'

  return (
    <Modal
      open
      onClose={saving ? () => undefined : onClose}
      title={t('invites.newTitle')}
      icon={Mail}
      width="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('actions.cancel')}
          </Button>
          <Button variant="primary" icon={Mail} loading={saving} onClick={() => void handleCreate()}>
            {t('invites.send')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t('invites.email')}>
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

        <Field label={t('invites.role')}>
          <select value={role} onChange={(e) => setRole(e.target.value as EditableRole)} disabled={saving} className={selectCls}>
            {EDITABLE_ROLES.map((r) => (
              <option key={r} value={r}>{formatRole(r)}</option>
            ))}
          </select>
        </Field>

        <Field label={t('invites.initialGroups')} hint={t('invites.initialGroupsHint')}>
          {groups.length === 0 ? (
            <p className="text-xs text-slate-600">{t('invites.noGroups')}</p>
          ) : (
            <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-white/8 bg-white/2 p-1.5">
              {groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-white/5">
                  <input
                    type="checkbox"
                    disabled={saving}
                    checked={groupIds.includes(g.id)}
                    onChange={() => setGroupIds((ids) => (ids.includes(g.id) ? ids.filter((x) => x !== g.id) : [...ids, g.id]))}
                    className="h-3.5 w-3.5 accent-cyan-400"
                  />
                  <span className="text-sm text-slate-300">{g.name}</span>
                </label>
              ))}
            </div>
          )}
        </Field>

        <Field label={t('invites.expiresHours')} hint={t('invites.expiresHint')}>
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

        {error && <p dir="auto" className="text-xs text-rose-400">{error}</p>}
      </div>
    </Modal>
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
  const { t } = useTranslation('team')
  return (
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/8 px-4 py-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="font-semibold text-emerald-300">
            {t('invites.sentTo', { email: invite.email })} ✓
          </p>
          {acceptUrl && (
            <div>
              <p className="text-xs text-slate-400">{t('invites.acceptLink')}</p>
              <a
                href={acceptUrl}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="block break-all font-mono text-xs text-cyan-400 underline"
              >
                {acceptUrl}
              </a>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('actions.close')}
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

const INVITE_STATUS_KEY = {
  PENDING: 'status.pending',
  ACCEPTED: 'status.accepted',
  EXPIRED: 'status.expired',
  REVOKED: 'status.revoked',
} as const

function InviteRow({
  invite,
  canManage,
  onResend,
  onRevoke,
}: {
  invite: TeamInvite
  canManage: boolean
  onResend: (inv: TeamInvite) => Promise<void>
  onRevoke: (inv: TeamInvite) => Promise<void>
}) {
  const { t } = useTranslation('team')
  const [resending, setResending] = useState(false)
  const [revoking, setRevoking] = useState(false)

  return (
    <tr className="border-b border-white/5">
      <td className="px-4 py-3 font-mono text-sm text-slate-300" dir="ltr">{invite.email}</td>
      <td className="px-4 py-3">
        <span className="text-xs text-slate-400">{formatRole(invite.role)}</span>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${inviteStatusColor(invite.status)}`}
        >
          {t(INVITE_STATUS_KEY[invite.status])}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
        {formatDateTime(invite.expiresAt)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
        {formatDateTime(invite.createdAt)}
      </td>
      <td className="px-4 py-3 text-end">
        {canManage && invite.status === 'PENDING' && (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              title={t('invites.resend')}
              aria-label={t('invites.resend')}
              disabled={resending}
              onClick={async () => {
                setResending(true)
                await onResend(invite)
                setResending(false)
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/8 hover:text-cyan-400 disabled:opacity-50"
            >
              {resending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              title={t('invites.revoke')}
              aria-label={t('invites.revoke')}
              disabled={revoking}
              onClick={async () => {
                setRevoking(true)
                await onRevoke(invite)
                setRevoking(false)
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
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

type StatusTabKey =
  | 'invites.tabs.all'
  | 'invites.tabs.pending'
  | 'invites.tabs.accepted'
  | 'invites.tabs.expired'
  | 'invites.tabs.revoked'

const STATUS_TABS: { label: StatusTabKey; value: InviteStatus | '' }[] = [
  { label: 'invites.tabs.all', value: '' },
  { label: 'invites.tabs.pending', value: 'PENDING' },
  { label: 'invites.tabs.accepted', value: 'ACCEPTED' },
  { label: 'invites.tabs.expired', value: 'EXPIRED' },
  { label: 'invites.tabs.revoked', value: 'REVOKED' },
]

// ==================================================================
// Main: InvitesTab
// ==================================================================

export default function InvitesTab() {
  const { t } = useTranslation('team')
  const canManage = useAuthStore(selectHasPermission('team:manage'))
  const { show, node } = useNotice()

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
      setError(getTeamErrorMessage(err, t('invites.errors.load')))
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, t])

  useEffect(() => {
    void fetchInvites()
  }, [fetchInvites])

  useEffect(() => {
    setPage(1)
  }, [statusFilter])

  const handleResend = async (inv: TeamInvite) => {
    try {
      await resendInvite(inv.id)
      show('success', t('invites.notice.resent', { email: inv.email }))
      await fetchInvites()
    } catch (err) {
      show('error', getTeamErrorMessage(err, t('invites.errors.resend')))
    }
  }

  const handleRevoke = async (inv: TeamInvite) => {
    if (!window.confirm(t('invites.confirmRevoke', { email: inv.email }))) return
    try {
      await revokeInvite(inv.id)
      show('success', t('invites.notice.revoked'))
      await fetchInvites()
    } catch (err) {
      show('error', getTeamErrorMessage(err, t('invites.errors.revoke')))
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status tabs */}
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/8 bg-white/2 p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === tab.value
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Clock className="h-4 w-4" />
          <span>{t('invites.count', { count: total })}</span>
        </div>

        <button
          type="button"
          onClick={() => void fetchInvites()}
          aria-label={t('actions.refresh')}
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
            {t('invites.create')}
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

      {error && <ErrorState message={error} onRetry={() => void fetchInvites()} />}

      {/* Table */}
      {!error && (
      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 text-xs text-slate-500">
              <th className="px-4 py-3 text-start font-medium">{t('invites.cols.email')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('invites.cols.role')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('invites.cols.status')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('invites.cols.expiresAt')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('invites.cols.sentAt')}</th>
              <th className="px-4 py-3 text-end font-medium">{t('invites.cols.actions')}</th>
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
                <td colSpan={6}>
                  <EmptyState icon={Mail} title={t('invites.empty')} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {total > 0 && !error && (
        <div className="flex flex-col items-center justify-between gap-2 text-xs text-slate-500 sm:flex-row">
          <span>
            {t('invites.range', { from: (page - 1) * LIMIT + 1, to: Math.min(page * LIMIT, total), total })}
          </span>
          {totalPages > 1 && <Pager page={page} totalPages={totalPages} onPage={setPage} disabled={loading} />}
        </div>
      )}

      {/* Create Invite Modal */}
      {showCreate && (
        <CreateInviteModal
          onClose={() => setShowCreate(false)}
          onCreated={(invite, acceptUrl) => {
            setShowCreate(false)
            setCreatedBanner({ invite, acceptUrl })
            show('success', t('invites.notice.created'))
            void fetchInvites()
          }}
        />
      )}

      {node}
    </div>
  )
}
