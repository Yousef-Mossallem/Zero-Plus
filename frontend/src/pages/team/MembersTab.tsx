// frontend/src/pages/team/MembersTab.tsx
// ==================================================================
// تبويب الأعضاء — قائمة + بحث + فلترة + Drawer (دور / مجموعات / استثناءات / تفعيل)
// كل الإجراءات مربوطة بـ teamService، والبيانات بتتحدّث بعد النجاح بدون reload.
// ==================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, RefreshCw, Search, Trash2, UserCheck, UserMinus, Users, X } from 'lucide-react'

import { Button, EmptyState, ErrorState } from '../../components/ui/kit'
import { useDebounce } from '../../hooks/useDebounce'
import {
  activateMember,
  deactivateMember,
  deleteMemberOverride,
  getMember,
  getPermissionsCatalog,
  getTeamErrorMessage,
  listGroups,
  listMembers,
  patchMemberOverride,
  setMemberGroups,
  updateMemberRole,
  type EditableRole,
  type PermissionsCatalog,
  type TeamGroup,
  type TeamMember,
  type TeamRole,
} from '../../services/teamService'
import useAuthStore, { selectHasPermission } from '../../store/authStore'
import { useNotice } from './Notice'
import Pager from './Pager'
import { formatDateTime, formatRole, roleColor, statusColor } from './shared'

const LIMIT = 20
const EDITABLE_ROLES: EditableRole[] = ['ADMIN', 'ANALYST', 'VIEWER']
const FILTER_ROLES: TeamRole[] = ['OWNER', 'ADMIN', 'ANALYST', 'VIEWER']

type Notify = (type: 'success' | 'error', text: string) => void

const selectCls =
  'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 disabled:opacity-50 [&>option]:bg-[#0b1224]'

// ==================================================================
// Row
// ==================================================================

