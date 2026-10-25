// ======================================================
// ZERO PLUS GATEWAY — detection/ban.manager.ts
// ------------------------------------------------------
// مسؤولية الملف:
//   1) فحص سريع: هل IP / جهاز محظور؟ (Redis أولاً — مسار S0)
//   2) تطبيق حظر مؤقت أو دائم على Redis
//   3) رفع حظر (يدوي أو بعد انتهاء المدة)
//   4) مزامنة قائمة الحظر من الـ Backend → Redis
//   5) مفاتيح عزل لكل organizationId (شركات منفصلة)
//
// ما لا يفعله:
//   - حساب Risk / اختيار المسار / البروكسي
//   - استبدال سياسة الشركة (المدة والنوع ييجوا من policy أو من الباك)
//
// مصدر الحقيقة:
//   - مسار الطلب الحي: Redis (سريع)
//   - مصدر الإدارة والمزامنة: Backend (syncBans / apply reputation)
// ======================================================

import type Redis from 'ioredis'
import { getRedis } from '../services/redis.client'
import {
  syncBans,
  syncAllBans,
  type BanSyncItem,
  type BanStatus,
} from '../services/backend.client'

// ------------------------------------------------------
// ثوابت المفاتيح
// ------------------------------------------------------

/** حظر على IP داخل شركة */
const keyIp = (orgId: string, ip: string) =>
  `zp:ban:ip:${orgId}:${ip}`

/** حظر على بصمة جهاز داخل شركة */
const keyDev = (orgId: string, fp: string) =>
  `zp:ban:dev:${orgId}:${fp}`

/** فهرس بسيط لكل مفاتيح حظر شركة (للمسح/الإحصاء — اختياري) */
const keyOrgIndex = (orgId: string) => `zp:ban:index:${orgId}`

/** آخر وقت مزامنة عامة */
const KEY_SYNC_CURSOR = 'zp:ban:sync:serverTime'

const MAX_REASON_LEN = 200
const MAX_FP_LEN = 128
const MAX_IP_LEN = 64

// ------------------------------------------------------
// أنواع
// ------------------------------------------------------

export type BanKind = 'TEMPORARY' | 'PERMANENT'

export interface BanRecord {
  orgId: string
  ip: string | null
  deviceFingerprint: string | null
  kind: BanKind
  /** Unix ms — null = دائم */
  bannedUntil: number | null
  reason: string
  /** مصدر الكتابة */
  source: 'gateway' | 'backend_sync' | 'manual'
  createdAt: number
  updatedAt: number
}

export interface BanCheckInput {
  organizationId: string
  ip: string
  deviceFingerprint?: string | null
}

export interface BanCheckResult {
  banned: boolean
  /** طابق IP ولا الجهاز؟ */
  matchedBy: 'ip' | 'device' | null
  record: BanRecord | null
  /** دقايق متبقية (مؤقت) */
  minutesLeft: number | null
}

export interface ApplyBanInput {
  organizationId: string
  ip?: string | null
  deviceFingerprint?: string | null
  /** مؤقت بالدقائق — يُتجاهل لو permanent */
  banMinutes?: number
  permanent?: boolean
  reason: string
  source?: BanRecord['source']
}

export interface LiftBanInput {
  organizationId: string
  ip?: string | null
  deviceFingerprint?: string | null
}

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------

function nowMs(): number {
  return Date.now()
}

function sanitizeIp(ip: string | null | undefined): string | null {
  if (!ip || typeof ip !== 'string') return null
  const t = ip.trim()
  if (t.length < 3 || t.length > MAX_IP_LEN) return null
  // IPv4 / IPv6 مبسّط — منع حقن مفتاح Redis
  if (!/^[0-9a-fA-F:.]+$/.test(t)) return null
  return t
}

