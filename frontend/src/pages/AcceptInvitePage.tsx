// frontend/src/pages/AcceptInvitePage.tsx
// ==================================================================
// Zero Plus - Accept Team Invite (Public page — no JWT required)
//
// المسار: /accept-invite/:token
//
// التدفق:
//   1) GET  /auth/team-invite/:token  → تفاصيل الدعوة
//   2) المستخدم يدخل اسمه (اختياري) ويضغط قبول
//   3) POST /auth/team-invite/:token/start → WebAuthn options
//   4) navigator.credentials.create
//   5) POST /auth/team-invite/:token/finish → JWT + user + org
//   6) حفظ في authStore + تحويل للداشبورد
// ==================================================================

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { startRegistration } from '@simplewebauthn/browser'
import {
  AlertTriangle,
  Building2,
  CheckCircle,
  Fingerprint,
  Laptop,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from 'lucide-react'

import {
  Button,
  Card,
  Field,
  PageShell,
  Skeleton,
  TextInput,
} from '../components/ui/kit'
import DynamicText from '../components/DynamicText'

import {
  previewTeamInvite,
  startTeamInvite,
  finishTeamInvite,
  type TeamInvitePreviewResult,
} from '../services/authService'
import useAuthStore from '../store/authStore'
import { HOME_PATH } from '../router/paths'

// ==================================================================
// Helpers
// ==================================================================

function guessDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone Face ID'
  if (/iPad/i.test(ua)) return 'iPad Touch ID'
  if (/Android/i.test(ua)) return 'Android Fingerprint'
  if (/Windows/i.test(ua)) return 'Windows Hello'
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac Touch ID'
  if (/Linux/i.test(ua)) return 'Linux Device'
  return 'My Device'
}

function mapInviteError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const webAuthnName = (err as { name?: string }).name
    if (webAuthnName === 'NotAllowedError')
      return 'تم إلغاء التحقق بالبصمة أو انتهت المهلة'
    if (webAuthnName === 'InvalidStateError')
      return 'هذا الجهاز مسجّل بالفعل'
    if (webAuthnName === 'NotSupportedError')
      return 'جهازك لا يدعم Passkeys'
    if (webAuthnName === 'SecurityError')
      return 'تعارض في النطاق. تواصل مع المسؤول.'
    if (webAuthnName === 'AbortError')
      return 'تم إلغاء العملية'

    const e = err as {
      response?: { data?: { message?: string; error?: { messageAr?: string; message?: string } } }
      message?: string
    }
    const msgAr = e.response?.data?.error?.messageAr
    if (msgAr) return msgAr
    const msg = e.response?.data?.error?.message ?? e.response?.data?.message ?? e.message
    if (msg) {
      if (msg.includes('INVITE_EXPIRED') || msg.includes('expired'))
        return 'انتهت صلاحية الدعوة. اطلب دعوة جديدة.'
      if (msg.includes('INVITE_ALREADY_USED') || msg.includes('already used'))
        return 'تم استخدام هذه الدعوة من قبل.'
      if (msg.includes('INVITE_REVOKED') || msg.includes('revoked'))
        return 'تم إلغاء هذه الدعوة.'
      if (msg.includes('INVITE_NOT_FOUND') || msg.includes('not found'))
        return 'الدعوة غير موجودة أو انتهت صلاحيتها.'
      if (msg.includes('EMAIL_ALREADY_EXISTS'))
        return 'هذا البريد الإلكتروني مسجّل بالفعل.'
      if (msg.includes('ORGANIZATION_DISABLED'))
        return 'المنظمة معطّلة. تواصل مع مسؤول النظام.'
      if (msg.includes('CHALLENGE_EXPIRED'))
        return 'انتهت مهلة التحقق. أعد المحاولة من البداية.'
      if (msg.includes('WEBAUTHN_VERIFICATION_FAILED'))
        return 'فشل التحقق من البصمة. حاول مرة أخرى.'
      return msg
    }
  }
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.'
}

function formatRole(role: string): string {
  const map: Record<string, string> = {
    ADMIN: 'مسؤول',
    ANALYST: 'محلل',
    VIEWER: 'مشاهد',
  }
  return map[role] ?? role
}

// ==================================================================
// Stage
// ==================================================================