function MemberRow({
  member,
  canManage,
  currentUserId,
  busy,
  onSelect,
  onToggle,
}: {
  member: TeamMember
  canManage: boolean
  currentUserId: string | null
  busy: boolean
  onSelect: (m: TeamMember) => void
  onToggle: (m: TeamMember) => void
}) {
  const { t } = useTranslation('team')
  const isSelf = member.id === currentUserId
  const canToggle = canManage && member.role !== 'OWNER' && !isSelf
  const groups = Array.isArray(member.groups) ? member.groups : []

  return (
    <tr
      className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/3"
      onClick={() => onSelect(member)}
    >
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-white">
            {member.fullName || '—'}
            {isSelf && <span className="ms-2 text-xs text-cyan-400">({t('members.you')})</span>}
          </span>
          <span className="font-mono text-xs text-slate-500" dir="ltr">{member.email}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold uppercase ${roleColor(member.role)}`}>
          {formatRole(member.role)}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(member.isActive)}`}>
          {member.isActive ? t('status.active') : t('status.inactive')}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatDateTime(member.lastLoginAt)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {groups.slice(0, 2).map((g) => (
            <span key={g.id} className="rounded-md bg-white/5 px-1.5 py-0.5 text-xs text-slate-400">{g.name}</span>
          ))}
          {groups.length > 2 && <span className="text-xs text-slate-500">+{groups.length - 2}</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-end" onClick={(e) => e.stopPropagation()}>
        {canToggle && (
          <button
            type="button"
            title={member.isActive ? t('members.deactivate') : t('members.activate')}
            aria-label={member.isActive ? t('members.deactivate') : t('members.activate')}
            disabled={busy}
            onClick={() => onToggle(member)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 disabled:opacity-50 ${
              member.isActive ? 'hover:bg-rose-500/10 hover:text-rose-400' : 'hover:bg-emerald-500/10 hover:text-emerald-400'
            }`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : member.isActive ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
          </button>
        )}
      </td>
    </tr>
  )
}

// ==================================================================
// Mobile card (بديل للجدول على الشاشات الصغيرة)
// ==================================================================

function MemberCard({
  member,
  canManage,
  currentUserId,
  busy,
  onSelect,
  onToggle,
}: {
  member: TeamMember
  canManage: boolean
  currentUserId: string | null
  busy: boolean
  onSelect: (m: TeamMember) => void
  onToggle: (m: TeamMember) => void
}) {
  const { t } = useTranslation('team')
  const isSelf = member.id === currentUserId
  const canToggle = canManage && member.role !== 'OWNER' && !isSelf
  const groups = Array.isArray(member.groups) ? member.groups : []
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(member)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(member)}
      className="rounded-xl border border-white/8 bg-white/2 p-3.5 active:bg-white/4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">
            {member.fullName || '—'}
            {isSelf && <span className="ms-2 text-xs text-cyan-400">({t('members.you')})</span>}
          </p>
          <p className="truncate font-mono text-xs text-slate-500" dir="ltr">{member.email}</p>
        </div>
        {canToggle && (
          <button
            type="button"
            disabled={busy}
            aria-label={member.isActive ? t('members.deactivate') : t('members.activate')}
            onClick={(e) => { e.stopPropagation(); onToggle(member) }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : member.isActive ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
          </button>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase ${roleColor(member.role)}`}>{formatRole(member.role)}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusColor(member.isActive)}`}>
          {member.isActive ? t('status.active') : t('status.inactive')}
        </span>
        {groups.slice(0, 2).map((g) => (
          <span key={g.id} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-400">{g.name}</span>
        ))}
        {groups.length > 2 && <span className="text-[11px] text-slate-500">+{groups.length - 2}</span>}
      </div>
    </div>
  )
}

// ==================================================================
// Drawer
// ==================================================================

function MemberDrawer({
  member,
  canManage,
  currentUserId,
  allGroups,
  catalog,
  onClose,
  onMemberChanged,
  notify,
}: {
  member: TeamMember
  canManage: boolean
  currentUserId: string | null
  allGroups: TeamGroup[]
  catalog: PermissionsCatalog | null
  onClose: () => void
  onMemberChanged: (m: TeamMember | null) => void // null = اعمل reload للقائمة والـ drawer
  notify: Notify
}) {
  const { t, i18n } = useTranslation('team')
  const isAr = i18n.language?.startsWith('ar')
  // Defensive defaults so .length / .map never crash if a partial payload slips through
  const groups = Array.isArray(member.groups) ? member.groups : []
  const overrides = Array.isArray(member.overrides) ? member.overrides : []
  const permissions = Array.isArray(member.permissions) ? member.permissions : []
  const isOwner = member.role === 'OWNER'
  const isSelf = member.id === currentUserId
  const canEdit = canManage && !isOwner && !isSelf

  const [roleValue, setRoleValue] = useState<EditableRole>(
    EDITABLE_ROLES.includes(member.role as EditableRole) ? (member.role as EditableRole) : 'VIEWER',
  )
  const [groupIds, setGroupIds] = useState<string[]>(() => groups.map((g) => g.id))
  const [ovPerm, setOvPerm] = useState('')
  const [ovDeny, setOvDeny] = useState(false)
  const [busy, setBusy] = useState<'role' | 'groups' | 'override' | 'toggle' | null>(null)
  const [error, setError] = useState('')

  const initialGroups = groups.map((g) => g.id).sort().join(',')
  const groupsDirty = [...groupIds].sort().join(',') !== initialGroups

  const run = async (
    key: 'role' | 'groups' | 'override' | 'toggle',
    fn: () => Promise<TeamMember | void>,
    okMsg: string,
    failMsg: string,
  ) => {
    setBusy(key)
    setError('')
    try {
      const updated = await fn()
      notify('success', okMsg)
      onMemberChanged(updated ?? null)
    } catch (err) {
      const msg = getTeamErrorMessage(err, failMsg)
      setError(msg)
      notify('error', msg)
    } finally {
      setBusy(null)
    }
  }

  const toggleActive = () => {
    const name = member.fullName || member.email
    const msg = member.isActive ? t('members.confirmDeactivate', { name }) : t('members.confirmActivate', { name })
    if (!window.confirm(msg)) return
    void run(
      'toggle',
      () => (member.isActive ? deactivateMember(member.id) : activateMember(member.id)),
      member.isActive ? t('members.notice.deactivated') : t('members.notice.activated'),
      t('members.errors.toggle'),
    )
  }

  const saveRole = () => {
    if (!window.confirm(t('members.confirmRole', { role: formatRole(roleValue) }))) return
    void run('role', () => updateMemberRole(member.id, roleValue), t('members.notice.roleChanged'), t('members.errors.changeRole'))
  }

  const addOverride = () => {
    if (!ovPerm) return
    void run(
      'override',
      () => patchMemberOverride(member.id, { permission: ovPerm, isDeny: ovDeny }),
      t('members.notice.overrideSaved'),
      t('members.errors.override'),
    ).then(() => setOvPerm(''))
  }

  const removeOverride = (permission: string) => {
    if (!window.confirm(t('members.confirmRemoveOverride', { permission }))) return
    void run('override', () => deleteMemberOverride(member.id, permission), t('members.notice.overrideRemoved'), t('members.errors.override'))
  }

  const usedPerms = new Set(overrides.map((o) => o.permission))
  const availablePerms = (catalog?.permissions ?? []).filter((p) => !usedPerms.has(p.id))

  const label = 'text-xs font-medium text-slate-400'

  return (
    <div className="fixed inset-0 z-60 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-dvh w-full max-w-md flex-col border-s border-white/8 bg-[#070b14] shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/8 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-semibold text-white">{member.fullName || member.email}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-slate-500" dir="ltr">{member.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('actions.close')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold uppercase ${roleColor(member.role)}`}>
              {formatRole(member.role)}
            </span>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(member.isActive)}`}>
              {member.isActive ? t('status.active') : t('status.inactive')}
            </span>
          </div>

          {error && <p dir="auto" className="rounded-lg border border-rose-500/20 bg-rose-500/6 px-3 py-2 text-xs text-rose-300">{error}</p>}

          {/* Role */}
          {canEdit && (
            <div className="space-y-2">
              <p className={label}>{t('members.changeRole')}</p>
              <div className="flex items-center gap-2">
                <select value={roleValue} disabled={busy !== null} onChange={(e) => setRoleValue(e.target.value as EditableRole)} className={selectCls}>
                  {EDITABLE_ROLES.map((r) => <option key={r} value={r}>{formatRole(r)}</option>)}
                </select>
                <Button size="sm" variant="primary" loading={busy === 'role'} disabled={busy !== null || roleValue === member.role} onClick={saveRole}>
                  {t('members.save')}
                </Button>
              </div>
            </div>
          )}

          {/* Groups */}
          <div className="space-y-2">
            <p className={label}>{t('members.groups')}</p>
            {canEdit ? (
              <>
                {allGroups.length === 0 ? (
                  <p className="text-xs text-slate-600">{t('members.noGroupsAvailable')}</p>
                ) : (
                  <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-white/8 bg-white/2 p-1.5">
                    {allGroups.map((g) => (
                      <label key={g.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-white/5">
                        <input
                          type="checkbox"
                          disabled={busy !== null}
                          checked={groupIds.includes(g.id)}
                          onChange={() => setGroupIds((ids) => (ids.includes(g.id) ? ids.filter((x) => x !== g.id) : [...ids, g.id]))}
                          className="h-3.5 w-3.5 accent-cyan-400"
                        />
                        <span className="text-sm text-slate-300">{g.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === 'groups'}
                  disabled={busy !== null || !groupsDirty}
                  onClick={() => void run('groups', () => setMemberGroups(member.id, groupIds), t('members.notice.groupsSaved'), t('members.errors.groups'))}
                >
                  {t('members.saveGroups')}
                </Button>
              </>
            ) : groups.length === 0 ? (
              <p className="text-xs text-slate-600">{t('members.noGroups')}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => (
                  <span key={g.id} className="rounded-lg border border-white/8 bg-white/4 px-2 py-1 text-xs text-slate-300">{g.name}</span>
                ))}
              </div>
            )}
          </div>

          {/* Effective permissions */}
          <div className="space-y-2">
            <p className={label}>{t('members.effectivePermissions', { count: permissions.length })}</p>
            <div className="flex flex-wrap gap-1" dir="ltr">
              {permissions.slice(0, 20).map((p) => (
                <span key={p} className="rounded-md bg-indigo-500/8 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">{p}</span>
              ))}
              {permissions.length > 20 && (
                <span className="text-xs text-slate-500">{t('members.morePermissions', { count: permissions.length - 20 })}</span>
              )}
            </div>
          </div>

          {/* Overrides */}
          <div className="space-y-2">
            <p className={label}>{t('members.overrides')}</p>
            {overrides.length === 0 && <p className="text-xs text-slate-600">{t('members.noOverrides')}</p>}
            <div className="space-y-1">
              {overrides.map((o) => (
                <div key={o.permission} className="flex items-center justify-between gap-2 rounded-lg border border-white/6 bg-white/3 px-3 py-2">
                  <span className="min-w-0 truncate font-mono text-xs text-slate-300" dir="ltr">{o.permission}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`text-xs ${o.isDeny ? 'text-rose-400' : 'text-emerald-400'}`}>{o.isDeny ? t('members.deny') : t('members.grant')}</span>
                    {canEdit && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        aria-label={t('members.removeOverride')}
                        title={t('members.removeOverride')}
                        onClick={() => removeOverride(o.permission)}
                        className="text-slate-500 hover:text-rose-400 disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <select value={ovPerm} disabled={busy !== null} onChange={(e) => setOvPerm(e.target.value)} className={`${selectCls} min-w-0 flex-1 py-1.5 text-xs`}>
                  <option value="">{t('members.selectPermission')}</option>
                  {availablePerms.map((p) => <option key={p.id} value={p.id}>{p.id} — {isAr ? p.ar : p.en}</option>)}
                </select>
                <select value={ovDeny ? 'deny' : 'grant'} disabled={busy !== null} onChange={(e) => setOvDeny(e.target.value === 'deny')} className={`${selectCls} py-1.5 text-xs`}>
                  <option value="grant">{t('members.grant')}</option>
                  <option value="deny">{t('members.deny')}</option>
                </select>
                <Button size="sm" variant="outline" icon={Plus} loading={busy === 'override'} disabled={busy !== null || !ovPerm} onClick={addOverride}>
                  {t('members.addOverride')}
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1 text-xs text-slate-500">
            <p>{t('members.lastLogin')}: {formatDateTime(member.lastLoginAt)}</p>
            <p>{t('members.joinedAt')}: {formatDateTime(member.createdAt)}</p>
          </div>
        </div>

        {canEdit && (
          <div className="shrink-0 border-t border-white/8 p-4">
            <Button
              variant={member.isActive ? 'danger' : 'success'}
              className="w-full"
              loading={busy === 'toggle'}
              disabled={busy !== null}
              icon={member.isActive ? UserMinus : UserCheck}
              onClick={toggleActive}
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
// Main
// ==================================================================

export default function MembersTab() {
  const { t } = useTranslation('team')
  const user = useAuthStore((s) => s.user)
  const canManage = useAuthStore(selectHasPermission('team:manage'))
  const { show, node } = useNotice()

  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const dq = useDebounce(q.trim(), 350)
  const [roleFilter, setRoleFilter] = useState<TeamRole | ''>('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('')
  const [groupFilter, setGroupFilter] = useState('')

  const [allGroups, setAllGroups] = useState<TeamGroup[]>([])
  const [catalog, setCatalog] = useState<PermissionsCatalog | null>(null)
  const [selected, setSelected] = useState<TeamMember | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const openReq = useRef(0)

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listMembers({
        page,
        limit: LIMIT,
        q: dq || undefined,
        role: roleFilter || undefined,
        groupId: groupFilter || undefined,
        isActive: statusFilter === '' ? undefined : statusFilter === 'active',
      })
      setMembers(res.items)
      setTotal(res.total)
    } catch (err) {
      setError(getTeamErrorMessage(err, t('members.errors.load')))
    } finally {
      setLoading(false)
    }
  }, [page, dq, roleFilter, groupFilter, statusFilter, t])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  useEffect(() => {
    setPage(1)
  }, [dq, roleFilter, groupFilter, statusFilter])

  // مجموعات + كتالوج مرة واحدة (للفلتر والـ Drawer)
  useEffect(() => {
    listGroups({ limit: 100 }).then((r) => setAllGroups(r.items)).catch(() => undefined)
    if (canManage) getPermissionsCatalog().then(setCatalog).catch(() => undefined)
  }, [canManage])

  // الـ Drawer مش بيتفتح غير بعد ما بيانات العضو الكاملة توصل
  const openMember = async (m: TeamMember) => {
    const id = ++openReq.current
    setOpeningId(m.id)
    try {
      const full = await getMember(m.id)
      if (id === openReq.current) setSelected(full)
    } catch (err) {
      if (id === openReq.current) show('error', getTeamErrorMessage(err, t('members.errors.loadMember')))
    } finally {
      if (id === openReq.current) setOpeningId(null)
    }
  }

  const toggleFromRow = async (m: TeamMember) => {
    const name = m.fullName || m.email
    if (!window.confirm(m.isActive ? t('members.confirmDeactivate', { name }) : t('members.confirmActivate', { name }))) return
    setTogglingId(m.id)
    try {
      if (m.isActive) await deactivateMember(m.id)
      else await activateMember(m.id)
      show('success', m.isActive ? t('members.notice.deactivated') : t('members.notice.activated'))
      await fetchMembers()
    } catch (err) {
      show('error', getTeamErrorMessage(err, t('members.errors.toggle')))
    } finally {
      setTogglingId(null)
    }
  }

  // بعد أي تعديل من الـ Drawer: لو الـ API رجّع العضو المحدّث نستخدمه، وإلا نعيد تحميله
  const handleMemberChanged = async (updated: TeamMember | null) => {
    if (!selected) return
    try {
      setSelected(updated ?? (await getMember(selected.id)))
    } catch {
      setSelected(null)
    }
    await fetchMembers()
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT))
  const hasFilters = Boolean(q || roleFilter || statusFilter || groupFilter)
  const clearFilters = () => { setQ(''); setRoleFilter(''); setStatusFilter(''); setGroupFilter('') }
  const currentUserId = user?.id ?? null
  const rowProps = (m: TeamMember) => ({
    member: m,
    canManage,
    currentUserId,
    busy: togglingId === m.id || openingId === m.id,
    onSelect: (x: TeamMember) => void openMember(x),
    onToggle: (x: TeamMember) => void toggleFromRow(x),
  })

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-50 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('members.search')}
            className="w-full rounded-xl border border-white/10 bg-white/3 py-2 ps-10 pe-9 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-500/40"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label={t('actions.clear')} className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as TeamRole | '')} className={selectCls} aria-label={t('members.cols.role')}>
          <option value="">{t('members.allRoles')}</option>
          {FILTER_ROLES.map((r) => <option key={r} value={r}>{formatRole(r)}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | 'active' | 'inactive')} className={selectCls} aria-label={t('members.cols.status')}>
          <option value="">{t('members.allStatuses')}</option>
          <option value="active">{t('status.active')}</option>
          <option value="inactive">{t('status.inactive')}</option>
        </select>
        {allGroups.length > 0 && (
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className={selectCls} aria-label={t('members.cols.groups')}>
            <option value="">{t('members.allGroups')}</option>
            {allGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Users className="h-4 w-4" />
          <span>{t('members.count', { count: total })}</span>
        </div>
        <button
          type="button"
          onClick={() => void fetchMembers()}
          aria-label={t('actions.refresh')}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void fetchMembers()} />
      ) : loading && members.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/3" />)}
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? t('members.noResults') : t('members.noMembers')}
          action={hasFilters ? <Button size="sm" onClick={clearFilters}>{t('members.clearFilters')}</Button> : undefined}
        />
      ) : (
        <>
          {/* Mobile: cards */}
          <div className={`space-y-2 md:hidden ${loading ? 'opacity-60' : ''}`}>
            {members.map((m) => <MemberCard key={m.id} {...rowProps(m)} />)}
          </div>
          {/* Desktop: table */}
          <div className={`hidden overflow-x-auto rounded-xl border border-white/8 md:block ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/8 text-xs text-slate-500">
                  <th className="px-4 py-3 text-start font-medium">{t('members.cols.user')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('members.cols.role')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('members.cols.status')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('members.cols.lastLogin')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('members.cols.groups')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('members.cols.actions')}</th>
                </tr>
              </thead>
              <tbody>{members.map((m) => <MemberRow key={m.id} {...rowProps(m)} />)}</tbody>
            </table>
          </div>
        </>
      )}

      {total > 0 && (
        <div className="flex flex-col items-center justify-between gap-2 text-xs text-slate-500 sm:flex-row">
          <span>{t('members.range', { from: (page - 1) * LIMIT + 1, to: Math.min(page * LIMIT, total), total })}</span>
          {totalPages > 1 && <Pager page={page} totalPages={totalPages} onPage={setPage} disabled={loading} />}
        </div>
      )}

      {selected && (
        <MemberDrawer
          key={selected.id}
          member={selected}
          canManage={canManage}
          currentUserId={currentUserId}
          allGroups={allGroups}
          catalog={catalog}
          onClose={() => setSelected(null)}
          onMemberChanged={(m) => void handleMemberChanged(m)}
          notify={show}
        />
      )}

      {node}
    </div>
  )
}
