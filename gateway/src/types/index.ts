// ======================================================
// ZERO PLUS GATEWAY — Types
// كل الأنواع المشتركة بين ملفات الـ Gateway
// ======================================================

// ------ الإشارات الخام اللي بتيجي مع كل طلب ------
export interface Signals {
  host: string;
  ip: string;                        // IP الزائر
  ja4: string | null;                // JA4 fingerprint من Nginx header
  ja3: string | null;                // JA3 fingerprint (TLS)
  deviceFingerprint: string | null;  // بصمة الجهاز (cookie/header)
  path: string;                      // المسار المطلوب /login /api/...
  method: string;                    // GET POST PUT DELETE
  orgId: string;                     // الشركة المستهدفة
  userAgent: string | null;          // User-Agent header
  requestSize: number;               // حجم الطلب بالـ bytes
  timestamp: number;                 // وقت الطلب Unix ms
  hasClearance: boolean;             // عنده clearance cookie صالح؟
  clearanceToken: string | null;     // التوكن نفسه لو موجود
}

// ------ مكونات الـ Risk Score ------
export interface RiskComponents {
  ipScore: number;          // سمعة الـ IP  (0–30)
  rateScore: number;        // معدل الطلبات (0–25)
  ja4Score: number;         // بصمة TLS مشبوهة (0–15)
  fingerprintScore: number; // بصمة الجهاز (0–15)
  aiScore: number;          // شذوذ من AI Service (0–30)
  pathScore: number;        // حساسية المسار (0–10)
  historyScore: number;     // سجل سابق في Redis (0–20)
}

// ------ نتيجة محرك المخاطر ------
export interface RiskResult {
  score: number;            // المجموع 0–100
  components: RiskComponents;
  reasons: string[];        // أسباب بشرية للـ logging
}

// ------ القرار النهائي ------
export type DecisionAction = 'ALLOW' | 'RATE_LIMIT' | 'CHALLENGE' | 'BLOCK';

export type ChallengeType = 'JS_SILENT' | 'FINGERPRINT' | 'JA4';

export interface Decision {
  action: DecisionAction;
  challengeType?: ChallengeType;  // لو action = CHALLENGE
  reason: string;                 // سبب القرار للـ logging
  score: number;                  // الـ Risk Score
  riskComponents: RiskComponents;
}

// ------ السمعة من Backend/Redis ------
export interface ReputationEntry {
  ip: string;
  score: number;            // 0–10
  bannedUntil: number | null; // Unix ms أو null
  isPermanent: boolean;
  points: number;           // نقاط متراكمة
}

// ------ الـ Context الكامل للطلب ------
export interface RequestContext {
  id: string;               // UUID لكل طلب
  signals: Signals;
  reputation: ReputationEntry | null;
  riskResult: RiskResult | null;
  decision: Decision | null;
  startTime: number;        // لحساب وقت المعالجة
}

// ------ السياسة الخاصة بكل شركة ------
export interface OrgPolicy {
  orgId: string;
  allowThreshold: number;       // default: 30
  rateLimitThreshold: number;   // default: 60
  challengeThreshold: number;   // default: 80
  // blockThreshold = ما فوق challengeThreshold
  customRules: PolicyRule[];
}

export interface PolicyRule {
  field: keyof Signals;
  operator: 'eq' | 'contains' | 'gt' | 'lt';
  value: string | number;
  action: DecisionAction;
}

// ------ رد AI Service ------
export interface AIAnalysisResult {
  orgId: string;
  anomalyScore: number;     // 0–1
  surgeDetected: boolean;
  pathSensitivity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendation: DecisionAction;
}

// ------ Security Event للـ logging ------
export interface SecurityEvent {
  requestId: string;
  orgId: string;
  ip: string;
  ja4: string | null;
  ja3: string | null;
  deviceFingerprint: string | null;
  path: string;
  method: string;
  action: DecisionAction;
  score: number;
  riskComponents: RiskComponents;
  reasons: string[];
  timestamp: number;
  processingTimeMs: number;
}

// ------ Clearance Cookie ------
export interface ClearancePayload {
  ip: string;
  deviceFingerprint: string;
  orgId: string;
  issuedAt: number;
  expiresAt: number;
}

// ------ Ban في Redis ------
export interface BanEntry {
  ip: string;
  deviceFingerprint: string | null;
  bannedUntil: number;      // Unix ms
  isPermanent: boolean;
  reason: string;
}