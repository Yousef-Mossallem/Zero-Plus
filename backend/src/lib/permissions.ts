/**
 * backend/src/lib/permissions.ts
 * ==================================================================
 * كتالوج الصلاحيات + حساب صلاحيات المستخدم
 *
 * المبدأ:
 *   - كل صلاحية = "resource:action"
 *   - الحساب يحصل مرة واحدة وقت إصدار JWT
 *   - jwt.plugin.ts هو المكان الوحيد اللي بيتفحص فيه
 *   - الموديولات الحالية مش محتاجة تتعدّل
 *
 * مصادر الصلاحيات (بالترتيب النهائي):
 *   1) دور النظام (OWNER = كل حاجة)
 *   2) مجموعات PermissionGroup (اتحاد)
 *   3) UserPermissionOverride (grant يضيف / deny يسحب)
 * ==================================================================
 */

import type { UserRole } from '@prisma/client'

// ------------------------------------------------------------------
// 1) كتالوج الصلاحيات الثابت
// ------------------------------------------------------------------

/**
 * كل صلاحية موجودة في النظام.
 * لو ضفت موديول جديد → زوّد هنا فقط.
 */
export const PERMISSION_CATALOG = [
  // Dashboard
  'dashboard:view',

  // Servers
  'servers:view',
  'servers:create',
  'servers:edit',
  'servers:delete',
  'servers:probe',          // Origin Probe
  'servers:enable-agent',   // تفعيل النفق / Agent

  // Events
  'events:view',
  'events:export',

  // Policies
  'policies:view',
  'policies:edit',

  // Reports
  'reports:view',
  'reports:create',
  'reports:delete',

  // Reputation
  'reputation:view',
  'reputation:ban',
  'reputation:allowlist',
  'reputation:edit',

  // Simulation Lab
  'simulation:view',
  'simulation:run',
  'simulation:stop',

  // Team & Members
  'team:view',
  'team:manage',            // دعوات + مجموعات + استثناءات

  // Settings / Organization
  'settings:view',
  'settings:edit',

  // Agents (داخلي / تشغيلي)
  'agents:view',
  'agents:manage',
] as const

export type Permission = (typeof PERMISSION_CATALOG)[number]

/** للتحقق السريع */
export const PERMISSION_SET = new Set<string>(PERMISSION_CATALOG)

export function isValidPermission(p: string): p is Permission {
  return PERMISSION_SET.has(p)
}

// ------------------------------------------------------------------
// 2) تسميات عربية/إنجليزية (للـ UI)
// ------------------------------------------------------------------

export const PERMISSION_LABELS: Record<
  Permission,
  { en: string; ar: string }
> = {
  'dashboard:view': { en: 'View Dashboard', ar: 'عرض لوحة التحكم' },

  'servers:view': { en: 'View Servers', ar: 'عرض السيرفرات' },
  'servers:create': { en: 'Add Servers', ar: 'إضافة سيرفرات' },
  'servers:edit': { en: 'Edit Servers', ar: 'تعديل السيرفرات' },
  'servers:delete': { en: 'Delete Servers', ar: 'حذف السيرفرات' },
  'servers:probe': { en: 'Run Origin Probe', ar: 'تشغيل فحص الأصل' },
  'servers:enable-agent': { en: 'Enable Agent / Tunnel', ar: 'تفعيل الوكيل / النفق' },

  'events:view': { en: 'View Events', ar: 'عرض الأحداث' },
  'events:export': { en: 'Export Events', ar: 'تصدير الأحداث' },

  'policies:view': { en: 'View Policies', ar: 'عرض السياسات' },
  'policies:edit': { en: 'Edit Policies', ar: 'تعديل السياسات' },

  'reports:view': { en: 'View Reports', ar: 'عرض التقارير' },
  'reports:create': { en: 'Create Reports', ar: 'إنشاء تقارير' },
  'reports:delete': { en: 'Delete Reports', ar: 'حذف التقارير' },

  'reputation:view': { en: 'View Reputation', ar: 'عرض السمعة' },
  'reputation:ban': { en: 'Ban / Unban IPs', ar: 'حظر / فك حظر عناوين' },
  'reputation:allowlist': { en: 'Manage Allowlist', ar: 'إدارة القائمة البيضاء' },
  'reputation:edit': { en: 'Edit Reputation Entries', ar: 'تعديل سجلات السمعة' },

  'simulation:view': { en: 'View Simulations', ar: 'عرض المحاكاة' },
  'simulation:run': { en: 'Start Simulations', ar: 'تشغيل المحاكاة' },
  'simulation:stop': { en: 'Stop Simulations', ar: 'إيقاف المحاكاة' },

  'team:view': { en: 'View Team', ar: 'عرض الفريق' },
  'team:manage': { en: 'Manage Team & Groups', ar: 'إدارة الفريق والمجموعات' },

  'settings:view': { en: 'View Settings', ar: 'عرض الإعدادات' },
  'settings:edit': { en: 'Edit Settings', ar: 'تعديل الإعدادات' },

  'agents:view': { en: 'View Agents', ar: 'عرض الوكلاء' },
  'agents:manage': { en: 'Manage Agents', ar: 'إدارة الوكلاء' },
}

