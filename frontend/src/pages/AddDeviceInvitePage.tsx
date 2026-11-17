// frontend/src/pages/AddDeviceInvitePage.tsx
// ==================================================================
// Zero Plus - Add Device via QR Invite (Public page)
//
// الصفحة دي بتتفتح لما حد يمسح الـ QR من جهاز جديد.
// المسار: /add-device/:token
// راوت عام — مفيش حاجة للـ ProtectedRoute
//
// التدفق:
//   1) GET  /auth/passkeys/invite/:token  → registration options + user info
//   2) navigator.credentials.create(options) — البصمة على الجهاز الجديد
//   3) POST /auth/passkeys/invite/:token/finish → يضيف الـ Passkey
// ==================================================================

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { startRegistration } from '@simplewebauthn/browser'
import {
  AlertTriangle,
  CheckCircle,
  Fingerprint,
  Laptop,
  Lock,
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
import {
  finishPasskeyInvite,
  getPasskeyInviteOptions,
  type PasskeyInviteOptionsResult,
} from '../services/authService'

// ==================================================================
// Helpers
// ==================================================================

/** Guess device name from User-Agent */
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

/** Map backend errors to user-friendly messages */
function mapError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = String((err as { name: unknown }).name)
    if (name === 'NotAllowedError') return 'The prompt was cancelled or timed out.'
    if (name === 'InvalidStateError') return 'This device is already registered.'
    if (name === 'NotSupportedError') return 'Your device does not support biometrics.'
    if (name === 'SecurityError') return 'Domain mismatch. Contact your admin.'
    if (name === 'AbortError') return 'The operation was cancelled.'
  }

  if (typeof err === 'object' && err !== null) {
    const axiosErr = err as { response?: { data?: { message?: string } }; message?: string }
    const msg = axiosErr.response?.data?.message ?? axiosErr.message ?? ''
    if (msg.includes('INVITE_EXPIRED') || msg.includes('Invite expired')) return 'This invitation has expired. Please ask for a new QR code.'
    if (msg.includes('INVITE_ALREADY_USED') || msg.includes('Invite already used')) return 'This invitation has already been used.'
    if (msg.includes('INVITE_NOT_FOUND') || msg.includes('Invite not found')) return 'Invitation not found. It may have been deleted or expired.'
    if (msg.includes('PASSKEY_ALREADY_REGISTERED')) return 'This device is already registered.'
    if (msg.includes('USER_NOT_FOUND') || msg.includes('Account')) return 'Account not found or disabled.'
    if (msg) return msg
  }

  return 'Something went wrong. Please try again.'
}

// ==================================================================
// Page
// ==================================================================

type Stage = 'loading' | 'ready' | 'registering' | 'success' | 'error'

export default function AddDeviceInvitePage() {
  const { token } = useParams<{ token: string }>()

  const [stage, setStage] = useState<Stage>('loading')
  const [inviteData, setInviteData] = useState<PasskeyInviteOptionsResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [deviceName, setDeviceName] = useState(() => guessDeviceName())

  // Load invite options on mount
  useEffect(() => {
    if (!token) {
      setErrorMessage('Invalid invitation link.')
      setStage('error')
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const data = await getPasskeyInviteOptions(token)
        if (cancelled) return
        setInviteData(data)
        setStage('ready')
      } catch (err) {
        if (cancelled) return
        setErrorMessage(mapError(err))
        setStage('error')
      }
    })()

    return () => { cancelled = true }
  }, [token])

  // Register biometric on this device
  const handleRegister = async () => {
    if (!inviteData || !token) return
    setStage('registering')
    try {
      const credential = await startRegistration({ optionsJSON: inviteData.options })
      await finishPasskeyInvite(token, {
        deviceName: deviceName.trim() || guessDeviceName(),
        credential,
      })
      setStage('success')
    } catch (err) {
      setErrorMessage(mapError(err))
      setStage('error')
    }
  }

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <div className="flex min-h-[80vh] items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* ---- Header ---- */}
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/25 to-blue-600/25 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-400/25">
              <Fingerprint className="h-8 w-8 text-cyan-300" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Add This Device</h1>
            <p className="mt-1 text-sm text-slate-400">
              Register biometrics for your Zero Plus account
            </p>
          </div>

          <Card className="p-6">
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
                    <p className="font-semibold">Could not load invitation</p>
                    <p className="mt-1 text-xs text-rose-300">{errorMessage}</p>
                  </div>
                </div>
                <p className="text-center text-sm text-slate-500">
                  Please go back to your original device and generate a new QR code.
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
                  <p className="text-lg font-semibold text-white">Device added successfully!</p>
                  <p className="mt-1 text-sm text-slate-400">
                    You can now sign in to Zero Plus from this device using biometrics.
                  </p>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <Lock className="h-3.5 w-3.5" />
                  <span>Your private key never left this device.</span>
                </div>
              </div>
            )}

            {/* Ready — show user info + biometric button */}
            {(stage === 'ready' || stage === 'registering') && inviteData && (
              <div className="space-y-5">
                {/* Account info */}
                <div className="flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-500/6 px-4 py-3">
                  <User className="h-5 w-5 shrink-0 text-cyan-400" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{inviteData.user.fullName}</p>
                    <p className="truncate font-mono text-xs text-slate-400">{inviteData.user.email}</p>
                  </div>
                </div>

                {/* Device name input */}
                <Field
                  label="Device name"
                  hint="A label to identify this device in your profile (max 120 characters)."
                >
                  <TextInput
                    icon={Laptop}
                    dir="auto"
                    value={deviceName}
                    disabled={stage === 'registering'}
                    maxLength={120}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder="iPhone Face ID"
                  />
                </Field>

                {/* Info note */}
                <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-xs text-slate-400">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  <span>
                    Your biometric data never leaves this device. Only a public key is sent to the server.
                  </span>
                </div>

                {/* Error from registration attempt */}
                {errorMessage && (
                  <div className="flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/6 px-4 py-3 text-sm text-rose-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <Button
                  variant="primary"
                  icon={Fingerprint}
                  className="w-full"
                  loading={stage === 'registering'}
                  onClick={() => void handleRegister()}
                >
                  {stage === 'registering' ? 'Waiting for biometrics…' : 'Register with biometrics'}
                </Button>
              </div>
            )}
          </Card>

          {/* Footer */}
          <p className="mt-4 text-center text-xs text-slate-600">
            Protected by Zero Plus passwordless authentication
          </p>
        </div>
      </div>
    </PageShell>
  )
}
