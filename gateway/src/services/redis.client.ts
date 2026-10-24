// ======================================================
// ZERO PLUS GATEWAY — Redis Client
// العميل المركزي للتعامل مع Redis
// ======================================================
//
// المسؤوليات:
// 1. إنشاء وإدارة اتصال Redis واحد قوي (Singleton)
// 2. إدارة الحظر (Ban) — مؤقت / دائم / حسب الجهاز
// 3. إدارة التصاريح (Clearance) — تخزين + إلغاء
// 4. عدادات Rate Limiting
// 5. السمعة (Reputation)
// 6. كاش نتائج الـ AI
// 7. كاش السياسات والإعدادات
//
// كل المفاتيح بتبدأ بالـ prefix الموجود في config.redis.keyPrefix
// عشان ما تتداخلش مع خدمات تانية.
//
// ======================================================

import Redis from 'ioredis';
import { config } from '../config';
import type { BanEntry, ReputationEntry, ClearancePayload } from '../types';

// ======================================================
// إنشاء الاتصال (Singleton)
// ======================================================

let redisInstance: Redis | null = null;

/**
 * بيرجع instance واحد فقط من Redis.
 * لو الاتصال وقع بيعيد الاتصال تلقائيًا.
 */
export function getRedis(): Redis {
  if (redisInstance) return redisInstance;

  redisInstance = new Redis(config.redis.url, {
    maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
    retryStrategy(times) {
      const delay = Math.min(times * config.redis.retryDelayMs, 2000);
      console.warn(`[Redis] إعادة الاتصال... المحاولة رقم ${times} بعد ${delay}ms`);
      return delay;
    },
    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some((e) => err.message.includes(e));
    },
    lazyConnect: false,
    enableReadyCheck: true,
    enableOfflineQueue: true,
  });

  redisInstance.on('connect', () => {
    console.log('[Redis] متصل بنجاح');
  });

  redisInstance.on('ready', () => {
    console.log('[Redis] جاهز لاستقبال الأوامر');
  });

  redisInstance.on('error', (err) => {
    console.error('[Redis] خطأ:', err.message);
  });

  redisInstance.on('close', () => {
    console.warn('[Redis] الاتصال اتقفل');
  });

  redisInstance.on('reconnecting', () => {
    console.warn('[Redis] جاري إعادة الاتصال...');
  });

  return redisInstance;
}

// ======================================================
// Key Builders (عشان المفاتيح تبقى منظمة)
// ======================================================

const prefix = config.redis.keyPrefix;

const keys = {
  /** حظر IP أو IP+Device */
  ban: (ip: string, deviceFp?: string | null) =>
    deviceFp ? `${prefix}ban:${ip}:${deviceFp}` : `${prefix}ban:${ip}`,

  /** تصريح Clearance */
  clearance: (token: string) => `${prefix}clearance:${token}`,

  /** عداد Rate Limit */
  rate: (ip: string, window: string) => `${prefix}rate:${ip}:${window}`,

  /** سمعة IP */
  reputation: (ip: string) => `${prefix}rep:${ip}`,

  /** كاش نتيجة AI */
  aiCache: (orgId: string, ip: string) => `${prefix}ai:${orgId}:${ip}`,

  /** سياسة المنظمة */
  orgPolicy: (orgId: string) => `${prefix}policy:${orgId}`,

  /** Origin info للمنظمة */
  originInfo: (orgId: string) => `${prefix}origin:${orgId}`,

  /** قائمة الأجهزة المحظورة المرتبطة بـ IP (للـ CGNAT) */
  bannedDevices: (ip: string) => `${prefix}banned_devices:${ip}`,
};

// ======================================================
// Ban Management
// ======================================================

/**
 * بيحظر IP أو (IP + Device Fingerprint)
 */
export async function ban(
  entry: BanEntry
): Promise<void> {
  const redis = getRedis();
  const key = keys.ban(entry.ip, entry.deviceFingerprint);

  const payload = JSON.stringify({
    ip: entry.ip,
    deviceFingerprint: entry.deviceFingerprint,
    bannedUntil: entry.bannedUntil,
    isPermanent: entry.isPermanent,
    reason: entry.reason,
    createdAt: Date.now(),
  });

  if (entry.isPermanent) {
    // حظر دائم — مفيش TTL
    await redis.set(key, payload);
  } else {
    // حظر مؤقت
    const ttlSeconds = Math.max(
      1,
      Math.ceil((entry.bannedUntil - Date.now()) / 1000)
    );
    await redis.set(key, payload, 'EX', ttlSeconds);
  }

  // لو في device fingerprint → نسجله في قائمة الأجهزة المحظورة للـ IP
  if (entry.deviceFingerprint) {
    await redis.sadd(keys.bannedDevices(entry.ip), entry.deviceFingerprint);
  }
}

