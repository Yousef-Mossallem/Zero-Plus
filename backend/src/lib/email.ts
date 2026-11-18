/**
 * backend/src/lib/email.ts
 * ==================================================================
 * Zero Plus - Email service (Resend)
 *
 * الاستخدام الحالي:
 *   - دعوات أعضاء الفريق (TeamInvite)
 *   - لاحقًا: إشعارات اختيارية
 *
 * التطوير بدون دومين:
 *   RESEND_FROM_EMAIL="Zero Plus <onboarding@resend.dev>"
 *
 * بعد شراء وتوثيق zero-plus.site:
 *   RESEND_FROM_EMAIL="Zero Plus <noreply@zero-plus.site>"
 * ==================================================================
 */

import { Resend } from 'resend'

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------

function getResendApiKey(): string | null {
  const key = process.env.RESEND_API_KEY?.trim()
  return key && key.length > 0 ? key : null
}

/**
 * العنوان الظاهر للمستلم
 * أمثلة:
 *   Zero Plus <onboarding@resend.dev>
 *   Zero Plus <noreply@zero-plus.site>
 *   noreply@zero-plus.site
 */
function getFromAddress(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    'Zero Plus <onboarding@resend.dev>'
  )
}

function getAppUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    'http://localhost:5173'
  ).replace(/\/$/, '')
}

function getReplyTo(): string | undefined {
  const v = process.env.RESEND_REPLY_TO?.trim()
  return v || undefined
}

/** لو مفيش API key — في التطوير نطبع اللينك بدل ما نكسر الطلب */
function isEmailOptionalInDev(): boolean {
  return process.env.NODE_ENV !== 'production'
}

let resendClient: Resend | null = null

function getResend(): Resend | null {
  const key = getResendApiKey()
  if (!key) return null
  if (!resendClient) {
    resendClient = new Resend(key)
  }
  return resendClient
}

// ------------------------------------------------------------------
// أنواع
// ------------------------------------------------------------------

export type SendEmailResult = {
  ok: boolean
  id?: string
  skipped?: boolean
  error?: string
}

export type TeamInviteEmailParams = {
  to: string
  inviteToken: string
  organizationName: string
  inviterName: string
  role: string
  /** ساعات حتى الانتهاء — للعرض في الإيميل فقط */
  expiresInHours?: number
}

