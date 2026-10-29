// frontend/src/pages/landing/ContactPage.tsx
// ==================================================================
// Zero Plus - Contact Page ("/contact")
// Contact info + Form: Name • Email • Subject • Message
// ==================================================================
import { useState, type FormEvent } from 'react'
import {
  Mail,
  Phone,
  MapPin,
  Clock,
  Send,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import LandingLayout from './LandingLayout'
import { GradientText, PageHero, cardClass } from './LandingShared'

// ==================================================================
// Types & Config
// ==================================================================
interface ContactForm {
  name: string
  email: string
  subject: string
  message: string
}
type FormErrors = Partial<Record<keyof ContactForm, string>>

const EMPTY_FORM: ContactForm = { name: '', email: '', subject: '', message: '' }

const CONTACT_INFO = [
  { icon: Mail, label: 'Email', value: 'example@example.com' },
  { icon: Phone, label: 'Phone', value: '+20 000 000 0000' },
  { icon: MapPin, label: 'Address', value: 'Cairo, Egypt' },
  { icon: Clock, label: 'Response time', value: 'Within one business day' },
]

const inputClass = (hasError: boolean) =>
  `w-full rounded-xl border bg-white/3 px-4 py-3 text-base sm:text-sm text-white placeholder:text-slate-600 outline-none transition-all duration-200 focus:border-cyan-500/50 focus:bg-white/5 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-50 ${
    hasError ? 'border-rose-500/50' : 'border-white/10 hover:border-white/20'
  }`

// ==================================================================
// Component
// ==================================================================
export default function ContactPage() {
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<FormErrors>({})
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleChange = (field: keyof ContactForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (sent) setSent(false)
  }

  const validate = (): boolean => {
    const next: FormErrors = {}
    if (!form.name.trim()) next.name = 'Name is required'
    if (!form.email.trim()) {
      next.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.email = 'Invalid email format'
    }
    if (!form.subject.trim()) next.subject = 'Subject is required'
    if (form.message.trim().length < 10) {
      next.message = 'Write a message of at least 10 characters'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setSending(true)
    await new Promise((resolve) => setTimeout(resolve, 800))
    setSending(false)
    setSent(true)
    setForm(EMPTY_FORM)
  }

  return (
    <LandingLayout>
      <PageHero
        title={
          <>
            We'd love to <GradientText>hear from you</GradientText>
          </>
        }
        description="For any question about Zero Plus, a trial request, or a technical inquiry, write to us and we'll get back to you as soon as possible."
      />

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-5">
        {/* Contact Info */}
        <aside className="space-y-4 lg:col-span-2">
          {CONTACT_INFO.map(({ icon: Icon, label, value }) => (
            <div key={label} className={`${cardClass} flex items-center gap-4 p-5`}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="truncate text-sm font-medium text-white">
                  {value}
                </p>
              </div>
            </div>
          ))}
        </aside>

        {/* Form */}
        <div className={`${cardClass} relative overflow-hidden p-7 lg:col-span-3`}>
          <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />
          <h2 className="mb-6 text-xl font-bold text-white">Send us a message</h2>

          {sent && (
            <div
              role="status"
              className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>We received your message. We'll contact you on your email shortly.</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Name" error={errors.name}>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Your full name"
                  disabled={sending}
                  autoComplete="name"
                  className={inputClass(!!errors.name)}
                />
              </Field>
              <Field label="Email" error={errors.email}>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="you@company.com"
                  disabled={sending}
                  autoComplete="email"
                  className={inputClass(!!errors.email)}
                />
              </Field>
            </div>
            <Field label="Subject" error={errors.subject}>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => handleChange('subject', e.target.value)}
                placeholder="e.g. Question about server protection"
                disabled={sending}
                className={inputClass(!!errors.subject)}
              />
            </Field>
            <Field label="Message" error={errors.message}>
              <textarea
                rows={6}
                value={form.message}
                onChange={(e) => handleChange('message', e.target.value)}
                placeholder="Write the details of your request here..."
                disabled={sending}
                className={`${inputClass(!!errors.message)} resize-none`}
              />
            </Field>
            <button
              type="submit"
              disabled={sending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  Send Message
                  <Send className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </section>
    </LandingLayout>
  )
}

// ==================================================================
// Field (Label + Input + Error message)
// ==================================================================
function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      {children}
      {error && (
        <span className="flex items-center gap-1.5 text-xs text-rose-400">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </span>
      )}
    </label>
  )
}