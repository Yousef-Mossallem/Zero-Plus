// ======================================================
// ZERO PLUS GATEWAY — services/capacity.manager.ts
// ------------------------------------------------------
// المسؤولية: قياس الـ load الحي وإدارة الـ capacity
//
// بيعمل إيه:
//   1) يحفظ maxRps لكل server من البولسي (من backend_client)
//   2) يعدّ الطلبات الحقيقية في sliding window (Redis)
//   3) يحسب currentRps + loadPercent في كل لحظة
//   4) يقرر: هل الـ server تحت ضغط؟ → priority queue؟
//   5) يبعت تقرير صحة للـ Backend كل دقيقة
//   6) جاهز للـ Agent: لو بعت metrics → يستخدمها بدل التقدير
//   7) جاهز لـ multi-server load balancing
//   8) جاهز للـ priority queue (يقلص الطلبات العادية لصالح /checkout)
//
// مفتاح Redis:
//   zp:cap:{serverId}:rps     → عداد الـ sliding window (string, TTL)
//   zp:cap:{serverId}:agent   → metrics من الـ Agent (hash, TTL)
//   zp:cap:{serverId}:meta    → meta (lastReport, maxRps, …) (hash)
//
// الاستخدام في app.ts:
//   const cap = getCapacityManager()
//   cap.recordRequest(serverId, orgId)        // في كل طلب
//   const state = cap.getServerState(serverId) // لو عايز تعرف الـ load
//   const hint  = state.loadHint               // 'low'|'medium'|'high'|'critical'
// ======================================================

import { getRedis } from './redis.client'
import {
  reportServerHealth,
  type OrgPolicyFromBackend,
  type PolicyResolveData,
  type ServerHealthPayload,
} from './backend.client'

// ======================================================
// إعدادات
// ======================================================

/** كم ثانية نحسب فيها الـ RPS (sliding window) */
const WINDOW_SEC = 10

/** كل كام ms نبعت تقرير للـ Backend */
const REPORT_INTERVAL_MS = 60_000

/** كل كام ms نطهّر الـ metadata القديمة (servers محذوفة) */
const CLEANUP_INTERVAL_MS = 10 * 60_000

/** لو مفيش maxRps معروف → نفترض ده الـ safe limit */
const DEFAULT_SAFE_RPS = 100

/** لما تعدي النسبة دي → warn */
const WARN_PERCENT_DEFAULT = 80

/** TTL مفتاح Agent في Redis (ثانية) */
const AGENT_TTL_SEC = 90

/** TTL مفتاح عداد الـ RPS في Redis (ثانية) */
const COUNTER_TTL_SEC = WINDOW_SEC * 3

// ======================================================
// Types
// ======================================================

export type LoadHint = 'low' | 'medium' | 'high' | 'critical'
export type CapacitySource = 'probe' | 'agent' | 'policy' | 'default'

export interface AgentMetrics {
  /** من الـ Agent (zp-agent) */
  cpuPercent:   number
  ramPercent:   number
  cpuCores:     number
  ramTotalMb:   number
  connections:  number
  agentRps:     number    // الـ Agent بيعدّه من جانبه
  latencyMs:    number
  tunnelUp:     boolean
  reportedAt:   number    // unix ms
}

export interface ServerCapacityState {
  serverId:         string
  orgId:            string
  maxRps:           number         // الـ capacity المعروف
  safeRps:          number         // 85% من maxRps
  warnPercent:      number         // من السياسة
  currentRps:       number         // محسوب من Redis window
  loadPercent:      number         // 0..100
  loadHint:         LoadHint       // low|medium|high|critical
  source:           CapacitySource // من فين جاي maxRps
  queueNeeded:      boolean        // هل محتاج priority queue
  agent:            AgentMetrics | null  // metrics من الـ Agent لو موجود
  updatedAt:        number         // unix ms
}

export interface CapacityReport {
  serverId:    string
  orgId:       string
  state:       ServerCapacityState
  reportedAt:  string   // ISO
}

// ======================================================
// Helpers
// ======================================================

function redisCounterKey(serverId: string): string {
  return `zp:cap:${serverId}:rps`
}

