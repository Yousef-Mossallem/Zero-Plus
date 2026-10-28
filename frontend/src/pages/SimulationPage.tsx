// frontend/src/pages/SimulationPage.tsx
// ==================================================================
// Zero Plus - Simulation Page
// صفحة Attack simulation (مربوطة بـ backend/modules/simulation)
//
//   POST /simulation/start   → بدء محاكاة هجوم على سيرفر محدد
//   POST /simulation/stop    → إيقاف المحاكاة الجارية
//   GET  /simulation/metrics → جلب المقاييس الأولية
//   GET  /simulation/logs    → جلب سجNoت الهجمات المحاكاة
//
// Socket: 'simulation:metrics' → Refresh المقاييس والرسوم البيانية لحظياً
// Socket: 'simulation:log'     → Add سجNoت الهجمات الجديدة فوراً
//
// مميزات الصفحة:
//   - اختيار السيرفر المستهدف ونوع الهجوم (SQLi, XSS, DDoS, etc.).
//   - التحكم في شدة الهجوم (Intensity) ومدة المحاكاة.
//   - مراقبة لحظية للطلبات الAllowedة والBlockedة عبر رسم بياني.
//   - جدول سجNoت يعرض تفاصيل كل طلب تم اعتراضه.
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Bug,
  Clock,
  Crosshair,
  Flame,
  Play,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
  Square,
  Target,
  Zap,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
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
  PageHeader,
  PageShell,
  SelectInput,
  Skeleton,
  TextInput,
} from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import apiClient from '../services/api'
import { getSocket, SocketEvents } from '../services/socket'
import type { Server as ServerType } from '../services/types'
import { cn, formatNumber, timeAgo } from '../utils/format'

// ==================================================================
// Types & Constants
// ==================================================================

// تعريف أنواع الهجمات المدعومة في المحاكاة
type AttackType = 'SQL_INJECTION' | 'XSS' | 'DDOS' | 'PATH_TRAVERSAL' | 'BRUTE_FORCE' | 'BOT'

// تعريف شدة الهجوم
type IntensityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

// حالة المحاكاة
type SimulationStatus = 'IDLE' | 'RUNNING' | 'STOPPED' | 'ERROR'

// تعريف المقاييس اللحظية
interface SimulationMetrics {
  timestamp: string
  totalRequests: number
  blockedRequests: number
  allowedRequests: number
  avgLatency: number
}

// تعريف سجل الهجوم
interface SimulationLog {
  id: string
  timestamp: string
  attackType: AttackType
  sourceIp: string
  path: string
  payload: string
  action: 'BLOCKED' | 'ALLOWED' | 'CHALLENGED'
  riskScore: number
}

// بيانات وصفية لأنواع الهجمات
const ATTACK_TYPES: { value: AttackType; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'SQL_INJECTION', label: 'حقن SQL', icon: Bug, description: 'محاولة حقن أوامر SQL خبيثة في حقول الإدخال.' },
  { value: 'XSS', label: 'برمجة عبر المواقع (XSS)', icon: Crosshair, description: 'حقن سكريبتات خبيثة لعرضها في متصفح الضحية.' },
  { value: 'DDOS', label: 'هجوم حجب الخدمة (DDoS)', icon: Flame, description: 'إغراق السيرفر بطلبات وهمية Noستنزاف موارده.' },
  { value: 'PATH_TRAVERSAL', label: 'تجاوز المسار', icon: Target, description: 'محاولة الوصول إلى ملفات حساسة خارج المجلد العام.' },
  { value: 'BRUTE_FORCE', label: 'هجوم القوة الغاشمة', icon: Zap, description: 'محاولة تخمين كلمات المرور عبر محاولات متعددة.' },
  { value: 'BOT', label: 'بوتات ضارة', icon: Activity, description: 'محاكاة سلوك البوتات الآلية التي تفحص الثغرات.' },
]

