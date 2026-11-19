// frontend/src/pages/team/MembersTab.tsx
// ==================================================================
// تبويب الأعضاء — قائمة + بحث + تفاصيل + تعديل
// ==================================================================

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react'

import { useDebounce } from '../../hooks/useDebounce'
import { Button } from '../../components/ui/kit'
import {
  listMembers,
  getMember,
  updateMemberRole,
  deactivateMember,
  activateMember,
  getTeamErrorMessage,
  type TeamMember,
  type EditableRole,
} from '../../services/teamService'
import useAuthStore, { selectHasPermission } from '../../store/authStore'
import { formatRole, roleColor, statusColor, formatDateTime } from './shared'

// ==================================================================
// Role selector
// ==================================================================

const EDITABLE_ROLES: EditableRole[] = ['ADMIN', 'ANALYST', 'VIEWER']

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (r: EditableRole) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as EditableRole)}
      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
    >
      {EDITABLE_ROLES.map((r) => (
        <option key={r} value={r}>
          {formatRole(r)}
        </option>
      ))}
    </select>
  )
}

// ==================================================================
// Member Row
// ==================================================================

function MemberRow({
  member,
  canManage,
  currentUserId,
  onSelect,
  onChanged,
}: {
  member: TeamMember
  canManage: boolean
  currentUserId: string | null
  onSelect: (m: TeamMember) => void
  onChanged: () => void
}) {
  const { t } = useTranslation('team')
  const isSelf = member.id === currentUserId
  const isOwner = member.role === 'OWNER'

  return (
    <tr
      className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/3"
      onClick={() => onSelect(member)}
    >
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-white">
            {member.fullName || '—'}
            {isSelf && (
              <span className="ms-2 text-xs text-cyan-400">({t('members.you')})</span>
            )}
          </span>
          <span className="font-mono text-xs text-slate-500">{member.email}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold uppercase ${roleColor(member.role)}`}
        >
          {formatRole(member.role)}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(member.isActive)}`}
        >
          {member.isActive ? t('status.active') : t('status.inactive')}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {formatDateTime(member.lastLoginAt)}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {member.groups.slice(0, 2).map((g) => (
            <span
              key={g.id}
              className="rounded-md bg-white/5 px-1.5 py-0.5 text-xs text-slate-400"
            >
              {g.name}
            </span>
          ))}
          {member.groups.length > 2 && (
            <span className="text-xs text-slate-500">
              +{member.groups.length - 2}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-end" onClick={(e) => e.stopPropagation()}>
        {canManage && !isOwner && !isSelf && (
          <div className="flex items-center justify-end gap-2">
            {/* Quick activate/deactivate */}
            {member.isActive ? (
              <QuickDeactivate memberId={member.id} onDone={onChanged} />
            ) : (
              <QuickActivate memberId={member.id} onDone={onChanged} />
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

function QuickDeactivate({ memberId, onDone }: { memberId: string; onDone: () => void }) {
  const { t } = useTranslation('team')
  const [loading, setLoading] = useState(false)
  return (
    <button
      type="button"
      title={t('members.deactivate')}
      aria-label={t('members.deactivate')}
      disabled={loading}
      onClick={async () => {
        setLoading(true)
        try {
          await deactivateMember(memberId)
          onDone()
        } catch {
          // الخطأ يظهر عبر إعادة التحميل
        } finally {
          setLoading(false)
        }
      }}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <UserMinus className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

function QuickActivate({ memberId, onDone }: { memberId: string; onDone: () => void }) {
  const { t } = useTranslation('team')
  const [loading, setLoading] = useState(false)
  return (
    <button
      type="button"
      title={t('members.activate')}
      aria-label={t('members.activate')}
      disabled={loading}
      onClick={async () => {
        setLoading(true)
        try {
          await activateMember(memberId)
          onDone()
        } catch {
          // الخطأ يظهر عبر إعادة التحميل
        } finally {
          setLoading(false)
        }
      }}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-emerald-500/10 hover:text-emerald-400"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <UserCheck className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

// ==================================================================
// Member Detail Drawer
// ==================================================================

function MemberDrawer({
  member,
  canManage,
  currentUserId,
  onClose,
  onUpdated,
}: {
  member: TeamMember
  canManage: boolean
  currentUserId: string | null
  onClose: () => void
  onUpdated: () => void
}) {
  const { t } = useTranslation('team')
  const isOwner = member.role === 'OWNER'
  const isSelf = member.id === currentUserId

  const [roleValue, setRoleValue] = useState<EditableRole>(
    member.role === 'OWNER' ? 'VIEWER' : (member.role as EditableRole),
  )
  const [savingRole, setSavingRole] = useState(false)
  const [roleError, setRoleError] = useState('')
  const [activating, setActivating] = useState(false)

  const handleSaveRole = async () => {
    setSavingRole(true)
    setRoleError('')
    try {
      await updateMemberRole(member.id, roleValue)
      onUpdated()
    } catch (err) {
      setRoleError(getTeamErrorMessage(err, t('members.roleError')))
    } finally {
      setSavingRole(false)
    }
  }

  const handleToggleActive = async () => {
    setActivating(true)
    try {
      if (member.isActive) {
        await deactivateMember(member.id)
      } else {
        await activateMember(member.id)
      }
      onUpdated()
    } catch (err) {
      setRoleError(getTeamErrorMessage(err, t('members.toggleError')))
    } finally {
      setActivating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-sm flex-col border-s border-white/8 bg-[#070b14] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div>
            <p className="font-semibold text-white">{member.fullName || member.email}</p>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{member.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 p-5">
          {/* Status + Role badges */}
          <div className="flex flex-wrap gap-2">
            <span
              className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold uppercase ${roleColor(member.role)}`}
            >
              {formatRole(member.role)}
            </span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(member.isActive)}`}
            >
              {member.isActive ? t('status.active') : t('status.inactive')}
            </span>
          </div>

          {/* Change role */}
          {canManage && !isOwner && !isSelf && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400">{t('members.changeRole')}</p>
              <div className="flex items-center gap-2">
                <RoleSelect
                  value={roleValue}
                  onChange={setRoleValue}
                  disabled={savingRole}
                />
                <Button
                  size="sm"
                  variant="primary"
                  loading={savingRole}
                  onClick={() => void handleSaveRole()}
                  disabled={roleValue === member.role}
                >
                  {t('common.save')}
                </Button>
              </div>
              {roleError && (
                <p className="text-xs text-rose-400">{roleError}</p>
              )}
            </div>
          )}

          {/* Groups */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-400">{t('members.groups')}</p>
            {member.groups.length === 0 ? (
              <p className="text-xs text-slate-600">{t('members.noGroups')}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {member.groups.map((g) => (
                  <span
                    key={g.id}
                    className="rounded-lg border border-white/8 bg-white/4 px-2 py-1 text-xs text-slate-300"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Permissions preview */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-400">
              {t('members.finalPermissions', { count: member.permissions.length })}
            </p>
            <div className="flex flex-wrap gap-1">
              {member.permissions.slice(0, 20).map((p) => (
                <span
                  key={p}
                  className="rounded-md bg-indigo-500/8 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300"
                >
                  {p}
                </span>
              ))}
              {member.permissions.length > 20 && (
                <span className="text-xs text-slate-500">
                  {t('members.moreCount', { count: member.permissions.length - 20 })}
                </span>
              )}
            </div>
          </div>

          {/* Overrides */}
          {member.overrides.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400">{t('members.overrides')}</p>
              <div className="space-y-1">
                {member.overrides.map((o) => (
                  <div
                    key={o.permission}
                    className="flex items-center justify-between rounded-lg border border-white/6 bg-white/3 px-3 py-2"
                  >
                    <span className="font-mono text-xs text-slate-300">
                      {o.permission}
                    </span>
                    <span
                      className={`text-xs ${o.isDeny ? 'text-rose-400' : 'text-emerald-400'}`}
                    >
                      {o.isDeny ? t('members.deny') : t('members.grant')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info */}
          <div className="space-y-1 text-xs text-slate-500">
            <p>{t('members.lastLoginLabel')}: {formatDateTime(member.lastLoginAt)}</p>
            <p>{t('members.joinedAt')}: {formatDateTime(member.createdAt)}</p>
          </div>
        </div>

        {/* Footer actions */}
        {canManage && !isSelf && !isOwner && (
          <div className="border-t border-white/8 p-4">
            <Button
              variant={member.isActive ? 'danger' : 'success'}
              className="w-full"
              loading={activating}
              icon={member.isActive ? UserMinus : UserCheck}
              onClick={() => void handleToggleActive()}
            >
              {member.isActive ? t('members.deactivate') : t('members.activate')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ==================================================================
// Main: MembersTab
// ==================================================================

export default function MembersTab() {
  const { t } = useTranslation('team')
  const user = useAuthStore((s) => s.user)
  const canManage = useAuthStore(selectHasPermission('team:manage'))

  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const debouncedQ = useDebounce(q, 350)
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)
  const LIMIT = 20

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listMembers({ page, limit: LIMIT, q: debouncedQ || undefined })
      setMembers(res.items)
      setTotal(res.total)
    } catch (err) {
      setError(getTeamErrorMessage(err, t('members.loadError')))
    } finally {
      setLoading(false)
    }
  }, [page, debouncedQ])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  // Debounced search
  useEffect(() => {
    setPage(1)
  }, [debouncedQ])

  const handleSelectMember = async (m: TeamMember) => {
    try {
      const full = await getMember(m.id)
      setSelectedMember(full)
    } catch {
      setSelectedMember(m)
    }
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('members.search')}
            className="w-full rounded-xl border border-white/10 bg-white/3 py-2 ps-10 pe-4 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/40"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Users className="h-4 w-4" />
          <span>{t('members.count', { count: total })}</span>
        </div>
        <button
          type="button"
          onClick={() => void fetchMembers()}
          aria-label={t('common.refresh')}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

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
              <th className="px-4 py-3 text-start font-medium">{t('members.user')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('members.role')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('members.status')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('members.lastLogin')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('members.groups')}</th>
              <th className="px-4 py-3 text-end font-medium">{t('members.actions')}</th>
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
              : members.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    canManage={canManage}
                    currentUserId={user?.id ?? null}
                    onSelect={(mem) => void handleSelectMember(mem)}
                    onChanged={() => void fetchMembers()}
                  />
                ))}
            {!loading && members.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-slate-500">
                  {t('members.noResults')}
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
            {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} {t('common.of')} {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              aria-label={t('common.prev')}
              onClick={() => setPage((p) => p - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            </button>
            <span className="px-2">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              aria-label={t('common.next')}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </button>
          </div>
        </div>
      )}

      {/* Member Drawer */}
      {selectedMember && (
        <MemberDrawer
          member={selectedMember}
          canManage={canManage}
          currentUserId={user?.id ?? null}
          onClose={() => setSelectedMember(null)}
          onUpdated={() => {
            setSelectedMember(null)
            void fetchMembers()
          }}
        />
      )}
    </div>
  )
}
