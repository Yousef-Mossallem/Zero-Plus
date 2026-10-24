// ======================================================
// ZERO PLUS GATEWAY — Proxy Orchestrator
// الحارس الأخير قبل تمرير الطلب للسيرفر الأصلي
// ======================================================
//
// المسؤوليات:
// 1. (اختياري) التحقق من كوكي الـ clearance قبل التمرير
// 2. تمرير الطلب للـ Origin عن طريق forwardToOrigin
// 3. إرجاع نتيجة موحّدة (ProxyOutcome) للـ app.ts والـ logging
//
// قواعد:
// - الملف ده ما بيرسلش رد للزائر لو الطلب اترفض (clearance مطلوب):
//   القرار (challenge / block) بيبقى في app.ts، مش هنا.
// - لو اتمرر للـ Origin، forwardToOrigin هو اللي بيرسل الرد بنفسه.
// - الملف مستقل: مش بيستورد clearance.ts. الـ verifier بيتبعت له
//   كـ option لحد ما clearance.ts يتكتب.
//
// ======================================================

import type { FastifyRequest, FastifyReply } from 'fastify';
import { forwardToOrigin, type ForwardResult } from './forwardToOrigin';
import type { RequestContext, Signals } from '../types';

// ======================================================
// الأنواع
// ======================================================

/** دالة التحقق من الـ clearance (هتيجي من challenge/clearance.ts لاحقًا) */
export type ClearanceVerifier = (
  token: string,
  signals: Signals,
) => Promise<boolean> | boolean;

export interface ProxyOptions {
  /**
   * لو true: الطلب لازم يكون معاه clearance صالح، وإلا مش هيتمرر.
   * الافتراضي false (تمرير مباشر، وده الوضع الحالي للاختبار).
   */
  requireClearance?: boolean;
  /** دالة التحقق. مطلوبة لو requireClearance = true */
  verifyClearance?: ClearanceVerifier;
}

export type ProxyRejectReason =
  | 'clearance_missing'
  | 'clearance_invalid'
  | 'clearance_verifier_missing';

export type ProxyOutcome =
  | {
      /** الطلب اتمرر للـ Origin والرد اتبعت للزائر */
      forwarded: true;
      result: ForwardResult;
    }
  | {
      /** الطلب ما اتمررش، ولسه ما اتبعتش رد: app.ts يقرر (challenge / block) */
      forwarded: false;
      reason: ProxyRejectReason;
    };

// ======================================================
// الدالة الرئيسية
// ======================================================

export async function proxyToOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: RequestContext,
  options: ProxyOptions = {},
): Promise<ProxyOutcome> {
  const { requireClearance = false, verifyClearance } = options;

  // ---- 1) التحقق من الـ clearance (لو مطلوب) ----
  if (requireClearance) {
    if (!ctx.signals.hasClearance || !ctx.signals.clearanceToken) {
      return { forwarded: false, reason: 'clearance_missing' };
    }

    if (!verifyClearance) {
      // أمان: لو طلبنا clearance من غير verifier، نرفض بدل ما نعدّي
      request.log.error(
        { requestId: ctx.id },
        'requireClearance=true but no verifyClearance provided',
      );
      return { forwarded: false, reason: 'clearance_verifier_missing' };
    }

    let valid = false;
    try {
      valid = await verifyClearance(ctx.signals.clearanceToken, ctx.signals);
    } catch (err) {
      request.log.warn({ err, requestId: ctx.id }, 'Clearance verification threw');
    }

    if (!valid) {
      return { forwarded: false, reason: 'clearance_invalid' };
    }
  }

  // ---- 2) التمرير للـ Origin ----
  const result = await forwardToOrigin(request, reply, ctx);

  return { forwarded: true, result };
}

export default proxyToOrigin;