// ======================================================
// ZERO PLUS GATEWAY — Configuration
// ملف الإعدادات المركزي لكل شيء في الـ Gateway
// ======================================================
//
// المسؤوليات:
// 1. قراءة كل متغيرات البيئة من ملف .env
// 2. وضع قيم افتراضية آمنة لو المتغير مش موجود
// 3. التحقق من صحة الإعدادات الحرجة (secrets, ports...)
// 4. تصدير object واحد منظم يُستخدم في كل الملفات
//
// أي ملف تاني بيستورد منه كده:
//   import { config } from '../config';
//
// ======================================================

import dotenv from 'dotenv';
import path from 'path';

// تحميل ملف .env من جذر المشروع
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ======================================================
// Helper Functions
// ======================================================

/**
 * بيجيب متغير بيئة ويحوله لرقم.
 * لو مش موجود أو مش رقم → بيرجع القيمة الافتراضية.
 */
function envNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * بيجيب متغير بيئة ويحوله لـ boolean.
 * بيقبل: true / 1 / yes / on
 */
function envBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * بيجيب متغير بيئة كـ string.
 * لو مش موجود → بيرجع القيمة الافتراضية.
 */
function envString(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
}

/**
 * بيتأكد إن السر مش فاضي ومش القيمة الافتراضية الضعيفة.
 * بيطبع تحذير لو لقى حاجة ضعيفة (مش بيوقف السيرفر).
 */
function assertStrongSecret(name: string, value: string, minLength = 16): void {
  if (!value || value.length < minLength) {
    console.warn(
      `[CONFIG WARNING] ${name} ضعيف جدًا أو فاضي (الطول الحالي: ${value?.length || 0}). ` +
        `يُفضل استخدام مفتاح عشوائي قوي بطول ${minLength}+ حرف.`
    );
  }
}

// ======================================================
// Server Configuration
// ======================================================

const server = {
  /** البورت اللي الـ Gateway هيستمع عليه */
  port: envNumber('PORT', 3000),

  /** العنوان اللي هيستمع عليه (0.0.0.0 = كل الواجهات) */
  host: envString('HOST', '0.0.0.0'),

  /** بيئة التشغيل: development | production | test */
  nodeEnv: envString('NODE_ENV', 'development') as 'development' | 'production' | 'test',

  /** هل إحنا في وضع التطوير؟ */
  isDev: envString('NODE_ENV', 'development') !== 'production',

  /** هل إحنا في وضع الإنتاج؟ */
  isProd: envString('NODE_ENV', 'development') === 'production',
};

// ======================================================
// Redis Configuration
// ======================================================

const redis = {
  /**
   * رابط Redis الكامل.
   * مثال: redis://localhost:6379
   * أو مع باسورد: redis://:password@localhost:6379
   */
  url: envString('REDIS_URL', 'redis://localhost:6379'),

  /** أقصى عدد اتصالات في الـ pool */
  maxRetriesPerRequest: envNumber('REDIS_MAX_RETRIES', 3),

  /** مدة الانتظار قبل إعادة المحاولة (ms) */
  retryDelayMs: envNumber('REDIS_RETRY_DELAY_MS', 200),

  /** مفتاح بادئة لكل المفاتيح عشان ما تتداخلش مع خدمات تانية */
  keyPrefix: envString('REDIS_KEY_PREFIX', 'zp:gw:'),
};

// ======================================================
// Backend Service (الـ Backend الإداري بتاعنا)
// ======================================================

const backend = {
  /** عنوان الـ Backend (Fastify) */
  url: envString('BACKEND_URL', 'http://localhost:4000'),

  /**
   * السر المشترك بين الـ Gateway والـ Backend.
   * بيستخدم في التحقق من الطلبات الداخلية (Internal API).
   */
  internalSecret: envString(
    'GATEWAY_INTERNAL_SECRET',
    'zp_gw_8f3a2c1e9b0d4f6a7c8e1b2d3f4a5c6e7b8d9f0a1c2e3b4d5f6a7c8e9b0d1f2'
  ),

  /** timeout للطلبات اللي بتروح للـ Backend (ms) */
  timeoutMs: envNumber('BACKEND_TIMEOUT_MS', 5000),
};

// ======================================================
// AI Service
// ======================================================

const ai = {
  /** عنوان خدمة الـ AI (Python + FastAPI + River) */
  url: envString('AI_URL', 'http://localhost:8000'),

  /** timeout لتحليل الـ AI (ms) — لازم يكون قصير عشان ما يبطّأش الطلب */
  timeoutMs: envNumber('AI_TIMEOUT_MS', 12000),

  /**
   * مدة كاش نتيجة الـ AI لكل (orgId + ip) بالثواني.
   * حسب الدوسيه: TTL 10 ثواني.
   */
  cacheTtlSeconds: envNumber('AI_CACHE_TTL_SECONDS', 10),

  /** هل نفعّل استدعاء الـ AI أصلًا؟ (ممكن نطفيه في التطوير) */
  enabled: envBoolean('AI_ENABLED', true),
};

