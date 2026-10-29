// frontend/src/pages/landing/LandingPage.tsx
// ==================================================================
// Zero Plus - Landing Page ("/")
// Hero • Problem Stats • Features • Pipeline • Journey • CTA
// ==================================================================
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Layers,
  Fingerprint,
  Network,
  LockKeyhole,
  Zap,
  FileText,
  Check,
  Ban,
  Globe,
  Server,
  Shield,
} from 'lucide-react'
import { useAuthStore, selectIsAuthenticated } from '../../store/authStore'
import LandingLayout from './LandingLayout'
import { GradientText, SectionHeading, cardClass } from './LandingShared'

// ==================================================================
// Data
// ==================================================================
const STATS = [
  { value: '47.1M', label: 'DDoS attacks detected by Cloudflare in 2025' },
  { value: '+121%', label: 'Increase in attacks compared to the previous year' },
  { value: '31.4 Tbps', label: 'Largest attack ever recorded (December 2025)' },
  { value: '~90%', label: 'Of legitimate visitors pass through lightweight checks' },
]

const FEATURES = [
  {
    icon: Layers,
    title: 'Tiered Detection',
    desc: 'New devices are treated simply, while those with a bad history undergo deeper inspection. Heavy checks are reserved only for those who deserve them.',
  },
  {
    icon: Fingerprint,
    title: 'Reputation System (1 to 10)',
    desc: 'Cumulative reputation per device based only on actual bad events, giving new devices a fair chance.',
  },
  {
    icon: Zap,
    title: 'Silent Verification (No CAPTCHA)',
    desc: 'JS Challenge runs inside the browser without bothering real visitors, escalating gradually as suspicion rises.',
  },
  {
    icon: Network,
    title: 'Federated Threat Memory',
    desc: 'The first client attacked instantly immunizes all others, by sharing only the attacker\'s fingerprint without any sensitive data.',
  },
  {
    icon: LockKeyhole,
    title: 'Strict Tenant Isolation',
    desc: 'Each company has a separate data environment with its own encryption keys. A breach of one client never extends to another.',
  },
  {
    icon: FileText,
    title: 'Human-Readable Reports',
    desc: 'A clear text summary for every security event, instead of raw numbers and tables only, with instant alerts for any emergency.',
  },
]

const PIPELINE = [
  { name: 'Intake Classifier', role: 'Sorts the request: new device or existing profile?' },
  { name: 'Baseline Verifier', role: 'Silent JS Challenge for new visitors' },
  { name: 'IP Reputation Scanner', role: 'Detects requests coming from Data Centers' },
  { name: 'Similarity Matcher', role: 'Compares IP + device fingerprint + location against records' },
  { name: 'Deep Comparison Engine', role: 'Deeper comparison when an initial match is found' },
  { name: 'Fingerprint Authenticator', role: 'TLS/JA3/JA4 check for suspicious devices only' },
  { name: 'Traffic Orchestrator', role: 'Routes safe requests to Servers' },
  { name: 'Adaptive Dashboard Engine', role: 'Interface that adapts to each user\'s style' },
  { name: 'Isolation & Immunity Manager', role: 'Data isolation and federated immunity deployment' },
]

const STEPS = [
  { title: 'Create your account', desc: 'An Organization is created along with an Admin user.' },
  { title: 'Add your server', desc: 'Enter the Domain, Origin Server address, and Port.' },
  { title: 'Update DNS settings', desc: 'We provide the required records to point the domain to Zero Plus.' },
  { title: 'We verify the setup', desc: 'We confirm that both the Gateway and Origin are reachable.' },
  { title: 'Protection is live', desc: 'All traffic passes through Zero Plus before reaching your server.' },
]

const DEMO_ROWS = [
  { label: 'New visitor · JS Challenge passed', allowed: true },
  { label: 'Device with reputation 2 · Light check', allowed: true },
  { label: 'IP from Data Center · Suspicious JA3 fingerprint', allowed: false },
  { label: 'Known fingerprint from federated immunity', allowed: false },
]

