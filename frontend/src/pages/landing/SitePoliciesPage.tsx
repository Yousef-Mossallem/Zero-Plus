// frontend/src/pages/landing/LegalPage.tsx
// ==================================================================
// Zero Plus - Legal / Policies Page ("/legal")
// Privacy Policy • Terms of Service • Security & Data Isolation
// ==================================================================
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ShieldCheck,
  FileText,
  LockKeyhole,
  Eye,
  Database,
  Server,
  Key,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  Mail,
  Scale,
  Ban,
  Fingerprint,
  Network,
} from 'lucide-react'
import LandingLayout from './LandingLayout'
import { GradientText, SectionHeading, cardClass } from './LandingShared'

// ==================================================================
// Tabs Config
// ==================================================================
type TabId = 'privacy' | 'terms' | 'security'

interface TabConfig {
  id: TabId
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const TABS: TabConfig[] = [
  {
    id: 'privacy',
    label: 'Privacy Policy',
    description: 'How we collect, use, and protect your data',
    icon: Eye,
  },
  {
    id: 'terms',
    label: 'Terms of Service',
    description: 'Rules and responsibilities when using Zero Plus',
    icon: Scale,
  },
  {
    id: 'security',
    label: 'Security & Data Isolation',
    description: 'How we protect each company\'s data and isolate it from others',
    icon: LockKeyhole,
  },
]

// ==================================================================
// Content Sections
// ==================================================================
function PrivacyContent() {
  return (
    <div className="space-y-8">
      <Section
        icon={Database}
        title="1. Data We Collect"
      >
        <p>We collect only the data necessary to operate and improve the protection service:</p>
        <ul className="mt-3 space-y-2 text-sm">
          <InfoItem>
            <strong>Request data:</strong> IP, User-Agent, TLS/JA3/JA4 fingerprint, approximate geographic location.
          </InfoItem>
          <InfoItem>
            <strong>Account data:</strong> Company name, email address, protected Domain(s).
          </InfoItem>
          <InfoItem>
            <strong>Event data:</strong> Log of decisions (Allow/Block/Challenge) for each request.
          </InfoItem>
          <InfoItem>
            <strong>We do NOT collect:</strong> Request content, passwords, payment data, or any sensitive personal information.
          </InfoItem>
        </ul>
      </Section>

      <Section
        icon={Users}
        title="2. How We Use Your Data"
      >
        <ul className="space-y-2 text-sm">
          <InfoItem>Making real-time protection decisions (Allow/Block/Challenge).</InfoItem>
          <InfoItem>Building device Reputation Scores to prevent future attacks.</InfoItem>
          <InfoItem>Federated immunity: sharing only the attacker's fingerprint (without identity) with other clients.</InfoItem>
          <InfoItem>Generating human-readable reports to understand security events.</InfoItem>
          <InfoItem>Improving engine performance and reducing False Positives.</InfoItem>
        </ul>
      </Section>

      <Section
        icon={ShieldCheck}
        title="3. Your Rights"
      >
        <ul className="space-y-2 text-sm">
          <InfoItem>
            <strong>Access:</strong> You can view all data stored about your company at any time from the Dashboard.
          </InfoItem>
          <InfoItem>
            <strong>Export:</strong> Export event logs in CSV or JSON format.
          </InfoItem>
          <InfoItem>
            <strong>Deletion:</strong> Request deletion of your account and all its data (executed within 30 days).
          </InfoItem>
          <InfoItem>
            <strong>Objection:</strong> Object to any protection decision via Contact us.
          </InfoItem>
        </ul>
      </Section>

      <Section
        icon={Clock}
        title="4. Data Retention"
      >
        <p>
          We retain event data for <strong>90 days</strong> by default. Account data is kept as long as the account is active.
          After account deletion, all associated data is deleted from our servers and backups within 30 days.
        </p>
      </Section>

      <Section
        icon={Mail}
        title="5. Contact"
      >
        <p>
          For any privacy inquiries, contact us at{' '}
          <span className="text-cyan-400">privacy@zeroplus.example</span>
        </p>
      </Section>
    </div>
  )
}

function TermsContent() {
  return (
    <div className="space-y-8">
      <Section
        icon={FileText}
        title="1. Acceptance of Terms"
      >
        <p>
          By using Zero Plus, you agree to these terms. If you don't agree, do not use the service.
          We reserve the right to update these terms, and we will notify you of any significant changes via email.
        </p>
      </Section>

      <Section
        icon={Globe}
        title="2. Service Description"
      >
        <p>
          Zero Plus is a smart Reverse Proxy service that protects your sites from DDoS attacks through:
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          <InfoItem>Tiered Detection based on device reputation.</InfoItem>
          <InfoItem>Federated Threat Memory among clients.</InfoItem>
          <InfoItem>Strict Tenant Isolation for each company.</InfoItem>
          <InfoItem>Human-readable security reports.</InfoItem>
        </ul>
      </Section>

      <Section
        icon={AlertTriangle}
        title="3. Your Responsibilities"
      >
        <ul className="space-y-2 text-sm">
          <InfoItem>Provide accurate information when creating your account.</InfoItem>
          <InfoItem>Maintain the confidentiality of your credentials.</InfoItem>
          <InfoItem>Do not use the service for any illegal or harmful activity.</InfoItem>
          <InfoItem>Notify us immediately upon discovering any breach or unauthorized use.</InfoItem>
          <InfoItem>Comply with the required DNS settings to ensure protection operates correctly.</InfoItem>
        </ul>
      </Section>

      <Section
        icon={Ban}
        title="4. Restrictions"
      >
        <p>The following are strictly prohibited:</p>
        <ul className="mt-3 space-y-2 text-sm">
          <InfoItem>Attempting to hack or disrupt the Zero Plus service itself.</InfoItem>
          <InfoItem>Using the service to protect sites that violate local or international laws.</InfoItem>
          <InfoItem>Sharing your account with third parties without written permission.</InfoItem>
          <InfoItem>Reselling the service or offering it as White-label without a partnership agreement.</InfoItem>
        </ul>
      </Section>

      <Section
        icon={Scale}
        title="5. Limitation of Liability"
      >
        <p>
          Zero Plus is provided "As-Is". We do not guarantee 100% protection from all attacks,
          but we do our utmost using the latest protection technologies. We are not liable for
          any indirect damages resulting from the use of the service.
        </p>
      </Section>

      <Section
        icon={Clock}
        title="6. Termination"
      >
        <p>
          You can cancel your account at any time. We reserve the right to terminate your account
          immediately in case of violation of these terms. After termination, your data is deleted within 30 days.
        </p>
      </Section>
    </div>
  )
}

function SecurityContent() {
  return (
    <div className="space-y-8">
      <Section
        icon={LockKeyhole}
        title="1. Data Isolation (Tenant Isolation)"
      >
        <p>
          Each company (Tenant) has a completely separate data environment:
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          <InfoItem>
            <strong>Separate database:</strong> Each Tenant has a separate schema in PostgreSQL.
          </InfoItem>
          <InfoItem>
            <strong>Private encryption keys:</strong> Each Tenant has its own AES-256 key to encrypt its sensitive data.
          </InfoItem>
          <InfoItem>
            <strong>Application-level separation:</strong> Middleware verifies Tenant ID on every request.
          </InfoItem>
          <InfoItem>
            <strong>No sharing:</strong> A breach of one client never extends to another client.
          </InfoItem>
        </ul>
      </Section>

      <Section
        icon={Key}
        title="2. Encryption"
      >
        <ul className="space-y-2 text-sm">
          <InfoItem>
            <strong>In Transit:</strong> TLS 1.3 for all connections between the visitor and Zero Plus, and between Zero Plus and the Origin.
          </InfoItem>
          <InfoItem>
            <strong>At Rest:</strong> AES-256-GCM for sensitive data (Credentials, API Keys).
          </InfoItem>
          <InfoItem>
            <strong>Key management:</strong> Encryption keys are stored in a separate Vault, not in the database.
          </InfoItem>
        </ul>
      </Section>

      <Section
        icon={Network}
        title="3. Federated Threat Memory"
      >
        <p>
          The first client attacked instantly immunizes all others, but with complete privacy:
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          <InfoItem>
            <strong>What's shared:</strong> Only the attacker's fingerprint (IP + JA3/JA4 Hash).
          </InfoItem>
          <InfoItem>
            <strong>What's NOT shared:</strong> The identity of the attacked client, legitimate visitor data, or any personal information.
          </InfoItem>
          <InfoItem>
            <strong>Result:</strong> All clients are protected from the same attack within seconds, without exposing any sensitive data.
          </InfoItem>
        </ul>
      </Section>

      <Section
        icon={Fingerprint}
        title="4. Reputation System"
      >
        <ul className="space-y-2 text-sm">
          <InfoItem>
            <strong>Lazy Registration:</strong> A new device is innocent until proven otherwise. We don't register it unless an actual bad event occurs.
          </InfoItem>
          <InfoItem>
            <strong>Reputation from 1 to 10:</strong> Built only on actual bad events, not on assumptions.
          </InfoItem>
          <InfoItem>
            <strong>Bias toward legitimate users:</strong> ~90% of legitimate visitors pass through lightweight and fast checks.
          </InfoItem>
        </ul>
      </Section>

      <Section
        icon={Server}
        title="5. Infrastructure"
      >
        <ul className="space-y-2 text-sm">
          <InfoItem>
            <strong>Docker + Nginx:</strong> Each service in an isolated Container.
          </InfoItem>
          <InfoItem>
            <strong>PostgreSQL + Redis:</strong> Separate database and Cache for each Tenant.
          </InfoItem>
          <InfoItem>
            <strong>Socket.io:</strong> Encrypted Real-time connections between the Dashboard and the Backend.
          </InfoItem>
          <InfoItem>
            <strong>Continuous monitoring:</strong> Instant alerts for any suspicious activity.
          </InfoItem>
        </ul>
      </Section>

      <Section
        icon={CheckCircle2}
        title="6. Compliance & Standards"
      >
        <p>
          Zero Plus is designed to comply with:
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          <InfoItem><strong>GDPR:</strong> Rights of access, export, and deletion.</InfoItem>
          <InfoItem><strong>OWASP Top 10:</strong> Protection against the most common web vulnerabilities.</InfoItem>
          <InfoItem><strong>Principle of Least Privilege:</strong> Each component receives the minimum necessary permissions.</InfoItem>
        </ul>
      </Section>
    </div>
  )
}

// ==================================================================
// Small Components
// ==================================================================
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className={`${cardClass} p-6 transition-all duration-300 hover:border-cyan-500/20`}>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      <div className="text-sm leading-relaxed text-slate-400">
        {children}
      </div>
    </div>
  )
}

function InfoItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
      <span>{children}</span>
    </li>
  )
}

// ==================================================================
// Main Component
// ==================================================================
export default function LegalPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabId>(
    (searchParams.get('tab') as TabId) || 'privacy'
  )

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId)
    setSearchParams({ tab: tabId })
  }

  const activeConfig = TABS.find((t) => t.id === activeTab)!

  return (
    <LandingLayout>
      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-12 pt-16 text-center sm:pt-24">
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
          Policies & Legal
          <span className="mt-2 block">
            <GradientText>Transparency is our priority</GradientText>
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl leading-relaxed text-slate-400">
          Here are all the details about how we handle your data, your rights, and how we protect you.
        </p>
      </section>

      {/* Tabs Navigation */}
      <section className="mx-auto max-w-4xl px-6">
        <div className={`${cardClass} mb-8 flex flex-wrap gap-2 p-2`}>
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-300 ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-300 shadow-lg shadow-cyan-500/10'
                    : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tab Header */}
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <activeConfig.icon className="h-6 w-6 text-cyan-400" />
            <h2 className="text-2xl font-bold text-white">{activeConfig.label}</h2>
          </div>
          <p className="mt-3 text-sm text-slate-400">{activeConfig.description}</p>
        </div>

        {/* Content */}
        <div className="pb-16">
          {activeTab === 'privacy' && <PrivacyContent />}
          {activeTab === 'terms' && <TermsContent />}
          {activeTab === 'security' && <SecurityContent />}
        </div>
      </section>

      {/* Footer Note */}
      <section className="mx-auto max-w-4xl px-6 pb-16">
        <div className={`${cardClass} p-6 text-center`}>
          <p className="text-sm text-slate-400">
            Last updated: <span className="text-white">October 2026</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            For any inquiries, contact us at{' '}
            <span className="text-cyan-400">legal@zeroplus.example</span>
          </p>
        </div>
      </section>
    </LandingLayout>
  )
}