// ------------------------------------------------------------------
// 3) مجموعات صلاحيات جاهزة (Templates)
// تُستخدم عند إنشاء PermissionGroup افتراضية للمنظمة
// ------------------------------------------------------------------

export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, Permission[]> = {
  // المالك = كل شيء
  OWNER: [...PERMISSION_CATALOG],

  // أدمن = كل شيء ما عدا بعض إعدادات المنظمة الحساسة (ممكن تضيّق لاحقًا)
  ADMIN: [
    'dashboard:view',
    'servers:view',
    'servers:create',
    'servers:edit',
    'servers:delete',
    'servers:probe',
    'servers:enable-agent',
    'events:view',
    'events:export',
    'policies:view',
    'policies:edit',
    'reports:view',
    'reports:create',
    'reports:delete',
    'reputation:view',
    'reputation:ban',
    'reputation:allowlist',
    'reputation:edit',
    'simulation:view',
    'simulation:run',
    'simulation:stop',
    'team:view',
    'team:manage',
    'settings:view',
    'settings:edit',
    'agents:view',
    'agents:manage',
  ],

  // محلل = قراءة + محاكاة + تقارير
  ANALYST: [
    'dashboard:view',
    'servers:view',
    'events:view',
    'events:export',
    'policies:view',
    'reports:view',
    'reports:create',
    'reputation:view',
    'simulation:view',
    'simulation:run',
    'simulation:stop',
    'team:view',
    'agents:view',
  ],

  // مشاهد = قراءة فقط
  VIEWER: [
    'dashboard:view',
    'servers:view',
    'events:view',
    'policies:view',
    'reports:view',
    'reputation:view',
    'simulation:view',
    'team:view',
    'agents:view',
  ],
}

/** مجموعات نظام جاهزة (isSystem = true) */
export const SYSTEM_GROUP_TEMPLATES: {
  name: string
  description: string
  permissions: Permission[]
}[] = [
  {
    name: 'Full Access',
    description: 'كامل الصلاحيات (مثل المالك)',
    permissions: [...PERMISSION_CATALOG],
  },
  {
    name: 'Admin',
    description: 'إدارة كاملة تقريبًا',
    permissions: ROLE_DEFAULT_PERMISSIONS.ADMIN,
  },
  {
    name: 'Analyst',
    description: 'تحليل ومراقبة وتشغيل محاكاة',
    permissions: ROLE_DEFAULT_PERMISSIONS.ANALYST,
  },
  {
    name: 'Read Only',
    description: 'عرض فقط بدون تعديل',
    permissions: ROLE_DEFAULT_PERMISSIONS.VIEWER,
  },
  {
    name: 'Servers Only',
    description: 'إدارة السيرفرات فقط',
    permissions: [
      'dashboard:view',
      'servers:view',
      'servers:create',
      'servers:edit',
      'servers:delete',
      'servers:probe',
      'servers:enable-agent',
      'agents:view',
      'agents:manage',
    ],
  },
  {
    name: 'Security Ops',
    description: 'أحداث + سمعة + سياسات',
    permissions: [
      'dashboard:view',
      'events:view',
      'events:export',
      'reputation:view',
      'reputation:ban',
      'reputation:allowlist',
      'reputation:edit',
      'policies:view',
      'policies:edit',
      'reports:view',
      'reports:create',
    ],
  },
]

// ------------------------------------------------------------------
// 4) أنواع مساعدة للحساب
// ------------------------------------------------------------------

export interface PermissionSourceGroup {
  permissions: string[]
}

export interface PermissionOverride {
  permission: string
  isDeny: boolean
}

