// frontend/src/pages/servers/shared.tsx — ثوابت وفاليديشن ونموذج السيرفر + زر النسخ
// i18n: STATUS_META.label مترجم (getter من servers.status.*)، والفاليديشن بيرجع
// مفاتيح ترجمة (validation.*) والمودال هو اللي يترجمها، وزر النسخ بيترجم رسائله.

import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { useToast } from '../../components/ui/Toast'
import { type Tone } from '../../components/ui/kit'
import type { ServerMode, ServerStatus } from '../../services/types'

// ==================================================================
// Constants
// ==================================================================

export const MANAGE_ROLES = ['OWNER', 'ADMIN']
export const PAGE_SIZE = 9

function status(tone: Tone, key: ServerStatus): { tone: Tone; label: string } {
  return {
    tone,
    get label() {
      return i18n.t(`status.${key}`, { ns: 'servers' })
    },
  }
}

export const STATUS_META: Record<ServerStatus, { tone: Tone; label: string }> = {
  ONLINE:      status('emerald', 'ONLINE'),
  PENDING:     status('slate',   'PENDING'),
  DEGRADED:    status('amber',   'DEGRADED'),
  OFFLINE:     status('rose',    'OFFLINE'),
  MAINTENANCE: status('indigo',  'MAINTENANCE'),
}

/** بادئة مفاتيح أخطاء الفاليديشن: أي رسالة بتبدأ بيها بتتترجم، والباقي (من الباك) بيتعرض زي ما هو */
export const VALIDATION_PREFIX = 'validation.'

/** نفس بلوك الباك: بنرفض الحاجات الواضحة قبل الإرسال، والباقي الباك بيحكم عليه
 *  بيرجع مفاتيح ترجمة (مش جمل) — الترجمة بتتم وقت العرض */
export function validateServerForm(form: ServerForm): Record<string, string> {
  const errors: Record<string, string> = {}

  const domain = form.domain.trim().toLowerCase()
  if (!domain) errors.domain = 'validation.domain.required'
  else if (/^[a-z][a-z0-9+.-]*:\/\//.test(domain)) errors.domain = 'validation.domain.noProtocol'
  else if (/[\s/?#@\\:]/.test(domain)) errors.domain = 'validation.domain.noPathOrPort'
  else if (!domain.includes('.')) errors.domain = 'validation.domain.needsExtension'

  const ip = form.originIp.trim()
  const octets = ip.split('.')
  const ipOk = octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)
  if (!ip) errors.originIp = 'validation.originIp.required'
  else if (!ipOk) errors.originIp = 'validation.originIp.invalid'

  const port = Number(form.originPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.originPort = 'validation.originPort.range'
  }

  return errors
}

// ==================================================================
// Types for the form
// ==================================================================

export interface ServerForm {
  domain: string
  originIp: string
  originPort: string
  sslEnabled: boolean
  mode: ServerMode
}

export const EMPTY_FORM: ServerForm = {
  domain: '',
  originIp: '',
  originPort: '443',
  sslEnabled: true,
  mode: 'PROTECT',
}

// ==================================================================
// Copy button
// label = الاسم المترجم للحقل (مثلاً "Name") وبيتحط جوه الرسالة
// ==================================================================

export function CopyButton({ text, label }: { text: string; label: string }) {
  const toast = useToast()
  const { t } = useTranslation('servers')

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          toast.success(t('toast.copied', { label }))
        } catch {
          toast.error(t('toast.copyFailed'), t('toast.copyBlocked'))
        }
      }}
      className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-cyan-300"
      aria-label={t('toast.copyAria', { label })}
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  )
}