/**
 * بيشيك هل الـ IP أو الجهاز محظور دلوقتي
 */
export async function isBanned(
  ip: string,
  deviceFingerprint?: string | null
): Promise<BanEntry | null> {
  const redis = getRedis();

  // الأول نشيك على الحظر الخاص بالجهاز لو موجود
  if (deviceFingerprint) {
    const deviceKey = keys.ban(ip, deviceFingerprint);
    const deviceData = await redis.get(deviceKey);
    if (deviceData) {
      const entry = JSON.parse(deviceData) as BanEntry;
      if (entry.isPermanent || entry.bannedUntil > Date.now()) {
        return entry;
      }
      // انتهى الحظر → نمسحه
      await redis.del(deviceKey);
    }
  }

  // بعدين نشيك على حظر الـ IP لوحده
  const ipKey = keys.ban(ip);
  const ipData = await redis.get(ipKey);
  if (ipData) {
    const entry = JSON.parse(ipData) as BanEntry;
    if (entry.isPermanent || entry.bannedUntil > Date.now()) {
      return entry;
    }
    await redis.del(ipKey);
  }

  return null;
}

/**
 * بيلغي الحظر
 */
export async function unban(
  ip: string,
  deviceFingerprint?: string | null
): Promise<void> {
  const redis = getRedis();
  const key = keys.ban(ip, deviceFingerprint);
  await redis.del(key);

  if (deviceFingerprint) {
    await redis.srem(keys.bannedDevices(ip), deviceFingerprint);
  }
}

// ======================================================
// Clearance Management
// ======================================================

/**
 * بيسجل تصريح جديد في Redis (عشان نقدر نلغيه بعدين)
 */
export async function storeClearance(
  token: string,
  payload: ClearancePayload,
  ttlSeconds: number
): Promise<void> {
  const redis = getRedis();
  const key = keys.clearance(token);

  await redis.set(
    key,
    JSON.stringify(payload),
    'EX',
    ttlSeconds
  );
}

/**
 * بيجيب بيانات التصريح
 */
export async function getClearance(
  token: string
): Promise<ClearancePayload | null> {
  const redis = getRedis();
  const data = await redis.get(keys.clearance(token));
  if (!data) return null;
  return JSON.parse(data) as ClearancePayload;
}

/**
 * بيلغي تصريح (لما الـ AI يلاقي سلوك غريب بعد التصريح)
 */
export async function revokeClearance(token: string): Promise<void> {
  const redis = getRedis();
  await redis.del(keys.clearance(token));
}

/**
 * بيلغي كل التصاريح المرتبطة بـ IP معيّن (في حالة الحظر)
 */
export async function revokeAllClearancesForIp(ip: string): Promise<void> {
  // ملاحظة: لو عايزين نعمل الميزة دي كاملة محتاجين
  // secondary index. حاليًا بنعتمد على الـ TTL الطبيعي.
  // ممكن نتطورها لاحقًا لو احتجناها.
}

// ======================================================
// Rate Limiting
// ======================================================

/**
 * بيزود العداد ويرجع العدد الحالي في النافذة.
 * بيستخدم Fixed Window بسيطة وسريعة.
 */
export async function incrementRate(
  ip: string,
  windowSeconds: number = config.rateLimit.windowSeconds
): Promise<number> {
  const redis = getRedis();
  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = keys.rate(ip, String(windowId));

  const count = await redis.incr(key);

  // أول مرة بس نحط الـ TTL
  if (count === 1) {
    await redis.expire(key, windowSeconds + 1);
  }

  return count;
}

/**
 * بيرجع العدد الحالي من غير ما يزود
 */
export async function getRateCount(
  ip: string,
  windowSeconds: number = config.rateLimit.windowSeconds
): Promise<number> {
  const redis = getRedis();
  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = keys.rate(ip, String(windowId));
  const count = await redis.get(key);
  return count ? parseInt(count, 10) : 0;
}

// ======================================================
// Reputation
// ======================================================

/**
 * بيجيب سجل السمعة لـ IP
 */
export async function getReputation(ip: string): Promise<ReputationEntry | null> {
  const redis = getRedis();
  const data = await redis.get(keys.reputation(ip));
  if (!data) return null;
  return JSON.parse(data) as ReputationEntry;
}

