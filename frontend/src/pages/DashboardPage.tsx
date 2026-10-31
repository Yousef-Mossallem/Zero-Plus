// frontend/src/pages/DashboardPage.tsx
// ==================================================================
// Zero Plus - Dashboard Page (قراءة فقط)
// مربوطة بـ backend/modules/dashboard:
//   overview • timeline • top • servers • threat-map
// الأدوار: OWNER / ADMIN / ANALYST (الـ VIEWER بيرجع 403 فنعرض رسالة صلاحيات)
// التحميل والتحديث (كل 45 ثانية) في hooks: dashboard/useDashboardData.ts
// الأقسام في فولدر dashboard/ (كل قسم له loading/error/empty لوحده)
// ==================================================================

import { useEffect, useState } from 'react'
import { LayoutDashboard, Lock, RefreshCw } from 'lucide-react'

import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  PageShell,
  SelectInput,
} from '../components/ui/kit'
import type { DashboardRange, TopBy } from '../services/dashboardService'
import { listServers, type Server } from '../services/serversService'
import { cn } from '../utils/format'
import OverviewSection, { SurgeBanner } from './dashboard/OverviewSection'
import ServersPanel from './dashboard/ServersPanel'
import ThreatMap from './dashboard/ThreatMap'
import TimelineChart from './dashboard/TimelineChart'
import TopPanel from './dashboard/TopPanel'
import { useDashboardData } from './dashboard/useDashboardData'

const RANGES: Array<{ value: DashboardRange; label: string }> = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
]

export default function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>('24h')
  const [serverId, setServerId] = useState('')
  const [topBy, setTopBy] = useState<TopBy>('ip')
  const [serverOptions, setServerOptions] = useState<Server[]>([])

  const { overview, timeline, servers, threat, top, forbidden, updatedAt, refresh } = useDashboardData(
    range,
    serverId,
    topBy,
  )

  // قايمة السيرفرات للفلتر (اختيارية: لو فشلت الصفحة تشتغل من غيرها)
  useEffect(() => {
    listServers({ limit: 100, sortBy: 'domain', sortOrder: 'asc' })
      .then((res) => setServerOptions(res.data))
      .catch(() => {})
  }, [])

  const refreshing = overview.loading || timeline.loading

  return (
    <PageShell>
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        subtitle="Live overview of traffic, threats and server health for your organization."
        actions={
          <>
            {/* اختيار الفترة */}
            <div className="flex rounded-xl border border-white/10 bg-white/3 p-1">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRange(r.value)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-semibold',
                    range === r.value ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400 hover:text-white',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <SelectInput value={serverId} onChange={(e) => setServerId(e.target.value)} className="w-44">
              <option value="">All servers</option>
              {serverOptions.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#0b1224]">
                  {s.domain}
                </option>
              ))}
            </SelectInput>

            <Button variant="outline" icon={RefreshCw} loading={refreshing && Boolean(overview.data)} onClick={refresh}>
              Refresh
            </Button>
          </>
        }
      />

      {forbidden ? (
        <Card>
          <EmptyState
            icon={Lock}
            title="You don't have access to the dashboard"
            description="The dashboard is available to Owners, Admins and Analysts. Ask an Owner to change your role."
          />
        </Card>
      ) : (
        <>
          <SurgeBanner data={overview.data} />
          <OverviewSection section={overview} />

          <TimelineChart section={timeline} range={range} onRetry={refresh} />

          <div className="grid gap-6 xl:grid-cols-2">
            <TopPanel section={top} by={topBy} onBy={setTopBy} onRetry={refresh} />
            <ServersPanel section={servers} onRetry={refresh} />
          </div>

          <ThreatMap section={threat} onRetry={refresh} />

          {updatedAt && (
            <p className="text-center text-xs text-slate-600">
              Updated {updatedAt.toLocaleTimeString('en-GB')} · refreshes every 45 seconds
            </p>
          )}
        </>
      )}
    </PageShell>
  )
}