function sanitizeFp(fp: string | null | undefined): string | null {
  if (!fp || typeof fp !== 'string') return null
  const t = fp.trim()
  if (t.length < 8 || t.length > MAX_FP_LEN) return null
  if (!/^[a-zA-Z0-9_\-:.=]+$/.test(t)) return null
  return t
}

function sanitizeReason(reason: string): string {
  const t = (reason || 'unspecified').trim().slice(0, MAX_REASON_LEN)
  return t.length > 0 ? t : 'unspecified'
}

function sanitizeOrgId(orgId: string): string {
  const t = (orgId || '').trim()
  if (!t || t.length > 80) {
    throw new Error('[ban.manager] invalid organizationId')
  }
  // uuid أو slug آمن
  if (!/^[a-zA-Z0-9_\-]+$/.test(t)) {
    throw new Error('[ban.manager] invalid organizationId chars')
  }
  return t
}

function parseRecord(raw: string | null): BanRecord | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as BanRecord
    if (!o || typeof o !== 'object') return null
    if (o.kind !== 'TEMPORARY' && o.kind !== 'PERMANENT') return null
    return o
  } catch {
    return null
  }
}

function isRecordActive(rec: BanRecord, now = nowMs()): boolean {
  if (rec.kind === 'PERMANENT') return true
  if (rec.bannedUntil == null) return true
  return rec.bannedUntil > now
}

function minutesLeft(rec: BanRecord, now = nowMs()): number | null {
  if (rec.kind === 'PERMANENT' || rec.bannedUntil == null) return null
  const ms = rec.bannedUntil - now
  if (ms <= 0) return 0
  return Math.ceil(ms / 60000)
}

function redis(): Redis {
  return getRedis() as Redis
}

/** TTL ثواني لمفتاح Redis (حد أدنى 1s) */
function ttlSeconds(bannedUntil: number | null, permanent: boolean): number | null {
  if (permanent || bannedUntil == null) return null // من غير TTL = دائم
  const sec = Math.ceil((bannedUntil - nowMs()) / 1000)
  return Math.max(1, sec)
}

// ------------------------------------------------------
// قراءة — مسار الطلب الحي
// ------------------------------------------------------

/**
 * فحص سريع قبل باقي الـ pipeline.
 * الجهاز له أولوية في matchedBy لو الاتنين محظورين.
 */
export async function checkBan(input: BanCheckInput): Promise<BanCheckResult> {
  const orgId = sanitizeOrgId(input.organizationId)
  const ip = sanitizeIp(input.ip)
  const fp = sanitizeFp(input.deviceFingerprint)

  if (!ip && !fp) {
    return { banned: false, matchedBy: null, record: null, minutesLeft: null }
  }

  const r = redis()
  const now = nowMs()

  // جهاز أولاً (أدق من IP مع CGNAT)
  if (fp) {
    const raw = await r.get(keyDev(orgId, fp))
    const rec = parseRecord(raw)
    if (rec && isRecordActive(rec, now)) {
      return {
        banned: true,
        matchedBy: 'device',
        record: rec,
        minutesLeft: minutesLeft(rec, now),
      }
    }
    // منتهي → نظّف
    if (rec && !isRecordActive(rec, now)) {
      await r.del(keyDev(orgId, fp))
    }
  }

  if (ip) {
    const raw = await r.get(keyIp(orgId, ip))
    const rec = parseRecord(raw)
    if (rec && isRecordActive(rec, now)) {
      return {
        banned: true,
        matchedBy: 'ip',
        record: rec,
        minutesLeft: minutesLeft(rec, now),
      }
    }
    if (rec && !isRecordActive(rec, now)) {
      await r.del(keyIp(orgId, ip))
    }
  }

  return { banned: false, matchedBy: null, record: null, minutesLeft: null }
}

/**
 * boolean مختصر لـ suspicion-router
 */
export async function isBlacklisted(input: BanCheckInput): Promise<boolean> {
  const res = await checkBan(input)
  return res.banned
}

// ------------------------------------------------------
// كتابة حظر
// ------------------------------------------------------