// ======================================================
// Clearance Cookie (تصريح المرور الموقع)
// ======================================================

const clearance = {
  /**
   * السر اللي بنوقع بيه الـ Clearance Cookie (HMAC).
   * لازم يكون قوي جدًا وما يتغيرش بسهولة.
   */
  secret: envString('CLEARANCE_SECRET', 'zeroplusgateway2024secretkey9999'),

  /**
   * مدة صلاحية التصريح بالثواني.
   * بعد المدة دي لازم الزائر يعمل challenge تاني.
   */
  ttlSeconds: envNumber('CLEARANCE_TTL_SECONDS', 1800), // 30 دقيقة

  /** اسم الكوكي */
  cookieName: envString('CLEARANCE_COOKIE_NAME', '__zp_clearance'),

  /** هل الكوكي HttpOnly؟ (مستحسن true) */
  httpOnly: envBoolean('CLEARANCE_HTTP_ONLY', true),

  /** هل الكوكي Secure؟ (في الإنتاج لازم true) */
  secure: envBoolean('CLEARANCE_SECURE', server.isProd),

  /** SameSite */
  sameSite: envString('CLEARANCE_SAME_SITE', 'Lax') as 'Strict' | 'Lax' | 'None',
};

// ======================================================
// Origin Probe (اختبار سيرفر العميل)
// ======================================================

const originProbe = {
  /**
   * عنوان الـ Origin الافتراضي (للتطوير فقط).
   * في الإنتاج كل منظمة ليها Origin خاص بيها من الـ Backend.
   */
  defaultOriginUrl: envString('ORIGIN_URL', 'http://localhost:5000'),

  /** timeout لطلب الـ Health Check (ms) */
  healthTimeoutMs: envNumber('ORIGIN_HEALTH_TIMEOUT_MS', 3000),

  /** عدد الطلبات اللي بنعملها في اختبار الـ Load الخفيف */
  loadTestRequests: envNumber('ORIGIN_LOAD_TEST_REQUESTS', 20),

  /** المدة القصوى لاختبار الـ Load (ms) */
  loadTestMaxDurationMs: envNumber('ORIGIN_LOAD_TEST_MAX_DURATION_MS', 5000),

  /** الفاصل بين كل اختبار Origin تلقائي (بالثواني) */
  probeIntervalSeconds: envNumber('ORIGIN_PROBE_INTERVAL_SECONDS', 300), // كل 5 دقايق
};

// ======================================================
// Risk Engine Defaults
// ======================================================

const risk = {
  /**
   * الأوزان الافتراضية لمكونات الـ Risk Score.
   * تقدر تتعدل لكل منظمة من خلال الـ Policy.
   */
  weights: {
    ip: envNumber('RISK_WEIGHT_IP', 15),
    rate: envNumber('RISK_WEIGHT_RATE', 25),
    ja4: envNumber('RISK_WEIGHT_JA4', 10),
    fingerprint: envNumber('RISK_WEIGHT_FINGERPRINT', 10),
    ai: envNumber('RISK_WEIGHT_AI', 30),
    path: envNumber('RISK_WEIGHT_PATH', 10),
    history: envNumber('RISK_WEIGHT_HISTORY', 20),
  },

  /**
   * الحدود الافتراضية للقرار (قابلة للتعديل لكل منظمة).
   * 0-30   → ALLOW
   * 31-60  → RATE_LIMIT / MONITOR
   * 61-80  → CHALLENGE
   * 81-100 → BLOCK
   */
  thresholds: {
    allow: envNumber('RISK_THRESHOLD_ALLOW', 30),
    rateLimit: envNumber('RISK_THRESHOLD_RATE_LIMIT', 60),
    challenge: envNumber('RISK_THRESHOLD_CHALLENGE', 80),
  },
};

// ======================================================
// Rate Limiting & Ban Defaults
// ======================================================

const rateLimit = {
  /** عدد الطلبات المسموح بها في النافذة الزمنية (للـ IP العادي) */
  windowRequests: envNumber('RATE_LIMIT_WINDOW_REQUESTS', 60),

  /** طول النافذة الزمنية بالثواني */
  windowSeconds: envNumber('RATE_LIMIT_WINDOW_SECONDS', 60),

  /** مدة الحظر القصيرة (بالثواني) — فشل JS بسيط */
  shortBanSeconds: envNumber('BAN_SHORT_SECONDS', 7200), // ساعتين

  /** مدة الحظر المتوسطة (بالثواني) — فشل متقدم */
  mediumBanSeconds: envNumber('BAN_MEDIUM_SECONDS', 86400), // 24 ساعة

  /** هل الحظر يكون على (IP + Device Fingerprint) ولا IP لوحده؟ */
  banByDevice: envBoolean('BAN_BY_DEVICE', true),
};