export interface ComputePermissionsInput {
  /** دور المستخدم في المنظمة */
  role: UserRole
  /** مجموعاته */
  groups?: PermissionSourceGroup[]
  /** استثناءات فردية */
  overrides?: PermissionOverride[]
}

// ------------------------------------------------------------------
// 5) الدالة الأساسية — حساب الصلاحيات النهائية
// ------------------------------------------------------------------

/**
 * يحسب قائمة الصلاحيات النهائية لمستخدم.
 * تُستدعى وقت إصدار JWT فقط.
 */
export function computeUserPermissions(
  input: ComputePermissionsInput,
): Permission[] {
  const { role, groups = [], overrides = [] } = input

  // 1) OWNER = كل شيء مباشرة
  if (role === 'OWNER') {
    return [...PERMISSION_CATALOG]
  }

  const granted = new Set<string>()
  const denied = new Set<string>()

  // 2) صلاحيات الدور الافتراضية (أساس)
  for (const p of ROLE_DEFAULT_PERMISSIONS[role] ?? []) {
    granted.add(p)
  }

  // 3) اتحاد صلاحيات المجموعات
  for (const g of groups) {
    for (const p of g.permissions ?? []) {
      if (isValidPermission(p)) {
        granted.add(p)
      }
    }
  }

  // 4) تطبيق الاستثناءات
  for (const o of overrides) {
    if (!isValidPermission(o.permission)) continue
    if (o.isDeny) {
      denied.add(o.permission)
      granted.delete(o.permission)
    } else {
      // grant إضافي
      granted.add(o.permission)
      denied.delete(o.permission)
    }
  }

  // 5) النتيجة النهائية (مرتبة حسب الكتالوج)
  return PERMISSION_CATALOG.filter(
    (p) => granted.has(p) && !denied.has(p),
  )
}

/**
 * هل المستخدم يملك صلاحية معينة؟
 * (للاستخدام داخل jwt.plugin أو في الـ service لو احتجت)
 */
export function hasPermission(
  userPermissions: string[] | Set<string> | undefined | null,
  required: Permission | Permission[],
): boolean {
  if (!userPermissions) return false
  const set =
    userPermissions instanceof Set
      ? userPermissions
      : new Set(userPermissions)

  const list = Array.isArray(required) ? required : [required]
  return list.every((p) => set.has(p))
}

/**
 * هل يملك أي صلاحية من القائمة؟ (OR)
 */
export function hasAnyPermission(
  userPermissions: string[] | Set<string> | undefined | null,
  required: Permission[],
): boolean {
  if (!userPermissions || required.length === 0) return false
  const set =
    userPermissions instanceof Set
      ? userPermissions
      : new Set(userPermissions)
  return required.some((p) => set.has(p))
}

// ------------------------------------------------------------------
// 6) خريطة Route → Permission (لـ jwt.plugin.ts)
// ------------------------------------------------------------------

/**
 * شكل مبسّط: method + path pattern → صلاحية مطلوبة
 * jwt.plugin هيستخدمها بعد authenticate.
 *
 * ملاحظات:
 * - أكثر من صلاحية = لازم كلها (AND)
 * - لو المسار مش موجود هنا → مسموح لأي مستخدم موثّق (أو ارفض حسب سياستك)
 */
export type RoutePermissionRule = {
  method: string | string[]
  /** يبدأ بـ /api/ عادة */
  path: RegExp
  permissions: Permission[]
  /** true = يكفي صلاحية واحدة من القائمة */
  anyOf?: boolean
}

