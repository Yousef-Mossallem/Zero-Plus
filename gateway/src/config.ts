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

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ======================================================
// Helper Functions
// ======================================================

function envNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function envBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function envString(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
}

function assertStrongSecret(name: string, value: string, minLength = 16): void {
  if (!value || value.length < minLength) {
    console.warn(
      `[CONFIG WARNING] ${name} ضعيف جدًا أو فاضي (الطول الحالي: ${value?.length || 0}). ` +
        `يُفضل استخدام مفتاح عشوائي قوي بطول ${minLength}+ حرف.`,
    );
  }
}

// ======================================================
// Server Configuration
// ======================================================

const server = {
  port: envNumber('PORT', 3000),
  host: envString('HOST', '0.0.0.0'),
  nodeEnv: envString('NODE_ENV', 'development') as
    | 'development'
    | 'production'
    | 'test',
  isDev: envString('NODE_ENV', 'development') !== 'production',
  isProd: envString('NODE_ENV', 'development') === 'production',
};

// ======================================================
// Redis Configuration
// ======================================================

const redis = {
  url: envString('REDIS_URL', 'redis://localhost:6379'),
  maxRetriesPerRequest: envNumber('REDIS_MAX_RETRIES', 3),
  retryDelayMs: envNumber('REDIS_RETRY_DELAY_MS', 200),
  keyPrefix: envString('REDIS_KEY_PREFIX', 'zp:gw:'),
};

// ======================================================
// Backend Service
// ======================================================

const backend = {
  url: envString('BACKEND_URL', 'http://localhost:4000'),
  internalSecret: envString(
    'GATEWAY_INTERNAL_SECRET',
    'zp_gw_8f3a2c1e9b0d4f6a7c8e1b2d3f4a5c6e7b8d9f0a1c2e3b4d5f6a7c8e9b0d1f2',
  ),
  timeoutMs: envNumber('BACKEND_TIMEOUT_MS', 5000),
};

// ======================================================
// AI Service
// ======================================================

const ai = {
  url: envString('AI_URL', 'http://localhost:8000'),
  timeoutMs: envNumber('AI_TIMEOUT_MS', 12000),
  cacheTtlSeconds: envNumber('AI_CACHE_TTL_SECONDS', 10),
  enabled: envBoolean('AI_ENABLED', true),
};

// ======================================================
// Clearance Cookie
// ======================================================

const clearance = {
  secret: envString('CLEARANCE_SECRET', 'zeroplusgateway2024secretkey9999'),
  ttlSeconds: envNumber('CLEARANCE_TTL_SECONDS', 1800),
  cookieName: envString('CLEARANCE_COOKIE_NAME', '__zp_clearance'),
  httpOnly: envBoolean('CLEARANCE_HTTP_ONLY', true),
  secure: envBoolean('CLEARANCE_SECURE', server.isProd),
  sameSite: envString('CLEARANCE_SAME_SITE', 'Lax') as
    | 'Strict'
    | 'Lax'
    | 'None',
};

// ======================================================
// Origin Probe
// ======================================================

const originProbe = {
  defaultOriginUrl: envString('ORIGIN_URL', 'http://localhost:5000'),
  healthTimeoutMs: envNumber('ORIGIN_HEALTH_TIMEOUT_MS', 3000),
  loadTestRequests: envNumber('ORIGIN_LOAD_TEST_REQUESTS', 20),
  loadTestMaxDurationMs: envNumber('ORIGIN_LOAD_TEST_MAX_DURATION_MS', 5000),
  probeIntervalSeconds: envNumber('ORIGIN_PROBE_INTERVAL_SECONDS', 300),
};

// ======================================================
// Risk Engine Defaults
// ======================================================

const risk = {
  weights: {
    ip: envNumber('RISK_WEIGHT_IP', 15),
    rate: envNumber('RISK_WEIGHT_RATE', 25),
    ja4: envNumber('RISK_WEIGHT_JA4', 10),
    fingerprint: envNumber('RISK_WEIGHT_FINGERPRINT', 10),
    ai: envNumber('RISK_WEIGHT_AI', 30),
    path: envNumber('RISK_WEIGHT_PATH', 10),
    history: envNumber('RISK_WEIGHT_HISTORY', 20),
  },
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
  windowRequests: envNumber('RATE_LIMIT_WINDOW_REQUESTS', 60),
  windowSeconds: envNumber('RATE_LIMIT_WINDOW_SECONDS', 60),
  shortBanSeconds: envNumber('BAN_SHORT_SECONDS', 7200),
  mediumBanSeconds: envNumber('BAN_MEDIUM_SECONDS', 86400),
  banByDevice: envBoolean('BAN_BY_DEVICE', true),
};

// ======================================================
// Reputation System
// ======================================================

const reputation = {
  points: {
    jsFailSimple: envNumber('REP_POINTS_JS_SIMPLE', 1),
    advancedFail: envNumber('REP_POINTS_ADVANCED', 3),
    collectiveFingerprint: envNumber('REP_POINTS_COLLECTIVE', 5),
  },
  permanentBanThreshold: envNumber('REP_PERMANENT_THRESHOLD', 9),
};

