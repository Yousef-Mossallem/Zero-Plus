// frontend/src/pages/ThreatIntelligencePage.tsx
// ==================================================================
// Zero Plus - Threat Intelligence Page
// صفحة Threat Intelligence (مربوطة بـ backend/modules/threat-intel)
//
//   GET /threat-intel/indicators → جلب مؤشرات الاختراق (IoCs) مع Filters
//   GET /threat-intel/actors     → جلب الجهات الفاعلة (Threat Actors)
//   GET /threat-intel/stats      → جلب الإحصائيات العامة للتهديدات
//   GET /threat-intel/export     → تصدير البيانات (CSV/JSON)
//
// مميزات الصفحة:
//   - عرض مؤشرات الاختراق (IPs, Domains, Hashes) مع مستوى الخطورة.
//   - عرض الجهات الفاعلة (Threat Actors) المعروفة التي تستهدف Organization.
//   - رسوم بيانية لتوزيع التهديدات حسب النوع وCountriesة.
//   - فلاتر متقدمة (النوع، الخطورة، Countriesة، Search النصي).
//   - أنيميشن سلس وتفاعلية عالية مع نسخ البيانات بنقرة واحدة.
// ==================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Bug,
  Copy,
  Download,
  Globe,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Skull,
  Target,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useToast } from '../components/ui/Toast'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  PaginationBar,
  SelectInput,
  Skeleton,
  StatCard,
  TextInput,
} from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import apiClient from '../services/api'
import type { ThreatCountry } from '../services/types'
import { cn, formatNumber, timeAgo } from '../utils/format'

// ==================================================================
// Types & Constants
// ==================================================================

// تعريف مستويات الخطورة
type ThreatSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

// تعريف أنواع التهديدات
type ThreatType = 'MALWARE' | 'PHISHING' | 'BOTNET' | 'APT' | 'SPAM' | 'SCANNER'

// تعريف نوع مؤشر الاختراق
type IndicatorType = 'IP' | 'DOMAIN' | 'HASH' | 'URL'

// واجهة مؤشر الاختراق (IoC)
interface ThreatIndicator {
  id: string
  value: string
  type: IndicatorType
  severity: ThreatSeverity
  threatType: ThreatType
  source: string
  country?: string
  firstSeen: string
  lastSeen: string
  hits: number
}

// واجهة الجهة الفاعلة (Threat Actor)
interface ThreatActor {
  id: string
  name: string
  aliases: string[]
  origin: string
  motivation: string
  sophistication: 'Low' | 'Medium' | 'High' | 'Advanced'
  activeSince: string
  targetedSectors: string[]
  indicatorsCount: number
}