export const ROUTE_PERMISSION_RULES: RoutePermissionRule[] = [
  // Dashboard
  {
    method: 'GET',
    path: /^\/api\/dashboard(\/|$)/i,
    permissions: ['dashboard:view'],
  },

  // Servers
  {
    method: 'GET',
    path: /^\/api\/servers(\/|$)/i,
    permissions: ['servers:view'],
  },
  {
    method: 'POST',
    path: /^\/api\/servers\/?$/i,
    permissions: ['servers:create'],
  },
  {
    method: ['PUT', 'PATCH'],
    path: /^\/api\/servers\/[^/]+$/i,
    permissions: ['servers:edit'],
  },
  {
    method: 'DELETE',
    path: /^\/api\/servers\/[^/]+$/i,
    permissions: ['servers:delete'],
  },
  {
    method: 'POST',
    path: /^\/api\/servers\/[^/]+\/probe/i,
    permissions: ['servers:probe'],
  },
  {
    method: 'POST',
    path: /^\/api\/servers\/[^/]+\/enable-agent/i,
    permissions: ['servers:enable-agent'],
  },

  // Events
  {
    method: 'GET',
    path: /^\/api\/events(\/|$)/i,
    permissions: ['events:view'],
  },
  {
    method: 'GET',
    path: /^\/api\/events\/export/i,
    permissions: ['events:export'],
  },

  // Policies
  {
    method: 'GET',
    path: /^\/api\/policies(\/|$)/i,
    permissions: ['policies:view'],
  },
  {
    method: ['PUT', 'PATCH'],
    path: /^\/api\/policies(\/|$)/i,
    permissions: ['policies:edit'],
  },

  // Reports
  {
    method: 'GET',
    path: /^\/api\/reports(\/|$)/i,
    permissions: ['reports:view'],
  },
  {
    method: 'POST',
    path: /^\/api\/reports(\/|$)/i,
    permissions: ['reports:create'],
  },
  {
    method: 'DELETE',
    path: /^\/api\/reports\/[^/]+$/i,
    permissions: ['reports:delete'],
  },

  // Reputation
  {
    method: 'GET',
    path: /^\/api\/reputation(\/|$)/i,
    permissions: ['reputation:view'],
  },
  {
    method: 'POST',
    path: /^\/api\/reputation\/.*ban/i,
    permissions: ['reputation:ban'],
  },
  {
    method: ['POST', 'PUT', 'PATCH'],
    path: /^\/api\/reputation\/.*allowlist/i,
    permissions: ['reputation:allowlist'],
  },
  {
    method: ['PUT', 'PATCH'],
    path: /^\/api\/reputation\/[^/]+$/i,
    permissions: ['reputation:edit'],
  },

  // Simulation
  {
    method: 'GET',
    path: /^\/api\/simulations?(\/|$)/i,
    permissions: ['simulation:view'],
  },
  {
    method: 'POST',
    path: /^\/api\/simulations?(\/|$)/i,
    permissions: ['simulation:run'],
  },
  {
    method: ['POST', 'PUT'],
    path: /^\/api\/simulations?\/[^/]+\/stop/i,
    permissions: ['simulation:stop'],
  },

  // Team
  {
    method: 'GET',
    path: /^\/api\/team(\/|$)/i,
    permissions: ['team:view'],
  },
  {
    method: ['POST', 'PUT', 'PATCH', 'DELETE'],
    path: /^\/api\/team(\/|$)/i,
    permissions: ['team:manage'],
  },

  // Settings
  {
    method: 'GET',
    path: /^\/api\/settings(\/|$)/i,
    permissions: ['settings:view'],
  },
  {
    method: ['PUT', 'PATCH'],
    path: /^\/api\/settings(\/|$)/i,
    permissions: ['settings:edit'],
  },

  // Agents (إدارة من الداشبورد)
  {
    method: 'GET',
    path: /^\/api\/agents(\/|$)/i,
    permissions: ['agents:view'],
  },
  {
    method: ['POST', 'PUT', 'PATCH', 'DELETE'],
    path: /^\/api\/agents(\/|$)/i,
    permissions: ['agents:manage'],
  },
]

/**
 * يرجّع الصلاحيات المطلوبة لمسار معيّن (أو null لو مفيش قاعدة)
 */
export function matchRoutePermissions(
  method: string,
  path: string,
): { permissions: Permission[]; anyOf: boolean } | null {
  const m = method.toUpperCase()
  const cleanPath = path.split('?')[0] || path

  for (const rule of ROUTE_PERMISSION_RULES) {
    const methods = Array.isArray(rule.method)
      ? rule.method.map((x) => x.toUpperCase())
      : [rule.method.toUpperCase()]

    if (!methods.includes(m)) continue
    if (!rule.path.test(cleanPath)) continue

    return {
      permissions: rule.permissions,
      anyOf: rule.anyOf === true,
    }
  }
  return null
}

// ------------------------------------------------------------------
// 7) تصدير موحّد
// ------------------------------------------------------------------

export default {
  PERMISSION_CATALOG,
  PERMISSION_SET,
  PERMISSION_LABELS,
  ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_GROUP_TEMPLATES,
  ROUTE_PERMISSION_RULES,
  isValidPermission,
  computeUserPermissions,
  hasPermission,
  hasAnyPermission,
  matchRoutePermissions,
}