// ------------------------------------------------------------------
// قوالب HTML بسيطة (من غير React Email — تشتغل فورًا)
// ------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function teamInviteHtml(params: {
  organizationName: string
  inviterName: string
  role: string
  acceptUrl: string
  expiresInHours: number
}): string {
  const org = escapeHtml(params.organizationName)
  const inviter = escapeHtml(params.inviterName)
  const role = escapeHtml(params.role)
  const url = escapeHtml(params.acceptUrl)
  const hours = params.expiresInHours

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>دعوة للانضمام إلى ${org}</title>
</head>
<body style="margin:0;padding:0;background:#0b1220;font-family:Segoe UI,Tahoma,Arial,sans-serif;color:#e8eefc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b1220;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#121a2b;border-radius:16px;border:1px solid #243049;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <div style="font-size:13px;letter-spacing:0.08em;color:#7dd3fc;font-weight:600;">ZERO PLUS</div>
              <h1 style="margin:12px 0 0 0;font-size:22px;line-height:1.35;color:#ffffff;">
                تمت دعوتك للانضمام
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 8px 28px;font-size:15px;line-height:1.7;color:#c7d2fe;">
              <p style="margin:0 0 12px 0;">
                <strong style="color:#fff;">${inviter}</strong>
                يدعوك للانضمام إلى منظمة
                <strong style="color:#fff;">${org}</strong>
                على Zero Plus.
              </p>
              <p style="margin:0 0 12px 0;">
                الدور المقترح:
                <span style="display:inline-block;background:#1e293b;color:#93c5fd;padding:2px 10px;border-radius:999px;font-size:13px;">
                  ${role}
                </span>
              </p>
              <p style="margin:0;color:#94a3b8;font-size:13px;">
                الرابط صالح لمدة تقريبًا ${hours} ساعة. بعد القبول ستُنشئ Passkey (بصمة / وجه) على جهازك.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px 28px;" align="center">
              <a href="${url}"
                 style="display:inline-block;background:linear-gradient(135deg,#38bdf8,#6366f1);color:#0b1220;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;">
                قبول الدعوة
              </a>
              <p style="margin:16px 0 0 0;font-size:12px;color:#64748b;word-break:break-all;line-height:1.5;">
                إذا الزر لا يعمل، انسخ الرابط:<br />
                <span style="color:#94a3b8;">${url}</span>
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0 0;font-size:11px;color:#475569;">
          إذا لم تطلب هذه الدعوة يمكنك تجاهل الرسالة.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function teamInviteText(params: {
  organizationName: string
  inviterName: string
  role: string
  acceptUrl: string
  expiresInHours: number
}): string {
  return [
    `دعوة للانضمام إلى ${params.organizationName} على Zero Plus`,
    ``,
    `${params.inviterName} يدعوك للانضمام.`,
    `الدور: ${params.role}`,
    `صالح لمدة نحو ${params.expiresInHours} ساعة.`,
    ``,
    `اقبل الدعوة من هنا:`,
    params.acceptUrl,
    ``,
    `بعد القبول ستُنشئ Passkey على جهازك.`,
  ].join('\n')
}

// ------------------------------------------------------------------
// إرسال عام
// ------------------------------------------------------------------

export async function sendEmail(options: {
  to: string | string[]
  subject: string
  html: string
  text?: string
  tags?: { name: string; value: string }[]
}): Promise<SendEmailResult> {
  const resend = getResend()
  const from = getFromAddress()
  const replyTo = getReplyTo()

  if (!resend) {
    const msg = 'RESEND_API_KEY is missing'
    if (isEmailOptionalInDev()) {
      console.warn(`[email] skipped: ${msg}`, {
        to: options.to,
        subject: options.subject,
      })
      return { ok: true, skipped: true, error: msg }
    }
    return { ok: false, error: msg }
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      ...(replyTo ? { replyTo } : {}),
      ...(options.tags ? { tags: options.tags } : {}),
    })

    if (error) {
      console.error('[email] Resend error', error)
      return {
        ok: false,
        error: typeof error === 'object' && error && 'message' in error
          ? String((error as { message: string }).message)
          : 'Failed to send email',
      }
    }

    return { ok: true, id: data?.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email'
    console.error('[email] exception', err)
    return { ok: false, error: message }
  }
}

// ------------------------------------------------------------------
// دعوة فريق
// ------------------------------------------------------------------

/**
 * يبني رابط قبول الدعوة في الفرونت
 * مثال: https://app.zero-plus.site/accept-invite/<token>
 */
export function buildTeamInviteAcceptUrl(inviteToken: string): string {
  return `${getAppUrl()}/accept-invite/${encodeURIComponent(inviteToken)}`
}

/**
 * إرسال إيميل دعوة عضو جديد
 * يُستدعى من team.service بعد إنشاء TeamInvite في DB
 */
export async function sendTeamInviteEmail(
  params: TeamInviteEmailParams,
): Promise<SendEmailResult & { acceptUrl: string }> {
  const expiresInHours = params.expiresInHours ?? 72
  const acceptUrl = buildTeamInviteAcceptUrl(params.inviteToken)

  const subject = `دعوة للانضمام إلى ${params.organizationName} — Zero Plus`

  const html = teamInviteHtml({
    organizationName: params.organizationName,
    inviterName: params.inviterName,
    role: params.role,
    acceptUrl,
    expiresInHours,
  })

  const text = teamInviteText({
    organizationName: params.organizationName,
    inviterName: params.inviterName,
    role: params.role,
    acceptUrl,
    expiresInHours,
  })

  // في التطوير بدون مفتاح: نطبع الرابط عشان تختبر الفرونت
  if (!getResendApiKey() && isEmailOptionalInDev()) {
    console.info('[email] team invite (dev, no RESEND_API_KEY)', {
      to: params.to,
      acceptUrl,
    })
    return { ok: true, skipped: true, acceptUrl }
  }

  const result = await sendEmail({
    to: params.to,
    subject,
    html,
    text,
    tags: [
      { name: 'category', value: 'team_invite' },
    ],
  })

  if (result.skipped || !getResendApiKey()) {
    console.info('[email] team invite link', { to: params.to, acceptUrl })
  }

  return { ...result, acceptUrl }
}

// ------------------------------------------------------------------
// تصدير
// ------------------------------------------------------------------

export default {
  sendEmail,
  sendTeamInviteEmail,
  buildTeamInviteAcceptUrl,
}