// ======================================================
// Challenge Settings
// ======================================================

const challenge = {
  tokenTtlSeconds: envNumber('CHALLENGE_TOKEN_TTL_SECONDS', 120),
  jsTimeoutSeconds: envNumber('CHALLENGE_JS_TIMEOUT_SECONDS', 8),
  allowOnJsTimeout: envBoolean('CHALLENGE_ALLOW_ON_TIMEOUT', true),
};

// ======================================================
// Simulation Lab (Backend Worker → Gateway)
// السر يجب أن يطابق Backend: SIMULATION_TOKEN_SECRET أو GATEWAY_SECRET
// ======================================================

const simulation = {
  /**
   * تفعيل مسار المحاكاة الموثوق.
   * في الإنتاج: true فقط إذا نفس النود يستقبل Worker داخلي.
   */
  enabled: envBoolean('SIMULATION_ENABLED', !server.isProd || envBoolean('SIMULATION_ENABLED', false)),

  /**
   * سر HMAC لتوكن X-ZP-Simulation
   * الأولوية: SIMULATION_TOKEN_SECRET → GATEWAY_SECRET → GATEWAY_INTERNAL_SECRET
   */
  secret: envString(
    'SIMULATION_TOKEN_SECRET',
    envString(
      'GATEWAY_SECRET',
      envString(
        'GATEWAY_INTERNAL_SECRET',
        'zp_gw_8f3a2c1e9b0d4f6a7c8e1b2d3f4a5c6e7b8d9f0a1c2e3b4d5f6a7c8e9b0d1f2',
      ),
    ),
  ),

  /** تسامح الساعة عند التحقق من exp (ثواني) */
  clockSkewSec: envNumber('SIMULATION_CLOCK_SKEW_SEC', 30),

  /**
   * السماح بهيدر X-ZP-Sim-AI كبديل مؤقت لدرجة الـ AI
   * (فقط بعد توكن محاكاة صالح — منطق app/sim-auth)
   */
  allowSimAiHeader: envBoolean('SIMULATION_ALLOW_AI_HEADER', true),

  /**
   * السماح بـ X-ZP-Sim-JS = pass|fail|skip بدل تحدي HTML
   */
  allowSimJsDirective: envBoolean('SIMULATION_ALLOW_JS_DIRECTIVE', true),

  /**
   * السماح بـ X-ZP-Sim-Country كـ fallback لو geo lookup فشل
   */
  allowSimCountryHint: envBoolean('SIMULATION_ALLOW_COUNTRY_HINT', true),

  /** أسماء الهيدرز (لو حابب توحّدها مع Nginx لاحقًا) */
  headers: {
    token: envString('SIM_HEADER_TOKEN', 'x-zp-simulation'),
    runId: envString('SIM_HEADER_RUN', 'x-zp-sim-run'),
    js: envString('SIM_HEADER_JS', 'x-zp-sim-js'),
    ai: envString('SIM_HEADER_AI', 'x-zp-sim-ai'),
    persona: envString('SIM_HEADER_PERSONA', 'x-zp-sim-persona'),
    country: envString('SIM_HEADER_COUNTRY', 'x-zp-sim-country'),
  },
};

// ======================================================
// Logging & Observability
// ======================================================

const logging = {
  level: envString('LOG_LEVEL', server.isDev ? 'debug' : 'info'),
  logAllRequests: envBoolean('LOG_ALL_REQUESTS', server.isDev),
  sendEventsToBackend: envBoolean('SEND_EVENTS_TO_BACKEND', true),
};

// ======================================================
// Security Headers & Nginx Integration
// ======================================================

const security = {
  ja4HeaderName: envString('JA4_HEADER_NAME', 'x-ja4'),
  ja3HeaderName: envString('JA3_HEADER_NAME', 'x-ja3'),
  realIpHeaderName: envString('REAL_IP_HEADER_NAME', 'x-real-ip'),
  forwardedForHeaderName: envString(
    'FORWARDED_FOR_HEADER_NAME',
    'x-forwarded-for',
  ),
  /** توكن الحافة المتوقع في X-Edge-Server (محاكاة/إنتاج) */
  edgeServerToken: envString('ZP_EDGE_TOKEN', 'zeroplus-edge'),
};

// ======================================================
// Validation عند التشغيل
// ======================================================

function validateConfig(): void {
  assertStrongSecret('CLEARANCE_SECRET', clearance.secret, 24);
  assertStrongSecret('GATEWAY_INTERNAL_SECRET', backend.internalSecret, 32);

  if (simulation.enabled) {
    assertStrongSecret('SIMULATION_TOKEN_SECRET (or GATEWAY_SECRET)', simulation.secret, 16);
  }

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
  console.log(`[CONFIG] Simulation  : ${simulation.enabled ? 'enabled' : 'disabled'}`);
}

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
  simulation,
  logging,
  security,
} as const;

export type Config = typeof config;

export default config;