/**
 * يطبّق حظر على IP و/أو الجهاز.
 * لازم واحد على الأقل من ip أو deviceFingerprint.
 */
export async function applyBan(input: ApplyBanInput): Promise<BanRecord> {
  const orgId = sanitizeOrgId(input.organizationId)
  const ip = sanitizeIp(input.ip)
  const fp = sanitizeFp(input.deviceFingerprint)

  if (!ip && !fp) {
    throw new Error('[ban.manager] applyBan requires ip or deviceFingerprint')
  }

  const permanent = Boolean(input.permanent)
  const minutes =
    !permanent && input.banMinutes != null && input.banMinutes > 0
      ? input.banMinutes
      : permanent
        ? null
        : 15

  const until =
    permanent || minutes == null ? null : nowMs() + minutes * 60 * 1000

  const record: BanRecord = {
    orgId,
    ip,
    deviceFingerprint: fp,
    kind: permanent ? 'PERMANENT' : 'TEMPORARY',
    bannedUntil: until,
    reason: sanitizeReason(input.reason),
    source: input.source ?? 'gateway',
    createdAt: nowMs(),
    updatedAt: nowMs(),
  }

  const payload = JSON.stringify(record)
  const r = redis()
  const ttl = ttlSeconds(until, permanent)
  const pipe = r.pipeline()

  if (ip) {
    const k = keyIp(orgId, ip)
    if (ttl == null) pipe.set(k, payload)
    else pipe.set(k, payload, 'EX', ttl)
    pipe.sadd(keyOrgIndex(orgId), k)
  }
  if (fp) {
    const k = keyDev(orgId, fp)
    if (ttl == null) pipe.set(k, payload)
    else pipe.set(k, payload, 'EX', ttl)
    pipe.sadd(keyOrgIndex(orgId), k)
  }

  await pipe.exec()
  return record
}

/**
 * رفع حظر عن IP و/أو جهاز
 */
export async function liftBan(input: LiftBanInput): Promise<{ removed: number }> {
  const orgId = sanitizeOrgId(input.organizationId)
  const ip = sanitizeIp(input.ip)
  const fp = sanitizeFp(input.deviceFingerprint)
  const r = redis()
  let removed = 0

  if (ip) {
    const k = keyIp(orgId, ip)
    removed += await r.del(k)
    await r.srem(keyOrgIndex(orgId), k)
  }
  if (fp) {
    const k = keyDev(orgId, fp)
    removed += await r.del(k)
    await r.srem(keyOrgIndex(orgId), k)
  }

  return { removed }
}

// ------------------------------------------------------
// مزامنة من Backend → Redis
// ------------------------------------------------------

function mapSyncItemToRecord(item: BanSyncItem): BanRecord | null {
  if (item.banStatus === 'NONE') return null
  if (item.isAllowlisted) return null

  const permanent = item.banStatus === 'PERMANENT'
  const until = item.bannedUntil ? Date.parse(item.bannedUntil) : null

  if (!permanent && until != null && until <= nowMs()) return null

  const ip = sanitizeIp(item.ipAddress)
  const fp = sanitizeFp(item.deviceFingerprint)
  if (!ip && !fp) return null

  return {
    orgId: item.organizationId,
    ip,
    deviceFingerprint: fp,
    kind: permanent ? 'PERMANENT' : 'TEMPORARY',
    bannedUntil: permanent ? null : until,
    reason: 'backend_sync',
    source: 'backend_sync',
    createdAt: Date.parse(item.updatedAt) || nowMs(),
    updatedAt: Date.parse(item.updatedAt) || nowMs(),
  }
}