// ======================================================
// Reputation System
// ======================================================

const reputation = {
  /**
   * نقاط السمعة المتدرجة (حسب الدوسيه):
   * فشل JS بسيط     → +1
   * فشل متقدم       → +3
   * بصمة في المناعة → +5
   * سمعة 9-10       → حظر دائم
   */
  points: {
    jsFailSimple: envNumber('REP_POINTS_JS_SIMPLE', 1),
    advancedFail: envNumber('REP_POINTS_ADVANCED', 3),
    collectiveFingerprint: envNumber('REP_POINTS_COLLECTIVE', 5),
  },

  /** عند الوصول للدرجة دي → حظر دائم */
  permanentBanThreshold: envNumber('REP_PERMANENT_THRESHOLD', 9),
};

// ======================================================
// Challenge Settings
// ======================================================

const challenge = {
  /** مدة صلاحية توكن الـ Challenge (ثواني) */
  tokenTtlSeconds: envNumber('CHALLENGE_TOKEN_TTL_SECONDS', 120),

  /** أقصى وقت انتظار لإجابة الـ JS Challenge (ثواني) */
  jsTimeoutSeconds: envNumber('CHALLENGE_JS_TIMEOUT_SECONDS', 8),

  /** هل نسمح بتمرير الطلب لو الـ JS Challenge اتعطل (timeout)؟ */
  allowOnJsTimeout: envBoolean('CHALLENGE_ALLOW_ON_TIMEOUT', true),
};

// ======================================================
// Logging & Observability
// ======================================================

const logging = {
  /** مستوى اللوج: fatal | error | warn | info | debug | trace */
  level: envString('LOG_LEVEL', server.isDev ? 'debug' : 'info'),

  /** هل نسجل كل الطلبات (حتى الـ ALLOW)؟ */
  logAllRequests: envBoolean('LOG_ALL_REQUESTS', server.isDev),

  /** هل نبعت الـ Security Events للـ Backend فورًا؟ */
  sendEventsToBackend: envBoolean('SEND_EVENTS_TO_BACKEND', true),
};

// ======================================================
// Security Headers & Nginx Integration
// ======================================================

const security = {
  /**
   * اسم الهيدر اللي Nginx بيبعت فيه الـ JA4 fingerprint.
   * الـ Gateway بيمسح أي هيدر بنفس الاسم جاي من الزائر (منع التزوير).
   */
  ja4HeaderName: envString('JA4_HEADER_NAME', 'x-ja4'),

  /** اسم هيدر الـ JA3 (لو موجود) */
  ja3HeaderName: envString('JA3_HEADER_NAME', 'x-ja3'),

  /** اسم هيدر الـ Real IP (من Nginx) */
  realIpHeaderName: envString('REAL_IP_HEADER_NAME', 'x-real-ip'),

  /** اسم هيدر الـ Forwarded For */
  forwardedForHeaderName: envString('FORWARDED_FOR_HEADER_NAME', 'x-forwarded-for'),
};

// ======================================================
// Validation عند التشغيل
// ======================================================

function validateConfig(): void {
  assertStrongSecret('CLEARANCE_SECRET', clearance.secret, 24);
  assertStrongSecret('GATEWAY_INTERNAL_SECRET', backend.internalSecret, 32);

  if (server.port < 1 || server.port > 65535) {
    throw new Error(`[CONFIG ERROR] PORT غير صالح: ${server.port}`);
  }

  if (!backend.url.startsWith('http')) {
    throw new Error(`[CONFIG ERROR] BACKEND_URL لازم يبدأ بـ http أو https`);
  }

  if (!ai.url.startsWith('http')) {
    throw new Error(`[CONFIG ERROR] AI_URL لازم يبدأ بـ http أو https`);
  }

  console.log('[CONFIG] Configuration loaded successfully');
  console.log(`[CONFIG] Environment : ${server.nodeEnv}`);
  console.log(`[CONFIG] Gateway Port: ${server.port}`);
  console.log(`[CONFIG] Redis URL   : ${redis.url}`);
  console.log(`[CONFIG] Backend URL : ${backend.url}`);
  console.log(`[CONFIG] AI URL      : ${ai.url}`);
}

// ننفذ التحقق فور تحميل الملف
validateConfig();

// ======================================================
// التصدير النهائي
// ======================================================

export const config = {
  server,
  redis,
  backend,
  ai,
  clearance,
  originProbe,
  risk,
  rateLimit,
  reputation,
  challenge,
  logging,
  security,
} as const;

// عشان لو حد حب يستورد حاجة معينة مباشرة
export type Config = typeof config;

export default config;