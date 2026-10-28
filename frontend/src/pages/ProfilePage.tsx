// frontend/src/pages/ProfilePage.tsx
// ==================================================================
// Zero Plus - Profile Page
// صفحة Profile وإعدادات الحساب والأمان
// (مربوطة بـ backend/modules/auth و backend/modules/organizations)
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ElementType } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Fingerprint,
  Key,
  LogOut,
  Mail,
  Monitor,
  RefreshCw,
  Save,
  Shield,
  ShieldAlert,
  Smartphone,
  Trash2,
  User,
} from 'lucide-react'

import { useToast } from '../components/ui/Toast'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  PageShell,
  SelectInput,
  Skeleton,
  TextInput,
} from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import apiClient from '../services/api'
import { getSocket } from '../services/socket'
import type { User as UserType } from '../services/types'
import { useAuthStore } from '../store/authStore'
import { cn, timeAgo } from '../utils/format'

// ==================================================================
// Types & Constants
// ==================================================================

type ActivityType =
  | 'LOGIN'
  | 'LOGOUT'
  | 'PASSWORD_CHANGE'
  | '2FA_ENABLE'
  | '2FA_DISABLE'
  | 'PROFILE_UPDATE'
  | 'API_KEY_CREATE'
  | 'API_KEY_DELETE'

interface ActivityLog {
  id: string
  type: ActivityType
  description: string
  ipAddress: string
  userAgent: string
  country?: string
  createdAt: string
}

interface ProfileData {
  id: string
  email: string
  name: string
  role: UserType['role']
  organizationId: string
  organizationName: string
  twoFactorEnabled: boolean
  lastLoginAt: string | null
  createdAt: string
}