// بيانات وصفية لمستويات الخطورة
const SEVERITY_META: Record<ThreatSeverity, { label: string; color: string; bg: string }> = {
  LOW: { label: 'منخفض', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  MEDIUM: { label: 'متوسط', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  HIGH: { label: 'عالي', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  CRITICAL: { label: 'حرج', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20' },
}

// بيانات وصفية لأنواع التهديدات
const THREAT_TYPE_META: Record<ThreatType, { label: string; icon: React.ElementType }> = {
  MALWARE: { label: 'برمجيات خبيثة', icon: Bug },
  PHISHING: { label: 'تصيد احتيالي', icon: Target },
  BOTNET: { label: 'شبكات بوت نت', icon: Globe },
  APT: { label: 'تهديدات متقدمة (APT)', icon: Skull },
  SPAM: { label: 'بريد مزعج', icon: AlertTriangle },
  SCANNER: { label: 'فاحصات ثغرات', icon: Search },
}

// ألوان الرسم البياني
const CHART_COLORS = ['#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#64748b']

const PAGE_SIZE = 15

// ==================================================================
// Page Component
// ==================================================================

export default function ThreatIntelligencePage() {
  const toast = useToast()

  // ---------------- State: التبويب النشط ----------------
  const [activeTab, setActiveTab] = useState<'indicators' | 'actors' | 'analytics'>('indicators')

  // ---------------- State: Filters ----------------
  const [filters, setFilters] = useState({
    search: '',
    severity: '',
    threatType: '',
    indicatorType: '',
  })

  // ---------------- State: البيانات ----------------
  const [indicators, setIndicators] = useState<ThreatIndicator[]>([])
  const [actors, setActors] = useState<ThreatActor[]>([])
  const [stats, setStats] = useState({
    totalIndicators: 0,
    activeActors: 0,
    blockedToday: 0,
    criticalAlerts: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1, page: 1 })

  // ---------------- Data Loading: جلب البيانات ----------------
  const loadData = useCallback(async (page: number = 1) => {
    setLoading(true)
    setError(null)
    try {
      // جلب الإحصائيات والجهات الفاعلة مرة واحدة
      const [statsRes, actorsRes] = await Promise.all([
        apiClient.get<{ stats: typeof stats }>('/threat-intel/stats'),
        apiClient.get<{ actors: ThreatActor[] }>('/threat-intel/actors'),
      ])
      setStats(statsRes.data.stats)
      setActors(actorsRes.data.actors)

      // جلب مؤشرات الاختراق مع Filters
      const params: any = { page, limit: PAGE_SIZE, sortBy: 'lastSeen', sortOrder: 'desc' }
      if (filters.search) params.search = filters.search
      if (filters.severity) params.severity = filters.severity
      if (filters.threatType) params.threatType = filters.threatType
      if (filters.indicatorType) params.indicatorType = filters.indicatorType

      const indRes = await apiClient.get<{ indicators: ThreatIndicator[]; total: number; totalPages: number }>(
        '/threat-intel/indicators',
        { params }
      )
      setIndicators(indRes.data.indicators)
      setPagination({ total: indRes.data.total, totalPages: indRes.data.totalPages, page })
    } catch (err) {
      const { message } = parseApiError(err)
      setError(message)
      toast.error('Load failed', 'تعذر جلب بيانات Threat Intelligence')
    } finally {
      setLoading(false)
    }
  }, [filters, toast])

  useEffect(() => {
    void loadData(1)
  }, [loadData])

  // ---------------- Handlers: معالجة التفاعNoت ----------------
  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPagination((prev) => ({ ...prev, page: 1 }))
  }

  const clearFilters = () => {
    setFilters({ search: '', severity: '', threatType: '', indicatorType: '' })
    setPagination((prev) => ({ ...prev, page: 1 }))
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('تم النسخ', `تم نسخ "${text}" إلى الحافظة`)
  }

  const handleExport = () => {
    toast.info('قيد التطوير', 'سيتم Add ميزة التصدير قريباً')
  }

  const hasActiveFilters = filters.search !== '' || filters.severity !== '' || filters.threatType !== '' || filters.indicatorType !== ''

  // ---------------- Derived Data: البيانات المحسوبة للرسوم البيانية ----------------
  const threatTypeDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    indicators.forEach((i) => {
      counts[i.threatType] = (counts[i.threatType] || 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name: THREAT_TYPE_META[name as ThreatType]?.label || name, value }))
  }, [indicators])

  const severityDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    indicators.forEach((i) => {
      counts[i.severity] = (counts[i.severity] || 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name: SEVERITY_META[name as ThreatSeverity]?.label || name, value }))
  }, [indicators])

  // ==================================================================
  // Render: واجهة المستخدم
  // ==================================================================

  return (
    <PageShell>
      {/* ---------- Header ---------- */}
      <PageHeader
        icon={ShieldAlert}
        title="Threat Intelligence"
        subtitle="Track IoCs and known threat actors targeting your network."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={Download} variant="ghost" onClick={handleExport}>
              تصدير
            </Button>
            <Button icon={RefreshCw} loading={loading} onClick={() => void loadData(pagination.page)}>
              Refresh
            </Button>
          </div>
        }
      />

      {/* ---------- Stats Overview ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
        <StatCard label="Total indicators" value={formatNumber(stats.totalIndicators)} icon={Target} tone="indigo" loading={loading} delay={0} />
        <StatCard label="Active actors" value={formatNumber(stats.activeActors)} icon={Skull} tone="rose" loading={loading} delay={60} />
        <StatCard label="Blocked threats today" value={formatNumber(stats.blockedToday)} icon={Shield} tone="emerald" loading={loading} delay={120} />
        <StatCard label="Critical alerts" value={formatNumber(stats.criticalAlerts)} icon={AlertTriangle} tone="amber" loading={loading} delay={180} />
      </div>

      {/* ---------- Tabs Switcher ---------- */}
      <div className="flex gap-1 rounded-xl bg-white/5 p-1 mb-6 w-fit">
        {[
          { id: 'indicators', label: 'مؤشرات الاختراق', icon: Target },
          { id: 'actors', label: 'الجهات الفاعلة', icon: Skull },
          { id: 'analytics', label: 'التحليNoت', icon: BarChart3 },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
              activeTab === tab.id
                ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---------- Error State ---------- */}
      {error && (activeTab === 'indicators' ? indicators.length === 0 : activeTab === 'actors' ? actors.length === 0 : false) ? (
        <Card>
          <ErrorState message={error} onRetry={() => void loadData(pagination.page)} />
        </Card>
      ) : loading && (activeTab === 'indicators' ? indicators.length === 0 : activeTab === 'actors' ? actors.length === 0 : false) ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* ==================================================================
              TAB 1: Indicators of Compromise (IoCs)
          ================================================================== */}
          {activeTab === 'indicators' && (
            <div className="space-y-6 zp-anim-fade-up">
              {/* Filters */}
              <Card className="p-4" delay={60}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <TextInput
                      icon={Search}
                      value={filters.search}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFilterChange('search', e.target.value)}
                      placeholder="بحث بعنوان IP، دومين، أو Hash..."
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex lg:shrink-0">
                    <SelectInput
                      value={filters.severity}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleFilterChange('severity', e.target.value)}
                      className="lg:w-40"
                    >
                      <option value="" className="bg-slate-900">كل مستويات الخطورة</option>
                      {Object.entries(SEVERITY_META).map(([key, meta]) => (
                        <option key={key} value={key} className="bg-slate-900">{meta.label}</option>
                      ))}
                    </SelectInput>
                    <SelectInput
                      value={filters.threatType}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleFilterChange('threatType', e.target.value)}
                      className="lg:w-44"
                    >
                      <option value="" className="bg-slate-900">كل أنواع التهديدات</option>
                      {Object.entries(THREAT_TYPE_META).map(([key, meta]) => (
                        <option key={key} value={key} className="bg-slate-900">{meta.label}</option>
                      ))}
                    </SelectInput>
                    <SelectInput
                      value={filters.indicatorType}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleFilterChange('indicatorType', e.target.value)}
                      className="lg:w-40"
                    >
                      <option value="" className="bg-slate-900">كل أنواع المؤشرات</option>
                      <option value="IP" className="bg-slate-900">عنوان IP</option>
                      <option value="DOMAIN" className="bg-slate-900">دومين</option>
                      <option value="HASH" className="bg-slate-900">Hash</option>
                      <option value="URL" className="bg-slate-900">رابط URL</option>
                    </SelectInput>
                  </div>
                  {hasActiveFilters && (
                    <Button icon={X} variant="ghost" onClick={clearFilters} className="shrink-0">
                      Clear
                    </Button>
                  )}
                </div>
              </Card>

              {/* Indicators List */}
              {indicators.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={Target}
                    title={hasActiveFilters ? 'No توجد مؤشرات مطابقة' : 'No توجد مؤشرات اختراق حالياً'}
                    description={hasActiveFilters ? 'جرب تغيير Filters أو Clearها.' : 'لم يتم رصد أي مؤشرات اختراق تستهدف شبكتك خNoل الفترة الحالية.'}
                    action={hasActiveFilters ? <Button icon={X} onClick={clearFilters}>Clear Filters</Button> : undefined}
                  />
                </Card>
              ) : (
                <div className="space-y-2">
                  {indicators.map((indicator, index) => (
                    <IndicatorRow
                      key={indicator.id}
                      indicator={indicator}
                      index={index}
                      onCopy={() => copyToClipboard(indicator.value)}
                    />
                  ))}
                </div>
              )}

              {/* Pagination */}
              {!loading && indicators.length > 0 && pagination.totalPages > 1 && (
                <Card className="mt-4">
                  <PaginationBar
                    page={pagination.page}
                    totalPages={pagination.totalPages}
                    total={pagination.total}
                    limit={PAGE_SIZE}
                    disabled={loading}
                    onPage={(newPage) => void loadData(newPage)}
                  />
                </Card>
              )}
            </div>
          )}

          {/* ==================================================================
              TAB 2: Threat Actors
          ================================================================== */}
          {activeTab === 'actors' && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 zp-anim-fade-up">
              {actors.length === 0 ? (
                <div className="col-span-full">
                  <Card>
                    <EmptyState icon={Skull} title="No توجد جهات فاعلة معروفة" description="لم يتم رصد أي مجموعات اختراق تستهدف Organization حالياً." />
                  </Card>
                </div>
              ) : (
                actors.map((actor, index) => (
                  <ActorCard key={actor.id} actor={actor} index={index} />
                ))
              )}
            </div>
          )}

          {/* ==================================================================
              TAB 3: Analytics & Charts
          ================================================================== */}
          {activeTab === 'analytics' && (
            <div className="grid gap-6 lg:grid-cols-2 zp-anim-fade-up">
              {/* Threat Type Distribution */}
              <Card className="p-6" delay={0}>
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Bug className="h-5 w-5 text-cyan-400" />
                  توزيع التهديدات حسب النوع
                </h3>
                {threatTypeDistribution.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-sm text-slate-500">No توجد بيانات كافية</div>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={threatTypeDistribution} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis type="number" stroke="#64748b" fontSize={10} />
                        <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={10} width={100} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {threatTypeDistribution.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>

              {/* Severity Distribution */}
              <Card className="p-6" delay={60}>
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-rose-400" />
                  توزيع مؤشرات الاختراق حسب الخطورة
                </h3>
                {severityDistribution.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-sm text-slate-500">No توجد بيانات كافية</div>
                ) : (
                  <div className="h-72 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={severityDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {severityDistribution.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute right-8 top-1/2 -translate-y-1/2 space-y-2">
                      {severityDistribution.map((entry, index) => (
                        <div key={entry.name} className="flex items-center gap-2 text-xs">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                          <span className="text-slate-300">{entry.name}: <strong className="text-white">{entry.value}</strong></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}

// ==================================================================
// Sub-Components: مكونات فرعية
// ==================================================================

/**
 * مكون صف مؤشر الاختراق (IoC Row)
 */
function IndicatorRow({ indicator, index, onCopy }: { indicator: ThreatIndicator; index: number; onCopy: () => void }) {
  const severityMeta = SEVERITY_META[indicator.severity]
  const typeMeta = THREAT_TYPE_META[indicator.threatType]
  const TypeIcon = typeMeta.icon

  return (
    <div
      className="zp-anim-fade-up group flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-4 transition-all hover:border-white/15 hover:bg-white/5 sm:flex-row sm:items-center sm:justify-between"
      style={{ animationDelay: `${Math.min(index * 30, 200)}ms` }}
    >
      <div className="flex items-start gap-4 flex-1">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', severityMeta.bg)}>
          <TypeIcon className={cn('h-5 w-5', severityMeta.color)} />
        </div>
        
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-white truncate" title={indicator.value}>
              {indicator.value}
            </span>
            <button
              onClick={onCopy}
              className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-cyan-400 transition-colors"
              title="نسخ"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', severityMeta.bg, severityMeta.color)}>
              {severityMeta.label}
            </span>
          </div>
          
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
              {indicator.type}
            </span>
            <span>•</span>
            <span>{typeMeta.label}</span>
            {indicator.country && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {indicator.country}
                </span>
              </>
            )}
            <span>•</span>
            <span>المصدر: {indicator.source}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 sm:border-r sm:border-white/8 sm:pr-4 sm:flex-col sm:items-end">
        <div className="text-right">
          <p className="text-[10px] uppercase text-slate-500">آخر رصد</p>
          <p className="text-xs font-medium text-white">{timeAgo(indicator.lastSeen)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase text-slate-500">عدد الضربات</p>
          <p className="text-xs font-medium text-rose-400">{formatNumber(indicator.hits)}</p>
        </div>
      </div>
    </div>
  )
}

/**
 * مكون بطاقة الجهة الفاعلة (Threat Actor Card)
 */
function ActorCard({ actor, index }: { actor: ThreatActor; index: number }) {
  return (
    <div
      className="zp-anim-fade-up rounded-2xl border border-white/8 bg-white/3 p-5 transition-all hover:border-rose-500/20 hover:bg-white/5"
      style={{ animationDelay: `${Math.min(index * 50, 300)}ms` }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <Skull className="h-6 w-6" />
        </div>
        <span className="rounded-full bg-slate-500/10 px-2.5 py-1 text-[10px] font-medium text-slate-300 border border-slate-500/20">
          {actor.sophistication}
        </span>
      </div>

      <h3 className="text-lg font-bold text-white mb-1">{actor.name}</h3>
      {actor.aliases.length > 0 && (
        <p className="text-xs text-slate-500 mb-3">يعرف أيضاً بـ: {actor.aliases.join(', ')}</p>
      )}

      <div className="space-y-2 text-xs text-slate-400 mb-4">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-slate-500" />
          <span>المنشأ: <span className="text-slate-200">{actor.origin}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Target className="h-3.5 w-3.5 text-slate-500" />
          <span>الدافع: <span className="text-slate-200">{actor.motivation}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-slate-500" />
          <span>نشط منذ: <span className="text-slate-200">{actor.activeSince}</span></span>
        </div>
      </div>

      <div className="border-t border-white/6 pt-3">
        <p className="text-[10px] uppercase text-slate-500 mb-2">القطاعات المستهدفة</p>
        <div className="flex flex-wrap gap-1.5">
          {actor.targetedSectors.slice(0, 3).map((sector) => (
            <span key={sector} className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
              {sector}
            </span>
          ))}
          {actor.targetedSectors.length > 3 && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
              +{actor.targetedSectors.length - 3}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg bg-rose-500/5 border border-rose-500/10 px-3 py-2">
        <span className="text-xs text-rose-200">مؤشرات مرتبطة</span>
        <span className="text-sm font-bold text-rose-400">{formatNumber(actor.indicatorsCount)}</span>
      </div>
    </div>
  )
}