/**
 * بيحدث أو بينشئ سجل السمعة
 */
export async function setReputation(entry: ReputationEntry): Promise<void> {
  const redis = getRedis();
  const key = keys.reputation(entry.ip);

  // السمعة بنخليها تعيش فترة طويلة (30 يوم)
  await redis.set(key, JSON.stringify(entry), 'EX', 60 * 60 * 24 * 30);
}

/**
 * بيزود نقاط السمعة ويرجع السجل الجديد
 */
export async function addReputationPoints(
  ip: string,
  pointsToAdd: number,
  reason?: string
): Promise<ReputationEntry> {
  const current = (await getReputation(ip)) || {
    ip,
    score: 0,
    bannedUntil: null,
    isPermanent: false,
    points: 0,
  };

  const newPoints = current.points + pointsToAdd;
  const newScore = Math.min(10, current.score + pointsToAdd); // أقصى 10

  const updated: ReputationEntry = {
    ...current,
    points: newPoints,
    score: newScore,
  };

  // لو وصل للحد → حظر دائم
  if (newScore >= config.reputation.permanentBanThreshold) {
    updated.isPermanent = true;
    updated.bannedUntil = null;
  }

  await setReputation(updated);
  return updated;
}

// ======================================================
// AI Result Cache
// ======================================================

/**
 * بيحفظ نتيجة تحليل الـ AI
 */
export async function cacheAIResult(
  orgId: string,
  ip: string,
  result: unknown,
  ttlSeconds: number = config.ai.cacheTtlSeconds
): Promise<void> {
  const redis = getRedis();
  const key = keys.aiCache(orgId, ip);
  await redis.set(key, JSON.stringify(result), 'EX', ttlSeconds);
}

/**
 * بيجيب نتيجة الـ AI من الكاش
 */
export async function getCachedAIResult<T = unknown>(
  orgId: string,
  ip: string
): Promise<T | null> {
  const redis = getRedis();
  const data = await redis.get(keys.aiCache(orgId, ip));
  if (!data) return null;
  return JSON.parse(data) as T;
}

// ======================================================
// Org Policy & Origin Cache
// ======================================================

/**
 * بيحفظ سياسة منظمة
 */
export async function cacheOrgPolicy(
  orgId: string,
  policy: unknown,
  ttlSeconds: number = 300 // 5 دقايق
): Promise<void> {
  const redis = getRedis();
  await redis.set(keys.orgPolicy(orgId), JSON.stringify(policy), 'EX', ttlSeconds);
}

/**
 * بيجيب سياسة منظمة من الكاش
 */
export async function getCachedOrgPolicy<T = unknown>(
  orgId: string
): Promise<T | null> {
  const redis = getRedis();
  const data = await redis.get(keys.orgPolicy(orgId));
  if (!data) return null;
  return JSON.parse(data) as T;
}

/**
 * بيحفظ معلومات الـ Origin لمنظمة
 */
export async function cacheOriginInfo(
  orgId: string,
  info: unknown,
  ttlSeconds: number = 60
): Promise<void> {
  const redis = getRedis();
  await redis.set(keys.originInfo(orgId), JSON.stringify(info), 'EX', ttlSeconds);
}

/**
 * بيجيب معلومات الـ Origin
 */
export async function getCachedOriginInfo<T = unknown>(
  orgId: string
): Promise<T | null> {
  const redis = getRedis();
  const data = await redis.get(keys.originInfo(orgId));
  if (!data) return null;
  return JSON.parse(data) as T;
}

// ======================================================
// Utility
// ======================================================

/**
 * بيمسح كل المفاتيح اللي ليها prefix معيّن (للتطوير والتنظيف)
 * خلي بالك: في الإنتاج استخدمها بحذر.
 */
export async function flushGatewayKeys(): Promise<number> {
  const redis = getRedis();
  const stream = redis.scanStream({
    match: `${prefix}*`,
    count: 100,
  });

  let deleted = 0;
  const pipeline = redis.pipeline();

  for await (const keysBatch of stream) {
    for (const key of keysBatch as string[]) {
      pipeline.del(key);
      deleted++;
    }
  }

  await pipeline.exec();
  return deleted;
}

/**
 * بيقفل الاتصال بشكل نظيف (لما السيرفر يقفل)
 */
export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
    console.log('[Redis] الاتصال اتقفل بشكل نظيف');
  }
}

// ======================================================
// تصدير الـ keys عشان لو احتجنا نستخدمها بره
// ======================================================

export const redisKeys = keys;