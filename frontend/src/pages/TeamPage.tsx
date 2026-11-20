// frontend/src/pages/TeamPage.tsx
// ==================================================================
// Zero Plus - Team Management Page
// محمية بـ team:view — ويحتاج team:manage للتعديل
// ==================================================================

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, Mail, Shield, Users } from 'lucide-react'

import Navbar from '../components/Navbar'
import useAuthStore, {
  selectHasPermission,
  selectIsAuthenticated,
} from '../store/authStore'
import MembersTab from './team/MembersTab'
import GroupsTab from './team/GroupsTab'
import InvitesTab from './team/InvitesTab'

// ==================================================================
// Tab definitions
// ==================================================================

type TabId = 'members' | 'groups' | 'invites'

const TABS: { id: TabId; labelKey: 'tabs.members' | 'tabs.groups' | 'tabs.invites'; icon: React.ElementType }[] = [
  { id: 'members', labelKey: 'tabs.members', icon: Users },
  { id: 'groups', labelKey: 'tabs.groups', icon: Layers },
  { id: 'invites', labelKey: 'tabs.invites', icon: Mail },
]

// ==================================================================
// Page
// ==================================================================

export default function TeamPage() {
  const { t } = useTranslation('team')
  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const canView = useAuthStore(selectHasPermission('team:view'))

  const [activeTab, setActiveTab] = useState<TabId>('members')

  // ProtectedRoute handles redirect if not authenticated
  // But check permission here
  if (!canView && isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col bg-[#05070f]">
        <Navbar />
        <main className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Shield className="mx-auto mb-3 h-10 w-10 text-slate-600" />
            <p className="text-sm text-slate-500">
              {t('errors.noPermission')}
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#05070f]">
      <Navbar />

      <main className="flex-1 px-4 pb-10 pt-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          {/* Page header */}
          <div className="mb-6">
            <h1 className="text-xl font-bold text-white">
              {t('title')}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {t('subtitle')}
            </p>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-white/8 bg-white/2 p-1">
            {TABS.map(({ id, labelKey, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  activeTab === id
                    ? 'bg-cyan-500/20 text-cyan-300 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t(labelKey)}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'members' && <MembersTab />}
          {activeTab === 'groups' && <GroupsTab />}
          {activeTab === 'invites' && <InvitesTab />}
        </div>
      </main>
    </div>
  )
}