// بيانات وصفية لشدة الهجوم
const INTENSITY_LEVELS: { value: IntensityLevel; label: string; color: string; rps: string }[] = [
  { value: 'LOW', label: 'منخفضة', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', rps: '~10 req/s' },
  { value: 'MEDIUM', label: 'متوسطة', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', rps: '~100 req/s' },
  { value: 'HIGH', label: 'عالية', color: 'text-orange-400 bg-orange-500/10 border-orange-500/20', rps: '~1000 req/s' },
  { value: 'CRITICAL', label: 'حرجة', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20', rps: '~10000 req/s' },
]

// ==================================================================
// Page Component
// ==================================================================

export default function SimulationPage() {
  const toast = useToast()

  // ---------------- State: الإعدادات ----------------
  const [servers, setServers] = useState<ServerType[]>([])
  const [selectedServerId, setSelectedServerId] = useState('')
  const [selectedAttack, setSelectedAttack] = useState<AttackType>('SQL_INJECTION')
  const [intensity, setIntensity] = useState<IntensityLevel>('MEDIUM')
  const [duration, setDuration] = useState('60') // بالثواني

  // ---------------- State: المحاكاة ----------------
  const [status, setStatus] = useState<SimulationStatus>('IDLE')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [metrics, setMetrics] = useState<SimulationMetrics[]>([])
  const [logs, setLogs] = useState<SimulationLog[]>([])
  const [currentStats, setCurrentStats] = useState({ total: 0, blocked: 0, allowed: 0 })

  // مرجع لمنع التكرار في السجNoت
  const logIdsRef = useRef<Set<string>>(new Set())

  // ==================================================================
  // Data Loading: جلب البيانات الأولية
  // ==================================================================

  const loadInitialData = useCallback(async () => {
    setLoading(true)
    try {
      // جلب قائمة Servers المتاحة للمحاكاة
      const [serversRes, metricsRes, logsRes] = await Promise.all([
        apiClient.get<{ servers: ServerType[] }>('/servers?limit=50'),
        apiClient.get<{ metrics: SimulationMetrics[] }>('/simulation/metrics').catch(() => ({ data: { metrics: [] } })),
        apiClient.get<{ logs: SimulationLog[] }>('/simulation/logs?limit=50').catch(() => ({ data: { logs: [] } })),
      ])

      setServers(serversRes.data.servers)
      if (serversRes.data.servers.length > 0 && !selectedServerId) {
        setSelectedServerId(serversRes.data.servers[0].id)
      }

      setMetrics(metricsRes.data.metrics)
      setLogs(logsRes.data.logs)
      logsRes.data.logs.forEach((l) => logIdsRef.current.add(l.id))
    } catch (err) {
      toast.error('Load failed', parseApiError(err).message)
    } finally {
      setLoading(false)
    }
  }, [selectedServerId, toast])

  useEffect(() => {
    void loadInitialData()
  }, [loadInitialData])

  // ==================================================================
  // Socket Integration: الاستماع للأحداث اللحظية
  // ==================================================================

  useEffect(() => {
    if (status !== 'RUNNING') return

    const socket = getSocket()

    const handleMetrics = (newMetric: SimulationMetrics) => {
      setMetrics((prev) => [...prev.slice(-50), newMetric]) // الاحتفاظ بآخر 50 نقطة
      setCurrentStats((prev) => ({
        total: prev.total + (newMetric.totalRequests - (prev.total || 0)), // تبسيط للعرض
        blocked: newMetric.blockedRequests,
        allowed: newMetric.allowedRequests,
      }))
    }

    const handleLog = (newLog: SimulationLog) => {
      if (logIdsRef.current.has(newLog.id)) return
      logIdsRef.current.add(newLog.id)
      setLogs((prev) => [newLog, ...prev].slice(0, 100)) // حد أقصى 100 سجل
    }

    socket.on('simulation:metrics', handleMetrics)
    socket.on('simulation:log', handleLog)

    return () => {
      socket.off('simulation:metrics', handleMetrics)
      socket.off('simulation:log', handleLog)
    }
  }, [status])

  // ==================================================================
  // Handlers: معالجة التفاعNoت
  // ==================================================================

  const handleStart = async () => {
    if (!selectedServerId) {
      toast.error('Error', 'يرجى اختيار سيرفر مستهدف')
      return
    }
    setActionLoading(true)
    try {
      await apiClient.post('/simulation/start', {
        serverId: selectedServerId,
        attackType: selectedAttack,
        intensity,
        duration: parseInt(duration, 10),
      })
      setStatus('RUNNING')
      toast.success('بدأت المحاكاة', `تم بدء هجوم ${ATTACK_TYPES.find((a) => a.value === selectedAttack)?.label} بSuccess`)
    } catch (err) {
      setStatus('ERROR')
      toast.error('فشل البدء', parseApiError(err).message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleStop = async () => {
    setActionLoading(true)
    try {
      await apiClient.post('/simulation/stop', { serverId: selectedServerId })
      setStatus('STOPPED')
      toast.info('تم الإيقاف', 'تم إيقاف المحاكاة بSuccess')
    } catch (err) {
      toast.error('فشل الإيقاف', parseApiError(err).message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleReset = () => {
    setMetrics([])
    setLogs([])
    logIdsRef.current.clear()
    setCurrentStats({ total: 0, blocked: 0, allowed: 0 })
    setStatus('IDLE')
    toast.info('تم إعادة التعيين', 'تم Clear جميع بيانات المحاكاة')
  }

  // ==================================================================
  // Derived State: البيانات المحسوبة
  // ==================================================================

  const blockRate = useMemo(() => {
    if (currentStats.total === 0) return 0
    return ((currentStats.blocked / currentStats.total) * 100).toFixed(1)
  }, [currentStats])

  const selectedAttackMeta = ATTACK_TYPES.find((a) => a.value === selectedAttack)
  const selectedIntensityMeta = INTENSITY_LEVELS.find((i) => i.value === intensity)

  // ==================================================================
  // Render: واجهة المستخدم
  // ==================================================================

  return (
    <PageShell>
      {/* ---------- Header ---------- */}
      <PageHeader
        icon={ShieldAlert}
        title="Attack simulation"
        subtitle="Test WAF rules by simulating real attacks against your servers."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={RefreshCw} loading={loading} onClick={() => void loadInitialData()}>
              Refresh
            </Button>
            {status === 'RUNNING' ? (
              <Button variant="danger" icon={Square} loading={actionLoading} onClick={() => void handleStop()}>
                إيقاف المحاكاة
              </Button>
            ) : (
              <Button variant="primary" icon={Play} loading={actionLoading} onClick={() => void handleStart()} disabled={!selectedServerId}>
                بدء المحاكاة
              </Button>
            )}
          </div>
        }
      />

      {/* ---------- Status Banner ---------- */}
      {status === 'RUNNING' && (
        <div className="zp-anim-scale-in mb-6 flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/5 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-rose-200">المحاكاة نشطة حالياً</p>
              <p className="text-xs text-rose-300/70">
                يتم استهداف <span className="font-mono text-rose-100">{servers.find((s) => s.id === selectedServerId)?.domain || '...'}</span> بهجوم {selectedAttackMeta?.label}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={handleReset}>
            إعادة تعيين
          </Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {/* ---------- Configuration Grid ---------- */}
          <div className="grid gap-6 lg:grid-cols-3 mb-6">
            {/* Server Selection */}
            <Card className="p-5" delay={0}>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Server className="h-4 w-4 text-cyan-400" />
                السيرفر المستهدف
              </div>
              <SelectInput
                value={selectedServerId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedServerId(e.target.value)}
                disabled={status === 'RUNNING'}
              >
                <option value="" className="bg-slate-900">اختر سيرفر...</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id} className="bg-slate-900">
                    {s.domain} ({s.status})
                  </option>
                ))}
              </SelectInput>
            </Card>

            {/* Attack Type */}
            <Card className="p-5" delay={60}>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Bug className="h-4 w-4 text-rose-400" />
                نوع الهجوم
              </div>
              <SelectInput
                value={selectedAttack}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedAttack(e.target.value as AttackType)}
                disabled={status === 'RUNNING'}
              >
                {ATTACK_TYPES.map((a) => (
                  <option key={a.value} value={a.value} className="bg-slate-900">
                    {a.label}
                  </option>
                ))}
              </SelectInput>
              <p className="mt-2 text-xs text-slate-400">{selectedAttackMeta?.description}</p>
            </Card>

            {/* Intensity & Duration */}
            <Card className="p-5" delay={120}>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Flame className="h-4 w-4 text-amber-400" />
                الشدة والمدة
              </div>
              <div className="space-y-3">
                <SelectInput
                  value={intensity}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setIntensity(e.target.value as IntensityLevel)}
                  disabled={status === 'RUNNING'}
                >
                  {INTENSITY_LEVELS.map((i) => (
                    <option key={i.value} value={i.value} className="bg-slate-900">
                      {i.label} ({i.rps})
                    </option>
                  ))}
                </SelectInput>
                <div className="relative">
                  <TextInput
                    type="number"
                    value={duration}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDuration(e.target.value)}
                    placeholder="Duration (seconds)"
                    disabled={status === 'RUNNING'}
                  />
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                    ثانية
                  </span>
                </div>
              </div>
            </Card>
          </div>

          {/* ---------- Live Metrics Chart ---------- */}
          <Card className="p-6 mb-6" delay={180}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Activity className="h-5 w-5 text-cyan-400" />
                حركة المرور اللحظية
              </h3>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  Blocked ({currentStats.blocked})
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Allowed ({currentStats.allowed})
                </span>
              </div>
            </div>

            <div className="h-72">
              {metrics.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  {status === 'RUNNING' ? 'جاري استقبال البيانات...' : 'ابدأ المحاكاة لعرض الرسم البياني'}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={metrics}>
                    <defs>
                      <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorAllowed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="timestamp" stroke="#64748b" fontSize={10} tickFormatter={(v) => v.split('T')[1]?.substring(0, 5) || v} />
                    <YAxis stroke="#64748b" fontSize={10} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                    <Area type="monotone" dataKey="blockedRequests" stroke="#f43f5e" fillOpacity={1} fill="url(#colorBlocked)" name="Blocked" />
                    <Area type="monotone" dataKey="allowedRequests" stroke="#10b981" fillOpacity={1} fill="url(#colorAllowed)" name="Allowed" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          {/* ---------- Stats Cards ---------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
            <StatBox label="Total requests" value={formatNumber(currentStats.total)} icon={Activity} tone="indigo" delay={240} />
            <StatBox label="Block rate" value={`${blockRate}%`} icon={Shield} tone="emerald" delay={300} />
            <StatBox label="Avg response time" value={`${metrics.length > 0 ? Math.round(metrics[metrics.length - 1].avgLatency) : 0} ms`} icon={Clock} tone="amber" delay={360} />
          </div>

          {/* ---------- Logs Table ---------- */}
          <Card className="p-6" delay={420}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Crosshair className="h-5 w-5 text-rose-400" />
                سجل الهجمات المحاكاة
              </h3>
              <span className="text-xs text-slate-400">{logs.length} سجل</span>
            </div>

            {logs.length === 0 ? (
              <EmptyState icon={Bug} title="No توجد سجNoت" description="ستظهر هنا تفاصيل كل طلب يتم اعتراضه أثناء المحاكاة." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead>
                    <tr className="border-b border-white/8 text-xs text-slate-400">
                      <th className="pb-3 font-medium">الوقت</th>
                      <th className="pb-3 font-medium">نوع الهجوم</th>
                      <th className="pb-3 font-medium">مصدر IP</th>
                      <th className="pb-3 font-medium">المسار</th>
                      <th className="pb-3 font-medium">الإجراء</th>
                      <th className="pb-3 font-medium">الخطورة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {logs.slice(0, 20).map((log) => (
                      <tr key={log.id} className="zp-anim-fade-up transition-colors hover:bg-white/3">
                        <td className="py-3 text-xs text-slate-400">{timeAgo(log.timestamp)}</td>
                        <td className="py-3">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-300">
                            {ATTACK_TYPES.find((a) => a.value === log.attackType)?.label || log.attackType}
                          </span>
                        </td>
                        <td className="py-3 font-mono text-xs text-slate-300">{log.sourceIp}</td>
                        <td className="py-3 font-mono text-xs text-slate-300 truncate max-w-[200px]" title={log.path}>{log.path}</td>
                        <td className="py-3">
                          <span className={cn(
                            'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
                            log.action === 'BLOCKED' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                            log.action === 'CHALLENGED' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          )}>
                            {log.action === 'BLOCKED' ? 'Blocked' : log.action === 'CHALLENGED' ? 'Challenged' : 'Allowed'}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-white/10">
                              <div
                                className={cn('h-full', log.riskScore >= 80 ? 'bg-rose-500' : log.riskScore >= 50 ? 'bg-amber-500' : 'bg-emerald-500')}
                                style={{ width: `${log.riskScore}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium text-white">{log.riskScore}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </PageShell>
  )
}

// ==================================================================
// Sub-Components: مكونات فرعية
// ==================================================================

/**
 * مكون بطاقة إحصائية صغيرة
 */
function StatBox({ label, value, icon: Icon, tone, delay }: { label: string; value: string; icon: React.ElementType; tone: string; delay: number }) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  }

  return (
    <div className={cn('zp-anim-fade-up rounded-xl border p-4', tones[tone])} style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider opacity-80">{label}</p>
          <p className="mt-1 text-2xl font-bold text-white">{value}</p>
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}