async function writeRecordToRedis(rec: BanRecord): Promise<void> {
  const r = redis()
  const payload = JSON.stringify(rec)
  const ttl = ttlSeconds(rec.bannedUntil, rec.kind === 'PERMANENT')
  const pipe = r.pipeline()

  if (rec.ip) {
    const k = keyIp(rec.orgId, rec.ip)
    if (ttl == null) pipe.set(k, payload)
    else pipe.set(k, payload, 'EX', ttl)
    pipe.sadd(keyOrgIndex(rec.orgId), k)
  }
  if (rec.deviceFingerprint) {
    const k = keyDev(rec.orgId, rec.deviceFingerprint)
    if (ttl == null) pipe.set(k, payload)
    else pipe.set(k, payload, 'EX', ttl)
    pipe.sadd(keyOrgIndex(rec.orgId), k)
  }
  await pipe.exec()
}

/**
 * مزامنة صفحة واحدة من الباك (cursor)
 */
export async function syncBansFromBackend(params?: {
  organizationId?: string
  updatedSince?: string
  limit?: number
  cursor?: string
}): Promise<{ written: number; nextCursor: string | null; serverTime: string }> {
  const page = await syncBans({
    limit: params?.limit ?? 500,
    cursor: params?.cursor,
    updatedSince: params?.updatedSince,
    organizationId: params?.organizationId,
  })

  let written = 0
  for (const item of page.bans) {
    // allowlist أو NONE → امسح مفاتيح محلية لو موجودة
    if (item.isAllowlisted || item.banStatus === 'NONE') {
      await liftBan({
        organizationId: item.organizationId,
        ip: item.ipAddress,
        deviceFingerprint: item.deviceFingerprint,
      })
      continue
    }

    const rec = mapSyncItemToRecord(item)
    if (!rec) continue
    await writeRecordToRedis(rec)
    written++
  }

  const r = redis()
  await r.set(KEY_SYNC_CURSOR, page.serverTime)

  return {
    written,
    nextCursor: page.nextCursor,
    serverTime: page.serverTime,
  }
}

/**
 * مزامنة كاملة (كل الصفحات) — شغّلها عند الإقلاع أو cron
 */
export async function syncAllBansFromBackend(params?: {
  organizationId?: string
  updatedSince?: string
}): Promise<{ written: number; serverTime: string }> {
  const { bans, serverTime } = await syncAllBans(params)
  let written = 0

  for (const item of bans) {
    if (item.isAllowlisted || item.banStatus === ('NONE' as BanStatus)) {
      await liftBan({
        organizationId: item.organizationId,
        ip: item.ipAddress,
        deviceFingerprint: item.deviceFingerprint,
      })
      continue
    }
    const rec = mapSyncItemToRecord(item)
    if (!rec) continue
    await writeRecordToRedis(rec)
    written++
  }

  await redis().set(KEY_SYNC_CURSOR, serverTime)
  return { written, serverTime }
}

export async function getLastSyncServerTime(): Promise<string | null> {
  return redis().get(KEY_SYNC_CURSOR)
}

// ------------------------------------------------------
// استخدام من app بعد قرار ban
// ------------------------------------------------------

/**
 * يطبّق حظر من قرار policy / suspicion-router
 */
export async function applyBanFromDecision(params: {
  organizationId: string
  ip: string
  deviceFingerprint?: string | null
  decision: {
    action: string
    banMinutes?: number
    reason?: string
  }
}): Promise<BanRecord | null> {
  const { decision } = params
  if (
    decision.action !== 'temporary_ban' &&
    decision.action !== 'permanent_ban' &&
    decision.action !== 'ban'
  ) {
    return null
  }

  return applyBan({
    organizationId: params.organizationId,
    ip: params.ip,
    deviceFingerprint: params.deviceFingerprint,
    permanent: decision.action === 'permanent_ban',
    banMinutes: decision.banMinutes ?? 15,
    reason: decision.reason ?? decision.action,
    source: 'gateway',
  })
}

// ------------------------------------------------------
export default {
  checkBan,
  isBlacklisted,
  applyBan,
  liftBan,
  syncBansFromBackend,
  syncAllBansFromBackend,
  getLastSyncServerTime,
  applyBanFromDecision,
}