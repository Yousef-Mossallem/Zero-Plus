// frontend/src/pages/team/GroupsTab.tsx
// ==================================================================
// تبويب مجموعات الصلاحيات
// ==================================================================

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Layers,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  X,
} from 'lucide-react'

import { useDebounce } from '../../hooks/useDebounce'
import { Button, Field, TextInput } from '../../components/ui/kit'
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  getPermissionsCatalog,
  getTeamErrorMessage,
  type TeamGroup,
  type PermissionsCatalog,
} from '../../services/teamService'
import useAuthStore, { selectHasPermission } from '../../store/authStore'
import { permLabel } from './shared'

// ==================================================================
// Permission multi-select
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
  const toggle = (perm: string) => {
    if (selected.includes(perm)) {
      onChange(selected.filter((p) => p !== perm))
    } else {
      onChange([...selected, perm])
    }
  }

  return (
    <div className="max-h-48 overflow-y-auto rounded-xl border border-white/8 bg-white/2 p-2 space-y-1">
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
            <p className="font-mono text-xs text-slate-300">{p.id}</p>
            <p className="text-[10px] text-slate-500">{permLabel(p)}</p>
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
  catalog: PermissionsCatalog
  onClose: () => void
  onSaved: () => void
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
    if (!isSystem && !name.trim()) {
      setError(t('groups.nameRequired'))
      return
    }
    if (permissions.length === 0) {
      setError(t('groups.permRequired'))
      return
    }

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
      onSaved()
    } catch (err) {
      setError(getTeamErrorMessage(err, t('groups.saveError')))
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
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#080d1a] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <h3 className="font-semibold text-white">
            {isEdit ? t('groups.editTitle') : t('groups.newTitle')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Name */}
          {!isSystem && (
            <Field label={t('groups.name')}>
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                placeholder={t('groups.namePlaceholder')}
                maxLength={100}
              />
            </Field>
          )}
          {isSystem && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/6 px-4 py-3 text-xs text-amber-300">
              <Lock className="h-4 w-4 shrink-0" />
              <span>{t('groups.systemGroup')}</span>
            </div>
          )}

          {/* Description */}
          <Field label={t('groups.description')}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              rows={2}
              placeholder={t('groups.descPlaceholder')}
              className="w-full rounded-xl border border-white/10 bg-white/3 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50 disabled:opacity-50"
            />
          </Field>

          {/* Permissions */}
          <Field
            label={t('groups.permissionsSelected', { count: permissions.length })}
          >
            <PermissionSelector
              catalog={catalog}
              selected={permissions}
              onChange={setPermissions}
              disabled={saving}
            />
          </Field>

          {error && (
            <p className="text-xs text-rose-400">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/8 px-5 py-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void handleSave()}>
            {isEdit ? t('common.saveChanges') : t('common.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ==================================================================
// Group Card
// ==================================================================

function GroupCard({
  group,
  canManage,
  onEdit,
  onDelete,
}: {
  group: TeamGroup
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('team')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm(t('groups.confirmDelete'))) return
    setDeleting(true)
    try {
      await deleteGroup(group.id)
      onDelete()
    } catch (err) {
      alert(getTeamErrorMessage(err, t('groups.deleteError')))
      setDeleting(false)
    }
  }

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-white/8 bg-white/2 p-4 transition-colors hover:border-white/12 hover:bg-white/4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-white truncate">{group.name}</p>
            {group.isSystem && (
              <span className="rounded-md border border-amber-400/20 bg-amber-500/8 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                {t('groups.system')}
              </span>
            )}
          </div>
          {group.description && (
            <p className="mt-0.5 text-xs text-slate-500 truncate">{group.description}</p>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
            <button
              type="button"
              title={t('groups.edit')}
              aria-label={t('groups.edit')}
              onClick={onEdit}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white/8 hover:text-white"
            >
              <Shield className="h-3.5 w-3.5" />
            </button>
            {!group.isSystem && (
              <button
                type="button"
                disabled={deleting}
                title={t('groups.delete')}
                aria-label={t('groups.delete')}
                onClick={() => void handleDelete()}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {group.permissions.slice(0, 5).map((p) => (
          <span
            key={p}
            className="rounded-md bg-indigo-500/8 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300"
          >
            {p}
          </span>
        ))}
        {group.permissions.length > 5 && (
          <span className="text-[10px] text-slate-500">
            +{group.permissions.length - 5}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{t('groups.membersCount', { count: group.membersCount })}</span>
        <span>{t('groups.permCount', { count: group.permissions.length })}</span>
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

  const [groups, setGroups] = useState<TeamGroup[]>([])
  const [catalog, setCatalog] = useState<PermissionsCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const debouncedQ = useDebounce(q, 350)
  const [showForm, setShowForm] = useState(false)
  const [editGroup, setEditGroup] = useState<TeamGroup | null>(null)
  const LIMIT = 20

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [groupsRes, catalogRes] = await Promise.all([
        listGroups({ page, limit: LIMIT, q: debouncedQ || undefined }),
        getPermissionsCatalog(),
      ])
      setGroups(groupsRes.items)
      setTotal(groupsRes.total)
      setCatalog(catalogRes)
    } catch (err) {
      setError(getTeamErrorMessage(err, t('groups.loadError')))
    } finally {
      setLoading(false)
    }
  }, [page, debouncedQ])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    setPage(1)
  }, [debouncedQ])

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
            placeholder={t('groups.search')}
            className="w-full rounded-xl border border-white/10 bg-white/3 py-2 ps-10 pe-4 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/40"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Layers className="h-4 w-4" />
          <span>{t('groups.count', { count: total })}</span>
        </div>
        <button
          type="button"
          onClick={() => void fetchData()}
          aria-label={t('common.refresh')}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {canManage && (
          <Button
            variant="primary"
            icon={Plus}
            size="sm"
            onClick={() => { setEditGroup(null); setShowForm(true) }}
          >
            {t('groups.create')}
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/6 px-4 py-3 text-sm text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl bg-white/3"
            />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500">
          {t('groups.noGroups')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              canManage={canManage}
              onEdit={() => { setEditGroup(g); setShowForm(true) }}
              onDelete={() => void fetchData()}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            aria-label={t('common.prev')}
            onClick={() => setPage((p) => p - 1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          </button>
          <span className="px-3 text-xs text-slate-500">{page} / {totalPages}</span>
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
      )}

      {/* Group Form Modal */}
      {showForm && catalog && (
        <GroupForm
          group={editGroup}
          catalog={catalog}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            void fetchData()
          }}
        />
      )}
    </div>
  )
}