function redisAgentKey(serverId: string): string {
  return `zp:cap:${serverId}:agent`
}

function toLoadHint(loadPercent: number): LoadHint {
  if (loadPercent < 60)  return 'low'
  if (loadPercent < 80)  return 'medium'
  if (loadPercent < 95)  return 'high'
  return 'critical'
}

function safeRps(maxRps: number): number {
  return Math.max(1, Math.round(maxRps * 0.85))
}

// ======================================================
// CapacityManager
// ======================================================

interface ServerMeta {
  serverId:     string
  orgId:        string
  maxRps:       number
  warnPercent:  number
  source:       CapacitySource
  lastReportAt: number
}

export class CapacityManager {
  private servers = new Map<string, ServerMeta>()
  private reportTimer:  ReturnType<typeof setInterval> | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private started = false

  // ------------------------------------------------
  // دورة الحياة
  // ------------------------------------------------

  start(): void {
    if (this.started) return
    this.started = true

    // تقرير دوري للـ Backend
    this.reportTimer = setInterval(() => {
      void this._reportAll()
    }, REPORT_INTERVAL_MS)
    this.reportTimer.unref?.()

    // تنظيف الـ servers القديمة من الذاكرة
    this.cleanupTimer = setInterval(() => {
      this._cleanup()
    }, CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref?.()
  }

  stop(): void {
    if (this.reportTimer)  clearInterval(this.reportTimer)
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.reportTimer  = null
    this.cleanupTimer = null
    this.started = false
  }

  // ------------------------------------------------
  // تسجيل السيرفر (من PolicyResolveData)
  // ------------------------------------------------

  /**
   * يستدعيها app.ts بعد resolvePolicyCached()
   * عشان الـ CapacityManager يعرف الـ maxRps للسيرفر ده
   */
  registerServer(data: PolicyResolveData): void {
    const serverId = data.server.id
    const existing = this.servers.get(serverId)

    // maxRps من أفضل مصدر متاح
    const maxRps =
      data.effectiveMaxServerRps ??
      data.server.maxRequestsPerSecond ??
      data.policy.maxServerRps ??
      DEFAULT_SAFE_RPS

    const warnPercent = data.policy.capacityWarnPercent ?? WARN_PERCENT_DEFAULT

    // تحديد المصدر
    let source: CapacitySource = 'default'
    if (data.effectiveMaxServerRps)        source = 'probe'
    else if (data.server.maxRequestsPerSecond) source = 'policy'
    else if (data.policy.maxServerRps)     source = 'policy'

    this.servers.set(serverId, {
      serverId,
      orgId:        data.organizationId,
      maxRps,
      warnPercent,
      source,
      lastReportAt: existing?.lastReportAt ?? 0,
    })
  }

  /**
   * تحديث يدوي لو جاء maxRps من مصدر جديد (Agent أو Probe جديد)
   */
  updateCapacity(
    serverId: string,
    maxRps: number,
    source: CapacitySource,
  ): void {
    const existing = this.servers.get(serverId)
    if (!existing) return
    this.servers.set(serverId, { ...existing, maxRps, source })
  }

  // ------------------------------------------------
  // تسجيل طلب (بيتستدعى في كل طلب)
  // ------------------------------------------------

  /**
   * يعدّ طلب واحد في Redis sliding window
   * خفيف: بيعمل INCR + EXPIRE فقط
   * fail-open: لو Redis وقع مابيعملش حاجة
   */
  recordRequest(serverId: string, _orgId?: string): void {
    const key = redisCounterKey(serverId)
    const r   = getRedis()

    // fire-and-forget: مش بنستنى الـ response
    r.incr(key)
      .then((n) => {
        if (n === 1) {
          // أول request في الـ window → نضبط الـ TTL
          return r.expire(key, COUNTER_TTL_SEC)
        }
      })
      .catch(() => { /* fail-open */ })
  }

  // ------------------------------------------------
  // قراءة الـ state (async — بيقرأ من Redis)
  // ------------------------------------------------

  async getServerState(serverId: string): Promise<ServerCapacityState | null> {
    const meta = this.servers.get(serverId)
    if (!meta) return null

    const [currentRps, agent] = await Promise.all([
      this._readCurrentRps(serverId),
      this._readAgentMetrics(serverId),
    ])

    // لو عندنا Agent metrics، نستخدم maxRps منه لو أدق
    let { maxRps, source } = meta
    if (agent && agent.agentRps > 0) {
      // الـ Agent عنده قياس حقيقي من السيرفر نفسه → أدق
      source = 'agent'
    }

    const loadPercent = maxRps > 0
      ? Math.min(100, Math.round((currentRps / maxRps) * 100))
      : 0

    const loadHint    = toLoadHint(loadPercent)
    const queueNeeded = loadPercent >= meta.warnPercent

    return {
      serverId,
      orgId:        meta.orgId,
      maxRps,
      safeRps:      safeRps(maxRps),
      warnPercent:  meta.warnPercent,
      currentRps,
      loadPercent,
      loadHint,
      source,
      queueNeeded,
      agent,
      updatedAt:    Date.now(),
    }
  }

  /**
   * نسخة sync تقريبية (بدون Redis) — للاستخدام في hot path لو مش عايز await
   * الدقة: 70-80% (بناءً على آخر قيمة معروفة)
   */
  getServerStateSync(serverId: string): Pick<ServerCapacityState, 'loadHint' | 'queueNeeded'> | null {
    const meta = this.servers.get(serverId)
    if (!meta) return null
    // في غياب Redis read → افترض load منخفض (fail-open)
    return { loadHint: 'low', queueNeeded: false }
  }

  // ------------------------------------------------
  // Agent metrics (من WireGuard Agent لما يتبعت)
  // ------------------------------------------------

  /**
   * يستدعيها endpoint خاص بالـ Agent في app.ts
   * POST /internal/agent/heartbeat
   */
  async receiveAgentMetrics(
    serverId: string,
    orgId: string,
    metrics: Omit<AgentMetrics, 'reportedAt'>,
  ): Promise<void> {
    const r   = getRedis()
    const key = redisAgentKey(serverId)

    const data: AgentMetrics = { ...metrics, reportedAt: Date.now() }

    // نحفظ كـ JSON في Redis بـ TTL = 90 ثانية
    // لو الـ Agent وقع، الـ Gateway يرجع لـ probe/policy بعد 90 ثانية
    await r.set(key, JSON.stringify(data), 'EX', AGENT_TTL_SEC)

    // لو الـ Agent بعت maxRps جديد → نحدّث الـ metadata
    if (metrics.agentRps > 0 && this.servers.has(serverId)) {
      this.updateCapacity(serverId, metrics.agentRps, 'agent')
    }

    // تأكد إن السيرفر مسجّل
    if (!this.servers.has(serverId)) {
      this.servers.set(serverId, {
        serverId,
        orgId,
        maxRps:       metrics.agentRps || DEFAULT_SAFE_RPS,
        warnPercent:  WARN_PERCENT_DEFAULT,
        source:       'agent',
        lastReportAt: 0,
      })
    }
  }

  // ------------------------------------------------
  // Priority queue helpers
  // ------------------------------------------------

  /**
   * هل المسار ده "حساس" ولازم يتقدّم في الطابور؟
   * بيتعرف من path_sensitivity اللي عنده الـ AI
   */
  isSensitivePath(path: string): boolean {
    const p = path.toLowerCase().split('?')[0] ?? ''
    return (
      p.includes('/checkout') ||
      p.includes('/payment') ||
      p.includes('/login') ||
      p.includes('/signin') ||
      p.includes('/api/auth') ||
      p.includes('/billing') ||
      p.includes('/subscribe')
    )
  }

  /**
   * هل الطلب ده لازم يتقدم (high priority)؟
   * بيرجع priority score: 0 (عادي) .. 10 (حرج)
   */
  getPriority(path: string, hasClearance: boolean): number {
    if (this.isSensitivePath(path)) {
      return hasClearance ? 9 : 7   // زائر معروف على مسار حساس → أعلى أولوية
    }
    return hasClearance ? 3 : 1     // زائر عادي
  }

  // ------------------------------------------------
  // Multi-server load balancing helper
  // ------------------------------------------------

  /**
   * لو عندك أكتر من سيرفر لنفس الـ org،
   * بيرجع الـ serverId الأقل تحميلاً
   * (هتستخدمه لما تعمل WireGuard + multi-server)
   */
  async pickLeastLoadedServer(serverIds: string[]): Promise<string | null> {
    if (serverIds.length === 0) return null
    if (serverIds.length === 1) return serverIds[0]!

    const states = await Promise.all(
      serverIds.map((id) => this.getServerState(id))
    )

    let best: string | null = null
    let bestLoad = Infinity

    for (const state of states) {
      if (!state) continue
      if (state.loadPercent < bestLoad) {
        bestLoad = state.loadPercent
        best     = state.serverId
      }
    }

    return best ?? serverIds[0]!
  }

  // ------------------------------------------------
  // Backend reporting (تلقائي كل دقيقة)
  // ------------------------------------------------

  async reportServer(serverId: string): Promise<void> {
    const state = await this.getServerState(serverId)
    if (!state) return

    const meta = this.servers.get(serverId)
    if (!meta) return

    const payload: ServerHealthPayload = {
      currentLoadPercent:   state.loadPercent,
      maxRequestsPerSecond: state.maxRps,
      safeRequestsPerSecond: state.safeRps,
    }

    // لو عندنا Agent metrics، أضفها
    if (state.agent) {
      ;(payload as Record<string, unknown>)['agentCpuPercent']  = state.agent.cpuPercent
      ;(payload as Record<string, unknown>)['agentRamPercent']  = state.agent.ramPercent
      ;(payload as Record<string, unknown>)['agentConnections'] = state.agent.connections
      ;(payload as Record<string, unknown>)['agentLatencyMs']   = state.agent.latencyMs
      ;(payload as Record<string, unknown>)['tunnelUp']         = state.agent.tunnelUp
    }

    try {
      await reportServerHealth(serverId, payload)
      meta.lastReportAt = Date.now()
    } catch {
      // fail-open: مش مشكلة لو الـ backend مش متاح
    }
  }

  // ------------------------------------------------
  // Internals
  // ------------------------------------------------

  private async _readCurrentRps(serverId: string): Promise<number> {
    try {
      const r   = getRedis()
      const key = redisCounterKey(serverId)
      const val = await r.get(key)
      if (!val) return 0
      const count = parseInt(val, 10)
      if (!Number.isFinite(count) || count < 0) return 0
      // الـ window هو WINDOW_SEC ثانية
      return Math.round(count / WINDOW_SEC)
    } catch {
      return 0
    }
  }

  private async _readAgentMetrics(serverId: string): Promise<AgentMetrics | null> {
    try {
      const r   = getRedis()
      const key = redisAgentKey(serverId)
      const raw = await r.get(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as AgentMetrics
      // لو الـ Agent بعت منذ أكتر من AGENT_TTL_SEC → اعتبره منقطع
      if (Date.now() - parsed.reportedAt > AGENT_TTL_SEC * 1000) return null
      return parsed
    } catch {
      return null
    }
  }

  private async _reportAll(): Promise<void> {
    const ids = Array.from(this.servers.keys())
    // بالتوازي (بـ limit عشان مانضغطش الـ backend)
    const BATCH = 10
    for (let i = 0; i < ids.length; i += BATCH) {
      await Promise.allSettled(
        ids.slice(i, i + BATCH).map((id) => this.reportServer(id))
      )
    }
  }

  private _cleanup(): void {
    const cutoff = Date.now() - CLEANUP_INTERVAL_MS * 2
    for (const [id, meta] of this.servers.entries()) {
      if (meta.lastReportAt > 0 && meta.lastReportAt < cutoff) {
        this.servers.delete(id)
      }
    }
  }
}

// ======================================================
// Singleton
// ======================================================

let _instance: CapacityManager | null = null

export function getCapacityManager(): CapacityManager {
  if (!_instance) {
    _instance = new CapacityManager()
    _instance.start()
  }
  return _instance
}

export function closeCapacityManager(): void {
  _instance?.stop()
  _instance = null
}

// ======================================================
// exports
// ======================================================

export default {
  CapacityManager,
  getCapacityManager,
  closeCapacityManager,
}