const ACTIVITY_META: Record<ActivityType, { label: string; color: string; icon: ElementType }> = {
  LOGIN: { label: 'تسجيل دخول', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: LogOut },
  LOGOUT: { label: 'تسجيل خروج', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20', icon: LogOut },
  PASSWORD_CHANGE: { label: 'Change password', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: Key },
  '2FA_ENABLE': { label: 'تفعيل 2FA', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', icon: Shield },
  '2FA_DISABLE': { label: 'إيقاف 2FA', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20', icon: ShieldAlert },
  PROFILE_UPDATE: { label: 'Refresh Profile', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', icon: User },
  API_KEY_CREATE: { label: 'إنشاء مفتاح API', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20', icon: Key },
  API_KEY_DELETE: { label: 'Delete مفتاح API', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20', icon: Trash2 },
}

const TIME_RANGES = [
  { value: '7d', label: 'آخر 7 days' },
  { value: '30d', label: 'آخر 30 days' },
  { value: '90d', label: 'آخر 90 يوم' },
  { value: 'all', label: 'كل السجل' },
] as const

// ==================================================================
// Page Component
// ==================================================================

export default function ProfilePage() {
  const toast = useToast()
  const { user: authUser, logout } = useAuthStore()

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [nameModified, setNameModified] = useState(false)
  const [emailModified, setEmailModified] = useState(false)

  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [passwordStrength, setPasswordStrength] = useState(0)

  const [twoFactorModalOpen, setTwoFactorModalOpen] = useState(false)
  const [twoFactorLoading, setTwoFactorLoading] = useState(false)
  const [twoFactorSecret, setTwoFactorSecret] = useState('')
  const [twoFactorUri, setTwoFactorUri] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')

  const [activities, setActivities] = useState<ActivityLog[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [timeRange, setTimeRange] = useState<string>('30d')

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  const [logoutModalOpen, setLogoutModalOpen] = useState(false)

  const requestIdRef = useRef(0)

  // قيمة آمنة لNoستخدام خارج الـ early return
  const is2FAEnabled = profile?.twoFactorEnabled === true

  const loadProfile = useCallback(async () => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    try {
      const { data } = await apiClient.get<{ success: boolean; data: ProfileData }>('/auth/me')
      if (reqId !== requestIdRef.current) return

      setProfile((data as any).data ?? (data as any).profile ?? data)
      setEditName(((data as any).data ?? (data as any).profile ?? data).name ?? '')
      setEditEmail(((data as any).data ?? (data as any).profile ?? data).email ?? '')
      setNameModified(false)
      setEmailModified(false)
    } catch (err) {
      if (reqId !== requestIdRef.current) return
      const { message } = parseApiError(err)
      setError(message)
      toast.error('Load failed', 'تعذر جلب بيانات Profile')
    } finally {
      if (reqId === requestIdRef.current) setLoading(false)
    }
  }, [toast])

  const loadActivities = useCallback(
    async (range: string) => {
      setActivitiesLoading(true)
      try {
        const params = range === 'all' ? {} : { range }
        const { data } = await apiClient.get<{ success?: boolean; data?: ActivityLog[]; activities?: ActivityLog[] }>('/auth/activity', { params })
        setActivities((data as any).data ?? (data as any).activities)
      } catch {
        toast.error('Load failed', 'تعذر جلب سجل النشاط')
      } finally {
        setActivitiesLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void loadProfile()
    void loadActivities(timeRange)
  }, [loadProfile, loadActivities, timeRange])

  useEffect(() => {
    const socket = getSocket()

    const handleSecurityEvent = (event: { userId?: string; description?: string }) => {
      if (event.userId === authUser?.id) {
        void loadActivities(timeRange)
        toast.info('حدث Security', event.description || 'تم رصد حدث Security جديد على حسابك')
      }
    }

    socket.on('security:activity', handleSecurityEvent)

    return () => {
      socket.off('security:activity', handleSecurityEvent)
    }
  }, [authUser?.id, timeRange, toast, loadActivities])

  const handleNameChange = (value: string) => {
    setEditName(value)
    setNameModified(value !== profile?.name)
  }

  const handleEmailChange = (value: string) => {
    setEditEmail(value)
    setEmailModified(value !== profile?.email)
  }

  const handleSaveProfile = async () => {
    if (!nameModified && !emailModified) return
    setSaving(true)

    try {
      const updates: Record<string, string> = {}
      if (nameModified) updates.name = editName
      if (emailModified) updates.email = editEmail

      const { data } = await apiClient.patch<{ success: boolean; data: ProfileData; message?: string }>('/auth/profile', updates)
      setProfile((data as any).data ?? (data as any).profile ?? data)
      setNameModified(false)
      setEmailModified(false)
      toast.success('Saved', 'تم Refresh البيانات الشخصية بSuccess')
    } catch (err) {
      const { message } = parseApiError(err)
      toast.error('فشل الSave', message)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!newPassword) {
      setPasswordStrength(0)
      return
    }
    let strength = 0
    if (newPassword.length >= 8) strength++
    if (/[A-Z]/.test(newPassword)) strength++
    if (/[0-9]/.test(newPassword)) strength++
    if (/[^A-Za-z0-9]/.test(newPassword)) strength++
    setPasswordStrength(strength)
  }, [newPassword])

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Error', 'كلمتا المرور غير متطابقتين')
      return
    }
    if (passwordStrength < 3) {
      toast.error('Error', 'Password ضعيفة جداً')
      return
    }

    setSaving(true)
    try {
      await apiClient.post('/auth/password', {
        currentPassword,
        newPassword,
      })
      setPasswordModalOpen(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('تم التغيير', 'تم Change password بSuccess')
    } catch (err) {
      const { message } = parseApiError(err)
      toast.error('فشل التغيير', message)
    } finally {
      setSaving(false)
    }
  }

  const handleEnable2FA = async () => {
    setTwoFactorLoading(true)
    try {
      const { data } = await apiClient.post<{ secret: string; uri: string }>('/auth/2fa/enable', {
        code: twoFactorCode,
      })
      setTwoFactorSecret(data.secret)
      setTwoFactorUri(data.uri)
      toast.success('تم التفعيل', 'تم تفعيل المصادقة الثنائية بSuccess')
      setTwoFactorModalOpen(false)
      void loadProfile()
    } catch (err) {
      const { message } = parseApiError(err)
      toast.error('فشل التفعيل', message)
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const handleDisable2FA = async () => {
    setTwoFactorLoading(true)
    try {
      await apiClient.post('/auth/2fa/disable', { code: twoFactorCode })
      toast.success('تم الإيقاف', 'تم إيقاف المصادقة الثنائية')
      setTwoFactorModalOpen(false)
      setTwoFactorCode('')
      void loadProfile()
    } catch (err) {
      const { message } = parseApiError(err)
      toast.error('فشل الإيقاف', message)
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      toast.error('Error', 'يجب كتابة DELETE للConfirm')
      return
    }

    setDeleteLoading(true)
    try {
      await apiClient.delete('/auth/account')
      logout()
      toast.success('Deleted', 'تم Delete الحساب بSuccess')
      window.location.href = '/login'
    } catch (err) {
      const { message } = parseApiError(err)
      toast.error('فشل الDelete', message)
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    window.location.href = '/login'
  }

  const hasProfileChanges = nameModified || emailModified

  const passwordStrengthLabel = useMemo(() => {
    if (passwordStrength === 0) return 'ضعيفة جداً'
    if (passwordStrength === 1) return 'ضعيفة'
    if (passwordStrength === 2) return 'متوسطة'
    if (passwordStrength === 3) return 'قوية'
    return 'قوية جداً'
  }, [passwordStrength])

  const passwordStrengthColor = useMemo(() => {
    if (passwordStrength <= 1) return 'bg-rose-500'
    if (passwordStrength === 2) return 'bg-amber-500'
    if (passwordStrength === 3) return 'bg-emerald-500'
    return 'bg-cyan-500'
  }, [passwordStrength])

  return (
    <PageShell>
      <PageHeader
        icon={User}
        title="Profile"
        subtitle="Manage your account, security, and authentication settings."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={LogOut} variant="ghost" onClick={() => setLogoutModalOpen(true)}>
              Sign out
            </Button>
            <Button icon={RefreshCw} loading={loading} onClick={() => void loadProfile()}>
              Refresh
            </Button>
          </div>
        }
      />

      {error && !profile ? (
        <Card>
          <ErrorState message={error} onRetry={() => void loadProfile()} />
        </Card>
      ) : loading || !profile ? (
        <div className="space-y-6">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-72 w-full rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
        </div>
      ) : (
        <ProfileContent
          profile={profile}
          editName={editName}
          editEmail={editEmail}
          hasProfileChanges={hasProfileChanges}
          saving={saving}
          activities={activities}
          activitiesLoading={activitiesLoading}
          timeRange={timeRange}
          onNameChange={handleNameChange}
          onEmailChange={handleEmailChange}
          onSaveProfile={() => void handleSaveProfile()}
          onResetEdits={() => {
            setEditName(profile.name)
            setEditEmail(profile.email)
            setNameModified(false)
            setEmailModified(false)
          }}
          onOpenPassword={() => setPasswordModalOpen(true)}
          onOpen2FA={() => setTwoFactorModalOpen(true)}
          onOpenDelete={() => setDeleteModalOpen(true)}
          onTimeRangeChange={setTimeRange}
        />
      )}

      {/* Password Modal */}
      <Modal
        open={passwordModalOpen}
        onClose={() => !saving && setPasswordModalOpen(false)}
        title="Change password"
        description="أدخل Password الحالية والجديدة. يجب أن تكون Password الجديدة قوية."
        icon={Key}
        tone="amber"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasswordModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={passwordStrength < 3 || newPassword !== confirmPassword}
              onClick={() => void handleChangePassword()}
            >
              Change password
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">Password الحالية</label>
            <TextInput
              type={showPasswords ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">Password الجديدة</label>
            <TextInput
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
              placeholder="••••••••"
            />
            {newPassword && (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-400">قوة Password</span>
                  <span
                    className={cn(
                      'font-medium',
                      passwordStrength <= 1
                        ? 'text-rose-400'
                        : passwordStrength === 2
                          ? 'text-amber-400'
                          : 'text-emerald-400',
                    )}
                  >
                    {passwordStrengthLabel}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={cn('h-full transition-all duration-300', passwordStrengthColor)}
                    style={{ width: `${(passwordStrength / 4) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">Confirm Password</label>
            <TextInput
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              invalid={confirmPassword !== '' && newPassword !== confirmPassword}
            />
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="mt-1 text-xs text-rose-400">كلمتا المرور غير متطابقتين</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowPasswords(!showPasswords)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
          >
            {showPasswords ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showPasswords ? 'إخفاء' : 'إظهار'} كلمات المرور
          </button>
        </div>
      </Modal>

      {/* 2FA Modal - uses is2FAEnabled to avoid null access */}
      <Modal
        open={twoFactorModalOpen}
        onClose={() => !twoFactorLoading && setTwoFactorModalOpen(false)}
        title={is2FAEnabled ? 'إيقاف المصادقة الثنائية' : 'تفعيل المصادقة الثنائية'}
        description={
          is2FAEnabled
            ? 'أدخل رمز التحقق من تطبيق المصادقة لإيقاف 2FA.'
            : 'اClear رمز QR باستخدام تطبيق المصادقة (Google Authenticator, Authy) ثم أدخل الرمز.'
        }
        icon={Fingerprint}
        tone={is2FAEnabled ? 'rose' : 'emerald'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTwoFactorModalOpen(false)} disabled={twoFactorLoading}>
              Cancel
            </Button>
            <Button
              variant={is2FAEnabled ? 'danger' : 'primary'}
              loading={twoFactorLoading}
              onClick={() => (is2FAEnabled ? void handleDisable2FA() : void handleEnable2FA())}
            >
              {is2FAEnabled ? 'إيقاف 2FA' : 'تفعيل 2FA'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {!is2FAEnabled && twoFactorUri && (
            <div className="rounded-xl border border-white/8 bg-white/3 p-4 text-center">
              <p className="mb-3 text-xs text-slate-400">اClear رمز QR باستخدام تطبيق المصادقة</p>
              <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-lg bg-white p-2">
                <Fingerprint className="h-24 w-24 text-slate-300" />
              </div>
              <div className="mt-3 flex items-center justify-center gap-2">
                <code className="rounded bg-slate-950/50 px-2 py-1 text-xs text-slate-300">
                  {twoFactorSecret.substring(0, 8)}...
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(twoFactorSecret)
                    toast.success('تم النسخ', 'تم نسخ المفتاح السري')
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">رمز التحقق (6 أرقام)</label>
            <TextInput
              value={twoFactorCode}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
            />
          </div>

          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-xs text-cyan-200">
            <div className="flex items-start gap-2">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
              <p>إذا لم تتمكن من Clear رمز QR، يمكنك إدخال المفتاح السري يدوياً في تطبيق المصادقة.</p>
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => !deleteLoading && setDeleteModalOpen(false)}
        title="Delete account permanently"
        description="هذا الإجراء This cannot be undone عنه. سيتم Delete جميع بياناتك وسيرفراتك وسياساتك. للConfirm، اكتب DELETE في الحقل أدناه."
        icon={AlertTriangle}
        tone="rose"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteModalOpen(false)} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteLoading}
              disabled={deleteConfirmText !== 'DELETE'}
              onClick={() => void handleDeleteAccount()}
            >
              Delete account permanently
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
              <div className="text-sm text-rose-200">
                <p className="mb-1 font-semibold">Warning هام</p>
                <ul className="list-inside list-disc space-y-1 text-xs text-rose-300/80">
                  <li>سيتم Delete جميع Servers المحمية</li>
                  <li>سيتم Delete جميع Policies والإعدادات</li>
                  <li>سيتم Delete جميع التقارير والسجNoت</li>
                  <li>No يمكن استعادة أي بيانات بعد الDelete</li>
                </ul>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">
              اكتب <span className="font-mono text-rose-400">DELETE</span> للConfirm
            </label>
            <TextInput
              value={deleteConfirmText}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
            />
          </div>
        </div>
      </Modal>

      {/* Logout Modal */}
      <Modal
        open={logoutModalOpen}
        onClose={() => setLogoutModalOpen(false)}
        title="Sign out"
        description="Are you sure من رغبتك في Sign out من حسابك؟"
        icon={LogOut}
        tone="amber"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLogoutModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleLogout}>
              Yes، Sign out
            </Button>
          </>
        }
      />
    </PageShell>
  )
}

// ==================================================================
// Profile Content (profile is guaranteed non-null here)
// ==================================================================

function ProfileContent({
  profile,
  editName,
  editEmail,
  hasProfileChanges,
  saving,
  activities,
  activitiesLoading,
  timeRange,
  onNameChange,
  onEmailChange,
  onSaveProfile,
  onResetEdits,
  onOpenPassword,
  onOpen2FA,
  onOpenDelete,
  onTimeRangeChange,
}: {
  profile: ProfileData
  editName: string
  editEmail: string
  hasProfileChanges: boolean
  saving: boolean
  activities: ActivityLog[]
  activitiesLoading: boolean
  timeRange: string
  onNameChange: (v: string) => void
  onEmailChange: (v: string) => void
  onSaveProfile: () => void
  onResetEdits: () => void
  onOpenPassword: () => void
  onOpen2FA: () => void
  onOpenDelete: () => void
  onTimeRangeChange: (v: string) => void
}) {
  return (
    <>
      <Card className="p-6" delay={0}>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-indigo-600 text-3xl font-bold text-white shadow-lg shadow-cyan-500/30">
                {profile.name.charAt(0).toUpperCase()}
              </div>
              {profile.twoFactorEnabled && (
                <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-950 bg-emerald-500">
                  <Shield className="h-4 w-4 text-white" />
                </div>
              )}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">{profile.name}</h2>
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <Mail className="h-4 w-4" />
                {profile.email}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-400">
                  {profile.role}
                </span>
                <span className="text-xs text-slate-500">{profile.organizationName}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <InfoBox label="Last login" value={profile.lastLoginAt ? timeAgo(profile.lastLoginAt) : 'لم يسبق'} />
            <InfoBox label="Created at" value={timeAgo(profile.createdAt)} />
            <InfoBox
              label="2FA"
              value={profile.twoFactorEnabled ? 'مفعّل' : 'معطّل'}
              highlight={profile.twoFactorEnabled}
            />
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6" delay={60}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400">
                <User className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">البيانات الشخصية</h3>
                <p className="text-xs text-slate-400">Edit name وEmail</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-200">Name الكامل</label>
              <TextInput
                icon={User}
                value={editName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onNameChange(e.target.value)}
                placeholder="Enter your full name"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-200">Email</label>
              <TextInput
                icon={Mail}
                value={editEmail}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onEmailChange(e.target.value)}
                placeholder="example@company.com"
                type="email"
              />
            </div>

            {hasProfileChanges && (
              <div className="zp-anim-scale-in flex items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-500/5 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-amber-200">
                  <Edit3 className="h-4 w-4" />
                  <span>لديك تغييرات غير محفوظة</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={onResetEdits}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" icon={Save} loading={saving} onClick={onSaveProfile}>
                    Save
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6" delay={120}>
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">الأمان والمصادقة</h3>
              <p className="text-xs text-slate-400">إدارة Password والمصادقة الثنائية</p>
            </div>
          </div>

          <div className="space-y-3">
            <SecurityAction
              icon={Key}
              title="Password"
              description="Change password الحالية"
              onClick={onOpenPassword}
              tone="amber"
            />

            <SecurityAction
              icon={Fingerprint}
              title="المصادقة الثنائية (2FA)"
              description={profile.twoFactorEnabled ? 'مفعّلة - حسابك محمي' : 'معطلة - يُنصح بالتفعيل'}
              onClick={onOpen2FA}
              tone={profile.twoFactorEnabled ? 'emerald' : 'rose'}
              badge={profile.twoFactorEnabled ? 'مفعّل' : 'معطّل'}
            />

            <SecurityAction
              icon={Clock}
              title="سجل النشاط"
              description="مراجعة آخر Security Events"
              onClick={() => {
                document.getElementById('activity-section')?.scrollIntoView({ behavior: 'smooth' })
              }}
              tone="indigo"
            />
          </div>
        </Card>

        <Card className="p-6" delay={180}>
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-400">
              <Monitor className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">الجلسات النشطة</h3>
              <p className="text-xs text-slate-400">الأجهزة الOnlineة حالياً بحسابك</p>
            </div>
          </div>

          <div className="space-y-3">
            <SessionItem
              device="Chrome على Windows"
              location="Cairo, Egypt"
              ip="197.32.45.12"
              current
              lastActive="الآن"
            />
            <SessionItem
              device="Safari على iPhone"
              location="الإسكندرية، مصر"
              ip="41.234.56.78"
              lastActive="منذ ساعتين"
            />
          </div>

          <Button
            variant="ghost"
            className="mt-4 w-full"
            icon={LogOut}
            onClick={() => {
              /* placeholder */
            }}
          >
            إنهاء كل الجلسات الأخرى
          </Button>
        </Card>

        <Card className="border-rose-500/20 bg-rose-500/5 p-6" delay={240}>
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-rose-500/10 p-2 text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">منطقة الخطر</h3>
              <p className="text-xs text-slate-400">إجراءات This cannot be undone عنها</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/3 p-4">
              <div>
                <p className="text-sm font-medium text-white">تصدير البيانات</p>
                <p className="text-xs text-slate-400">تنزيل نسخة من جميع بياناتك</p>
              </div>
              <Button variant="ghost" icon={Download} size="sm">
                تصدير
              </Button>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
              <div>
                <p className="text-sm font-medium text-rose-200">Delete الحساب</p>
                <p className="text-xs text-rose-300/70">Delete دائم لكل بياناتك وإعداداتك</p>
              </div>
              <Button variant="danger" icon={Trash2} size="sm" onClick={onOpenDelete}>
                Delete
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div id="activity-section" className="mt-6">
        <Card className="p-6" delay={300}>
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2 text-purple-400">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">سجل النشاط الSecurity</h3>
                <p className="text-xs text-slate-400">آخر الأحداث على حسابك</p>
              </div>
            </div>

            <SelectInput
              value={timeRange}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onTimeRangeChange(e.target.value)}
              className="sm:w-48"
            >
              {TIME_RANGES.map((r) => (
                <option key={r.value} value={r.value} className="bg-slate-900">
                  {r.label}
                </option>
              ))}
            </SelectInput>
          </div>

          {activitiesLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No يوجد نشاط"
              description="لم يتم رصد أي أحداث Securityة خNoل الفترة المحددة."
            />
          ) : (
            <div className="space-y-2">
              {activities.map((activity, index) => (
                <ActivityRow key={activity.id} activity={activity} index={index} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

// ==================================================================
// Sub-Components
// ==================================================================

function InfoBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-white/6 bg-white/3 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={cn('mt-1 text-sm font-semibold', highlight ? 'text-emerald-400' : 'text-white')}>{value}</p>
    </div>
  )
}

function SecurityAction({
  icon: Icon,
  title,
  description,
  onClick,
  tone,
  badge,
}: {
  icon: ElementType
  title: string
  description: string
  onClick: () => void
  tone: 'emerald' | 'rose' | 'amber' | 'indigo'
  badge?: string
}) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="zp-anim-fade-up flex w-full items-center justify-between gap-4 rounded-xl border border-white/8 bg-white/3 p-4 text-right transition-all hover:border-white/15 hover:bg-white/5"
    >
      <div className="flex items-center gap-3">
        <div className={cn('rounded-lg border p-2', tones[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-white">{title}</p>
          <p className="text-xs text-slate-400">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {badge && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400',
            )}
          >
            {badge}
          </span>
        )}
        <ChevronRight className="h-4 w-4 text-slate-500" />
      </div>
    </button>
  )
}

function SessionItem({
  device,
  location,
  ip,
  current,
  lastActive,
}: {
  device: string
  location: string
  ip: string
  current?: boolean
  lastActive: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-xl border p-3',
        current ? 'border-cyan-500/20 bg-cyan-500/5' : 'border-white/8 bg-white/3',
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('rounded-lg p-2', current ? 'bg-cyan-500/10 text-cyan-400' : 'bg-slate-500/10 text-slate-400')}>
          <Monitor className="h-4 w-4" />
        </div>
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            {device}
            {current && <span className="text-xs text-cyan-400">(الحالية)</span>}
          </p>
          <p className="text-xs text-slate-400">
            {location} • {ip}
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-400">{lastActive}</p>
    </div>
  )
}

function ActivityRow({ activity, index }: { activity: ActivityLog; index: number }) {
  const meta = ACTIVITY_META[activity.type] || ACTIVITY_META.LOGIN
  const ActivityIcon = meta.icon

  return (
    <div
      className="zp-anim-fade-up flex items-center justify-between gap-4 rounded-xl border border-white/8 bg-white/3 p-4 transition-all hover:bg-white/5"
      style={{ animationDelay: `${Math.min(index * 40, 300)}ms` }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', meta.color)}>
          <ActivityIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{activity.description}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Monitor className="h-3 w-3" />
              {activity.ipAddress}
            </span>
            {activity.country && <span>• {activity.country}</span>}
            <span>• {timeAgo(activity.createdAt)}</span>
          </div>
        </div>
      </div>

      <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium', meta.color)}>
        {meta.label}
      </span>
    </div>
  )
}