// ==================================================================
// Component
// ==================================================================
export default function LandingPage() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const ctaTo = isAuthenticated ? '/dashboard' : '/signup'
  const ctaLabel = isAuthenticated ? 'Go to Dashboard' : 'Start protection now'

  return (
    <LandingLayout>
      {/* Hero */}
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-2 lg:pt-24">
        <div className="space-y-7">
          <h1 className="text-4xl font-bold leading-[1.25] tracking-tight text-white sm:text-5xl xl:text-6xl">
            Protect your site from DDoS attacks
            <span className="mt-2 block">
              <GradientText>A gateway that scores every visitor by reputation</GradientText>
            </span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-slate-400">
            Zero Plus is a middleware layer (Reverse Proxy) between visitors and
            your real server. We don't treat everyone equally: we build memory of
            devices we've seen, and quickly decide who passes directly and who
            deserves deeper inspection.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to={ctaTo}
              className="group flex items-center gap-2 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:brightness-110"
            >
              {ctaLabel}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              to="/about"
              className="rounded-xl border border-white/10 bg-white/3 px-7 py-3.5 text-sm font-medium text-slate-200 hover:border-white/20 hover:bg-white/5"
            >
              Learn about the project
            </Link>
          </div>
        </div>

        {/* Demo Card */}
        <div className={`${cardClass} relative overflow-hidden p-6 shadow-2xl shadow-black/40`}>
          <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-semibold text-white">Engine decisions (example)</h2>
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Protection Active
            </span>
          </div>
          <ul className="space-y-3">
            {DEMO_ROWS.map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/2 px-4 py-3 text-sm"
              >
                <span className="text-slate-300">{row.label}</span>
                <span
                  className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
                    row.allowed
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-rose-500/10 text-rose-400'
                  }`}
                >
                  {row.allowed ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                  {row.allowed ? 'Allow' : 'Block'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          title="The problem grows every year"
          description="Any cheap, insecure smart device in any home can become a weapon in the hands of a third party without its owner's knowledge. Traditional solutions are either too expensive or bother visitors with CAPTCHAs."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className={`${cardClass} p-6`}>
              <p className="text-3xl font-bold text-white" dir="ltr">
                {s.value}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          title="What Zero Plus delivers"
          description="Smarter, more resource-efficient protection, with clear and explainable logic instead of a black box."
        />
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className={`${cardClass} p-6 hover:border-cyan-500/30`}
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 font-semibold text-white">{title}</h3>
              <p className="text-sm leading-relaxed text-slate-400">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pipeline */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          title="Nine modules, each with one job"
          description="Each request passes through successive modules, and each module forwards only those who deserve the next stage. That's why heavy inspection remains rare and targeted."
        />
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((p, i) => (
            <li key={p.name} className={`${cardClass} flex gap-4 p-5`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-cyan-400 to-blue-600 text-sm font-bold text-white">
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-white" dir="ltr">
                  {p.name}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{p.role}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Before / After */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHeading
          title="How a request is handled"
          description="No software installation required. Just change your DNS settings, and we run the infrastructure."
        />
        <div className={`${cardClass} mb-4 p-5`}>
          <p className="mb-3 text-sm font-medium text-slate-400">Before Zero Plus</p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <FlowNode icon={Globe} label="Internet" />
            <FlowArrow />
            <FlowNode icon={Server} label="Company Server" tone="rose" />
            <span className="text-xs text-rose-400">Anyone reaches directly</span>
          </div>
        </div>
        <div className={`${cardClass} border-cyan-500/30 p-5`}>
          <p className="mb-3 text-sm font-medium text-cyan-300">After Zero Plus</p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <FlowNode icon={Globe} label="Internet" />
            <FlowArrow />
            <FlowNode icon={Shield} label="Zero Plus" tone="cyan" />
            <FlowArrow />
            <FlowNode icon={Server} label="Company Server" />
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading title="From signup to protection in five steps" />
        <ol className="grid gap-4 md:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className={`${cardClass} p-5`}>
              <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full border border-cyan-500/40 text-sm font-bold text-cyan-300">
                {i + 1}
              </span>
              <h3 className="mb-1.5 text-sm font-semibold text-white">{s.title}</h3>
              <p className="text-xs leading-relaxed text-slate-400">{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-4xl px-6 pt-16">
        <div className={`${cardClass} relative overflow-hidden px-8 py-14 text-center`}>
          <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to protect your server?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-400">
            Create your account and add your first protected server, or contact us if you have any questions.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to={ctaTo}
              className="rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:brightness-110"
            >
              {ctaLabel}
            </Link>
            <Link
              to="/contact"
              className="rounded-xl border border-white/10 px-7 py-3.5 text-sm font-medium text-slate-200 hover:bg-white/5"
            >
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </LandingLayout>
  )
}

// ==================================================================
// Small Local Components
// ==================================================================
function FlowNode({
  icon: Icon,
  label,
  tone = 'slate',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone?: 'slate' | 'cyan' | 'rose'
}) {
  const tones = {
    slate: 'border-white/10 bg-white/3 text-slate-200',
    cyan: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  }
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 ${tones[tone]}`}>
      <Icon className="h-4 w-4" />
      {label}
    </div>
  )
}

function FlowArrow() {
  return <span className="text-slate-600">→</span>
}