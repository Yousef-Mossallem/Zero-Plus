// frontend/src/pages/servers/shared.tsx — ثوابت وفاليديشن ونموذج السيرفر + زر النسخ

import { Copy } from 'lucide-react'
import { useToast } from '../../components/ui/Toast'
import { type Tone } from '../../components/ui/kit'
import type { ServerMode, ServerStatus } from '../../services/types'


// ==================================================================
// Constants
// ==================================================================

export const MANAGE_ROLES = ['OWNER', 'ADMIN']
export const PAGE_SIZE = 9

export const STATUS_META: Record<ServerStatus, { tone: Tone; label: string }> = {
  ONLINE: { tone: 'emerald', label: 'Online' },
  PENDING: { tone: 'slate', label: 'Pending setup' },
  DEGRADED: { tone: 'amber', label: 'Degraded' },
  OFFLINE: { tone: 'rose', label: 'Offline' },
  MAINTENANCE: { tone: 'indigo', label: 'Maintenance' },
}

/** نفس بلوك الباك: بنرفض الحاجات الواضحة قبل الإرسال، والباقي الباك بيحكم عليه */
export function validateServerForm(form: ServerForm): Record<string, string> {
  const errors: Record<string, string> = {}
  const domain = form.domain.trim().toLowerCase()

  if (!domain) errors.domain = 'Domain is required'
  else if (/^[a-z][a-z0-9+.-]*:\/\//.test(domain)) errors.domain = 'Enter the domain only, without http:// or https://'
  else if (/[\s/?#@\\:]/.test(domain)) errors.domain = 'Enter the domain only (no path, port or spaces)'
  else if (!domain.includes('.')) errors.domain = 'Domain needs an extension, e.g. shop.example.com'

  const ip = form.originIp.trim()
  const octets = ip.split('.')
  const ipOk =
    octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)
  if (!ip) errors.originIp = 'Origin IP is required'
  else if (!ipOk) errors.originIp = 'Enter a valid IPv4 address'

  const port = Number(form.originPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.originPort = 'Port must be between 1 and 65535'
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
// ==================================================================

export function CopyButton({ text, label }: { text: string; label: string }) {
  const toast = useToast()
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          toast.success(`${label} copied`)
        } catch {
          toast.error('Copy failed', 'Your browser blocked clipboard access')
        }
      }}
      className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-cyan-300"
      aria-label={`Copy ${label}`}
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  )
}