type Stage = 'loading' | 'preview' | 'accepting' | 'success' | 'error'

// ==================================================================
// Page
// ==================================================================

export default function AcceptInvitePage() {
  const { t } = useTranslation('team')
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [stage, setStage] = useState<Stage>('loading')
  const [preview, setPreview] = useState<TeamInvitePreviewResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [fullName, setFullName] = useState('')
  const [deviceName, setDeviceName] = useState(() => guessDeviceName())

  // ----------------------------------------------------------------
  // 1) Load invite preview
  // ----------------------------------------------------------------

  useEffect(() => {
    if (!token) {
      setErrorMessage(t('invite.invalidLink', 'رابط الدعوة غير صالح.'))
      setStage('error')
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const data = await previewTeamInvite(token)
        if (cancelled) return
        setPreview(data)
        setStage('preview')
      } catch (err) {
        if (cancelled) return
        setErrorMessage(mapInviteError(err))
        setStage('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token, t])

  // ----------------------------------------------------------------
  // 2) Accept flow: start → WebAuthn → finish
  // ----------------------------------------------------------------

  const handleAccept = async () => {
    if (!token) return
    setStage('accepting')
    setErrorMessage('')

    try {
      // start
      const startResult = await startTeamInvite(token, fullName.trim() || undefined)

      // WebAuthn create
      const credential = await startRegistration({ optionsJSON: startResult.options })

      // finish
      const finishResult = await finishTeamInvite(token, {
        fullName: fullName.trim() || undefined,
        deviceName: deviceName.trim() || undefined,
        credential,
      })

      // حفظ الجلسة في الـ store
      useAuthStore.setState({
        token: finishResult.token,
        user: finishResult.user,
        organization: finishResult.organization,
        status: 'authenticated',
        initialized: true,
        error: null,
      })

      // حفظ في localStorage (نفس منطق api.ts)
      try {
        const raw = localStorage.getItem('zero-plus-auth')
        const parsed = raw ? (JSON.parse(raw) as { state?: Record<string, unknown> }) : { state: {} }
        if (parsed.state) {
          parsed.state.token = finishResult.token
          parsed.state.user = finishResult.user
          parsed.state.organization = finishResult.organization
          localStorage.setItem('zero-plus-auth', JSON.stringify(parsed))
        }
      } catch {
        // ignore
      }

      setStage('success')

      // تحويل للداشبورد بعد ثانيتين
      setTimeout(() => {
        navigate(HOME_PATH, { replace: true })
      }, 2000)
    } catch (err) {
      const msg = mapInviteError(err)
      setErrorMessage(msg)

      // لو CHALLENGE_EXPIRED → يرجع للبداية
      if (msg.includes('انتهت مهلة التحقق') || msg.includes('CHALLENGE_EXPIRED')) {
        setStage('preview')
      } else {
        setStage('preview')
      }
    }
  }

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  return (
    <PageShell>
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#05070f] px-4 py-12">
        {/* Background glows */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-[#0b1224] via-[#05070f] to-[#02040a]" />
        <div className="pointer-events-none absolute -left-40 top-1/4 h-80 w-80 rounded-full bg-cyan-500/10 blur-[100px]" />
        <div className="pointer-events-none absolute -right-40 bottom-1/4 h-72 w-72 rounded-full bg-indigo-600/10 blur-[90px]" />

        <div className="relative z-10 w-full max-w-md">
          {/* Header */}
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/25">
              <ShieldCheck className="h-7 w-7 text-white" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                {t('invite.pageTitle', 'دعوة انضمام')}
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                {t('invite.pageSubtitle', 'سجّل بصمتك وانضم للمنظمة')}
              </p>
            </div>
          </div>

          <Card className="space-y-5">
            {/* Loading */}
            {stage === 'loading' && (
              <div className="space-y-4">
                <Skeleton className="h-6 w-3/4 rounded-lg" />
                <Skeleton className="h-6 w-1/2 rounded-lg" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
            )}

            {/* Error */}
            {stage === 'error' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/6 px-4 py-4 text-sm text-rose-200">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      {t('invite.loadError', 'تعذّر تحميل الدعوة')}
                    </p>
                    <p className="mt-1 text-xs text-rose-300">
                      <DynamicText text={errorMessage} />
                    </p>
                  </div>
                </div>
                <p className="text-center text-sm text-slate-500">
                  {t('invite.contactAdmin', 'تواصل مع المسؤول للحصول على دعوة جديدة.')}
                </p>
              </div>
            )}

            {/* Success */}
            {stage === 'success' && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30">
                  <CheckCircle className="h-9 w-9 text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-white">
                    {t('invite.successTitle', 'تم قبول الدعوة!')}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {t('invite.successDesc', 'مرحبًا بك! جارٍ تحويلك للداشبورد...')}
                  </p>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <Lock className="h-3.5 w-3.5" />
                  <span>{t('invite.keyNote', 'مفتاحك الخاص لا يغادر هذا الجهاز أبدًا.')}</span>
                </div>
              </div>
            )}

            {/* Preview / Accepting */}
            {(stage === 'preview' || stage === 'accepting') && preview && (
              <div className="space-y-5">
                {/* Invite Details */}
                <div className="space-y-3">
                  {/* Organization */}
                  <div className="flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-500/6 px-4 py-3">
                    <Building2 className="h-5 w-5 shrink-0 text-cyan-400" />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">
                        {t('invite.organization', 'المنظمة')}
                      </p>
                      <p className="truncate text-sm font-semibold text-white">
                        {preview.organizationName}
                      </p>
                    </div>
                  </div>

                  {/* Invited by + Role */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-2.5">
                      <p className="text-xs text-slate-500">
                        {t('invite.invitedBy', 'دعاك')}
                      </p>
                      <p className="mt-0.5 truncate text-sm font-medium text-white">
                        {preview.invitedByName}
                      </p>
                    </div>
                    <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/6 px-3 py-2.5">
                      <p className="text-xs text-slate-500">
                        {t('invite.role', 'الدور')}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-indigo-300">
                        {formatRole(preview.role)}
                      </p>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3">
                    <Mail className="h-4 w-4 shrink-0 text-slate-500" />
                    <p className="truncate font-mono text-xs text-slate-400">
                      {preview.email}
                    </p>
                  </div>
                </div>

                {/* Full Name (optional) */}
                <Field
                  label={t('invite.fullNameLabel', 'اسمك (اختياري)')}
                  hint={t('invite.fullNameHint', 'اتركه فارغًا ليُشتق من الإيميل.')}
                >
                  <TextInput
                    icon={User}
                    dir="auto"
                    value={fullName}
                    disabled={stage === 'accepting'}
                    maxLength={120}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t('invite.fullNamePlaceholder', 'الاسم الكامل')}
                  />
                </Field>

                {/* Device Name */}
                <Field
                  label={t('invite.deviceNameLabel', 'اسم الجهاز')}
                  hint={t('invite.deviceNameHint', 'تسمية لتعريف هذا الجهاز (120 حرفًا كحد أقصى).')}
                >
                  <TextInput
                    icon={Laptop}
                    dir="auto"
                    value={deviceName}
                    disabled={stage === 'accepting'}
                    maxLength={120}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder="iPhone Face ID"
                  />
                </Field>

                {/* Privacy note */}
                <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-xs text-slate-400">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  <span>
                    {t(
                      'invite.privacyNote',
                      'بياناتك البيومترية لا تغادر هذا الجهاز. يُرسَل المفتاح العام فقط إلى الخادم.',
                    )}
                  </span>
                </div>

                {/* Error from accepting attempt */}
                {errorMessage && stage === 'preview' && (
                  <div className="flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/6 px-4 py-3 text-sm text-rose-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <DynamicText text={errorMessage} />
                    </span>
                  </div>
                )}

                {/* Accept Button */}
                <Button
                  variant="primary"
                  icon={Fingerprint}
                  className="w-full"
                  loading={stage === 'accepting'}
                  onClick={() => void handleAccept()}
                >
                  {stage === 'accepting'
                    ? t('invite.accepting', 'في انتظار البصمة...')
                    : t('invite.acceptButton', 'قبول الدعوة وتسجيل البصمة')}
                </Button>
              </div>
            )}
          </Card>

          <p className="mt-4 text-center text-xs text-slate-600">
            {t('invite.trustNote', 'محمي بمصادقة Zero Plus بدون كلمة مرور')}
          </p>
        </div>
      </div>
    </PageShell>
  )
}
