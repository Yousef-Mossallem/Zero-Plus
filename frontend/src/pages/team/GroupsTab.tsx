// frontend/src/pages/team/GroupsTab.tsx
// ==================================================================
// تبويب مجموعات الصلاحيات — عرض / إنشاء / تعديل / حذف / إدارة الأعضاء
// كل الإجراءات مربوطة بـ teamService (API حقيقي)
// ==================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Layers,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react'

import { Button, EmptyState, ErrorState, Field, Modal, TextInput } from '../../components/ui/kit'
import { useDebounce } from '../../hooks/useDebounce'
import {
  addGroupMembers,
  createGroup,
  deleteGroup,
  getGroup,
  getPermissionsCatalog,
  getTeamErrorMessage,
  listGroups,
  listMembers,
  removeGroupMembers,
  updateGroup,
  type PermissionsCatalog,
  type TeamGroup,
  type TeamMember,
} from '../../services/teamService'
import useAuthStore, { selectHasPermission } from '../../store/authStore'
import { useNotice } from './Notice'
import Pager from './Pager'

const LIMIT = 20

// ==================================================================
// Permission multi-select (label حسب لغة الواجهة)
// ==================================================================

function PermissionSelector({
  catalog,
  selected,
  onChange,
  disabled,
}: {
  catalog: PermissionsCatalog
  selected: string[]
  onChange: (perms: string[]) => void
  disabled?: boolean
}) {
  const { i18n } = useTranslation('team')
  const isAr = i18n.language?.startsWith('ar')

  const toggle = (perm: string) =>
    onChange(selected.includes(perm) ? selected.filter((p) => p !== perm) : [...selected, perm])

  return (
    <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-white/8 bg-white/2 p-2">
      {catalog.permissions.map((p) => (
        <label
          key={p.id}
          className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${
            disabled ? 'opacity-50' : 'hover:bg-white/5'
          } ${selected.includes(p.id) ? 'bg-cyan-500/8' : ''}`}
        >
          <input
            type="checkbox"
            checked={selected.includes(p.id)}
            onChange={() => toggle(p.id)}
            disabled={disabled}
            className="h-3.5 w-3.5 rounded border-white/20 accent-cyan-400"
          />
          <div className="min-w-0">
            <p className="font-mono text-xs text-slate-300" dir="ltr">{p.id}</p>
            <p className="text-[11px] text-slate-500">{isAr ? p.ar : p.en}</p>
          </div>
        </label>
      ))}
    </div>
  )
}

// ==================================================================
// Group Form (Create / Edit)
// ==================================================================

function GroupForm({
  group,
  catalog,
  onClose,
  onSaved,
}: {
  group: TeamGroup | null
  catalog: PermissionsCatalog | null
  onClose: () => void
  onSaved: (isEdit: boolean) => void
}) {
  const { t } = useTranslation('team')
  const isEdit = group !== null
  const isSystem = group?.isSystem ?? false

  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [permissions, setPermissions] = useState<string[]>(group?.permissions ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!isSystem && !name.trim()) return setError(t('groups.nameRequired'))
    if (permissions.length === 0) return setError(t('groups.permsRequired'))

    setSaving(true)
    setError('')
    try {
      if (isEdit && group) {
        await updateGroup(group.id, {
          ...(isSystem ? {} : { name: name.trim() }),
          description: description.trim() || null,
          permissions,
        })
      } else {
        await createGroup({
          name: name.trim(),
          description: description.trim() || null,
          permissions,
        })
      }
      onSaved(isEdit)
    } catch (err) {
      setError(getTeamErrorMessage(err, t('groups.errors.save')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={saving ? () => undefined : onClose}
      title={isEdit ? t('groups.editTitle') : t('groups.createTitle')}
      icon={Layers}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('actions.cancel')}
          </Button>
          <Button variant="primary" loading={saving} disabled={!catalog} onClick={() => void handleSave()}>
            {isEdit ? t('groups.saveChanges') : t('groups.createBtn')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {isSystem ? (
          <div className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/6 px-4 py-3 text-xs text-amber-300">
            <Lock className="h-4 w-4 shrink-0" />
            <span>{t('groups.systemNote')}</span>
          </div>
        ) : (
          <Field label={t('groups.name')}>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder={t('groups.namePlaceholder')}
              maxLength={80}
            />
          </Field>
        )}

        <Field label={t('groups.description')}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
            rows={2}
            maxLength={500}
            placeholder={t('groups.descriptionPlaceholder')}
            className="w-full rounded-xl border border-white/10 bg-white/3 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-500/50 disabled:opacity-50"
          />
        </Field>

        <Field label={t('groups.permissionsSelected', { count: permissions.length })}>
          {catalog ? (
            <PermissionSelector
              catalog={catalog}
              selected={permissions}
              onChange={setPermissions}
              disabled={saving}
            />
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
            </div>
          )}
        </Field>

        {error && <p dir="auto" className="text-xs text-rose-400">{error}</p>}
      </div>
    </Modal>
  )
}

// ==================================================================
// Group Members modal (إضافة / إزالة أعضاء)
// ==================================================================

function GroupMembersModal({
  group,
  canManage,
  onClose,
  onChanged,
  notify,
}: {
  group: TeamGroup
  canManage: boolean
  onClose: () => void
  onChanged: () => void
  notify: (type: 'success' | 'error', text: string) => void
}) {
  const { t } = useTranslation('team')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const dq = useDebounce(q.trim(), 350)
  const [results, setResults] = useState<TeamMember[]>([])
  const [searching, setSearching] = useState(false)
  const reqId = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const g = await getGroup(group.id)
      setMembers(g.members)
    } catch (err) {
      setError(getTeamErrorMessage(err, t('groups.errors.members')))
    } finally {
      setLoading(false)
    }
  }, [group.id, t])

  useEffect(() => {
    void load()
  }, [load])

  // بحث عن مستخدمين للإضافة
  useEffect(() => {
    if (!canManage || dq.length < 2) {
      setResults([])
      return
    }
    const id = ++reqId.current
    setSearching(true)
    listMembers({ q: dq, limit: 8, isActive: true })
      .then((res) => {
        if (id === reqId.current) setResults(res.items)
      })
      .catch(() => {
        if (id === reqId.current) setResults([])
      })
      .finally(() => {
        if (id === reqId.current) setSearching(false)
      })
  }, [dq, canManage])

  const memberIds = new Set(members.map((m) => m.id))
  const addable = results.filter((r) => !memberIds.has(r.id))

  const add = async (m: TeamMember) => {
    setBusyId(m.id)
    try {
      await addGroupMembers(group.id, [m.id])
      notify('success', t('groups.notice.memberAdded'))
      setQ('')
      await load()
      onChanged()
    } catch (err) {
      notify('error', getTeamErrorMessage(err, t('groups.errors.addMember')))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (m: TeamMember) => {
    if (!window.confirm(t('groups.confirmRemoveMember', { name: m.fullName || m.email }))) return
    setBusyId(m.id)
    try {
      await removeGroupMembers(group.id, [m.id])
      notify('success', t('groups.notice.memberRemoved'))
      await load()
      onChanged()
    } catch (err) {
      notify('error', getTeamErrorMessage(err, t('groups.errors.removeMember')))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('groups.membersTitle', { name: group.name })}
      icon={Users}
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>{t('actions.close')}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {canManage && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('groups.searchUsers')}
                className="w-full rounded-xl border border-white/10 bg-white/3 py-2 ps-10 pe-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-500/40"
              />
            </div>
            {dq.length >= 2 && (
              <div className="rounded-xl border border-white/8 bg-white/2">
                {searching ? (
                  <p className="px-3 py-3 text-xs text-slate-500">{t('loading')}</p>
                ) : addable.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-slate-500">{t('members.noResults')}</p>
                ) : (
                  addable.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white">{m.fullName || '—'}</p>
                        <p className="truncate font-mono text-xs text-slate-500" dir="ltr">{m.email}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={UserPlus}
                        loading={busyId === m.id}
                        disabled={busyId !== null}
                        onClick={() => void add(m)}
                      >
                        {t('groups.addMember')}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-400">
            {t('groups.currentMembers', { count: members.length })}
          </p>
          {loading ? (
            <div className="h-16 animate-pulse rounded-xl bg-white/3" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : members.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">{t('groups.noMembers')}</p>
          ) : (
            <div className="divide-y divide-white/5 rounded-xl border border-white/8">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{m.fullName || '—'}</p>
                    <p className="truncate font-mono text-xs text-slate-500" dir="ltr">{m.email}</p>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      title={t('groups.removeMember')}
                      aria-label={t('groups.removeMember')}
                      disabled={busyId !== null}
                      onClick={() => void remove(m)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40"
                    >
                      {busyId === m.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserMinus className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ==================================================================
// Group Card
// ==================================================================

function GroupCard({
  group,
  canManage,
  deleting,
  onEdit,
  onDelete,
  onMembers,
}: {
  group: TeamGroup
  canManage: boolean
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
  onMembers: () => void
}) {
  const { t } = useTranslation('team')
  const perms = Array.isArray(group.permissions) ? group.permissions : []
  const iconBtn =
    'flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/8 hover:text-white'

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/2 p-4 transition-colors hover:border-white/12 hover:bg-white/4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-white">{group.name}</p>
            {group.isSystem && (
              <span className="rounded-md border border-amber-400/20 bg-amber-500/8 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                {t('groups.systemBadge')}
              </span>
            )}
          </div>
          {group.description && (
            <p dir="auto" className="mt-0.5 line-clamp-2 text-xs text-slate-500">{group.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={onMembers} className={iconBtn} title={t('groups.manageMembers')} aria-label={t('groups.manageMembers')}>
            <Users className="h-3.5 w-3.5" />
          </button>
          {canManage && (
            <>
              <button type="button" onClick={onEdit} className={iconBtn} title={t('groups.edit')} aria-label={t('groups.edit')}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {!group.isSystem && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={onDelete}
                  title={t('groups.delete')}
                  aria-label={t('groups.delete')}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1" dir="ltr">
        {perms.slice(0, 5).map((p) => (
          <span key={p} className="rounded-md bg-indigo-500/8 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
            {p}
          </span>
        ))}
        {perms.length > 5 && (
          <span className="text-[10px] text-slate-500">+{perms.length - 5}</span>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{t('groups.memberCount', { count: group.membersCount })}</span>
        <span>{t('groups.permCount', { count: perms.length })}</span>
      </div>
    </div>
  )
}

// ==================================================================
// Main: GroupsTab
// ==================================================================

export default function GroupsTab() {
  const { t } = useTranslation('team')
  const canManage = useAuthStore(selectHasPermission('team:manage'))
  const { show, node } = useNotice()

  const [groups, setGroups] = useState<TeamGroup[]>([])
  const [catalog, setCatalog] = useState<PermissionsCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const dq = useDebounce(q.trim(), 350)
  const [formGroup, setFormGroup] = useState<TeamGroup | null | undefined>(undefined) // undefined = مقفول
  const [membersGroup, setMembersGroup] = useState<TeamGroup | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchGroups = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listGroups({ page, limit: LIMIT, q: dq || undefined })
      setGroups(res.items)
      setTotal(res.total)
    } catch (err) {
      setError(getTeamErrorMessage(err, t('groups.errors.load')))
    } finally {
      setLoading(false)
    }
  }, [page, dq, t])

  useEffect(() => {
    void fetchGroups()
  }, [fetchGroups])

  useEffect(() => {
    setPage(1)
  }, [dq])

  // الكتالوج بيتحمل مرة واحدة (مش مع كل بحث)
  useEffect(() => {
    getPermissionsCatalog()
      .then(setCatalog)
      .catch((err) => show('error', getTeamErrorMessage(err, t('groups.errors.catalog'))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDelete = async (g: TeamGroup) => {
    if (!window.confirm(t('groups.confirmDeleteNamed', { name: g.name }))) return
    setDeletingId(g.id)
    try {
      await deleteGroup(g.id)
      show('success', t('groups.notice.deleted'))
      // لو كانت آخر عنصر في الصفحة ارجع صفحة
      if (groups.length === 1 && page > 1) setPage(page - 1)
      else await fetchGroups()
    } catch (err) {
      show('error', getTeamErrorMessage(err, t('groups.errors.delete')))
    } finally {
      setDeletingId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

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
            placeholder={t('groups.search')}
            className="w-full rounded-xl border border-white/10 bg-white/3 py-2 ps-10 pe-9 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-500/40"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label={t('actions.clear')}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Layers className="h-4 w-4" />
          <span>{t('groups.count', { count: total })}</span>
        </div>
        <button
          type="button"
          onClick={() => void fetchGroups()}
          aria-label={t('actions.refresh')}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {canManage && (
          <Button variant="primary" icon={Plus} size="sm" onClick={() => setFormGroup(null)}>
            {t('groups.create')}
          </Button>
        )}
      </div>

      {/* Body */}
      {error ? (
        <ErrorState message={error} onRetry={() => void fetchGroups()} />
      ) : loading && groups.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-white/3" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={Layers} title={q ? t('groups.noResults') : t('groups.noGroups')} />
      ) : (
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${loading ? 'opacity-60' : ''}`}>
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              canManage={canManage}
              deleting={deletingId === g.id}
              onEdit={() => setFormGroup(g)}
              onDelete={() => void handleDelete(g)}
              onMembers={() => setMembersGroup(g)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pager page={page} totalPages={totalPages} onPage={setPage} disabled={loading} />
        </div>
      )}

      {formGroup !== undefined && (
        <GroupForm
          group={formGroup}
          catalog={catalog}
          onClose={() => setFormGroup(undefined)}
          onSaved={(isEdit) => {
            setFormGroup(undefined)
            show('success', t(isEdit ? 'groups.notice.updated' : 'groups.notice.created'))
            void fetchGroups()
          }}
        />
      )}

      {membersGroup && (
        <GroupMembersModal
          group={membersGroup}
          canManage={canManage}
          onClose={() => setMembersGroup(null)}
          onChanged={() => void fetchGroups()}
          notify={show}
        />
      )}

      {node}
    </div>
  )
}
