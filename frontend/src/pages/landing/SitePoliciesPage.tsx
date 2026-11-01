// frontend/src/pages/landing/SitePoliciesPage.tsx

import { useSearchParams } from 'react-router-dom'
import { ShieldCheck, FileText, LockKeyhole } from 'lucide-react'

import LandingLayout from './LandingLayout'
import { GradientText, PageHero, cardClass } from './LandingShared'

interface PolicySection {
  heading: string
  body?: string
  points?: string[]
}

interface Policy {
  id: 'privacy' | 'terms' | 'security'
  label: string
  icon: React.ComponentType<{ className?: string }>
  intro: string
  sections: PolicySection[]
}

const POLICIES: Policy[] = [
  {
    id: 'privacy',
    label: 'Privacy Policy',
    icon: ShieldCheck,
    intro:
      'This policy explains what data Zero Plus collects, why, and how we protect it.',
    sections: [
      {
        heading: 'Data we collect',
        points: [
          'Account data: name, email, Organization name, and user role.',
          'Protected server data: domain, origin server address, and port.',
          'Request data passing through the Gateway: IP address, device fingerprint, TLS/JA3/JA4 fingerprint, approximate geolocation, and the decision taken.',
        ],
      },
      {
        heading: 'How we use the data',
        points: [
          'Decide allow, block, or extra checks for every request.',
          'Show events, reports, and alerts inside your organization’s dashboard.',
          'Improve detection accuracy and reduce false positives.',
        ],
      },
      {
        heading: 'Lazy Registration',
        body: 'We do not create a permanent record for any device unless a real bad event comes from it. A visitor who causes no problem does not get a reputation profile.',
      },
      {
        heading: 'Third-party services',
        body: 'We use the Gemini API only to draft report and notification text—turning data about an event that already happened (attack type, severity, IP) into plain language. Gemini does not take part in any security decision.',
      },
      {
        heading: 'Your rights',
        body: 'You can request access to, correction of, or deletion of your organization’s data by contacting us via the Contact page or at example@example.com.',
      },
    ],
  },
  {
    id: 'terms',
    label: 'Terms of Service',
    icon: FileText,
    intro: 'By using Zero Plus you agree to the following terms.',
    sections: [
      {
        heading: 'Service description',
        body: 'Zero Plus is a SaaS reverse proxy between your site’s visitors and your real server. It inspects requests and decides to allow, block, or apply extra verification. We run the infrastructure; you do not install any software.',
      },
      {
        heading: 'Customer responsibilities',
        points: [
          'Provide accurate account and server data, and keep login credentials confidential.',
          'Change DNS settings as we specify so traffic flows through Zero Plus.',
          'Prevent direct access to the origin server from outside Zero Plus; otherwise protection can be bypassed.',
          'Responsibility for users you add to your organization and their permissions.',
        ],
      },
      {
        heading: 'Acceptable use',
        points: [
          'Using the service to protect illegal sites or services is prohibited.',
          'Attempting to hack the service, bypass its limits, or access another customer’s data is prohibited.',
          'Using the Simulation Lab against any server you do not own is prohibited.',
        ],
      },
      {
        heading: 'Service limits',
        body: 'We make every effort to keep protection continuous and accurate, but we cannot guarantee blocking every attack 100%, and a legitimate visitor may rarely be blocked by mistake. The dashboard provides tools to review such cases.',
      },
      {
        heading: 'Account suspension and changes',
        body: 'We may suspend an account for violating these terms. You may stop using the service at any time. We may update these terms from time to time and will notify you of material changes before they take effect.',
      },
    ],
  },
  {
    id: 'security',
    label: 'Security & Data Isolation',
    icon: LockKeyhole,
    intro:
      'How we protect each customer’s data, what is shared, and what never leaves your environment.',
    sections: [
      {
        heading: 'Tenant Isolation',
        points: [
          'Each customer has a logically separate data environment that does not overlap with any other customer.',
          'Independent encryption keys per customer; unauthorized access to one company’s data does not grant access to another.',
          'Each company’s reputation log and blacklist stay local inside its environment.',
        ],
      },
      {
        heading: 'Federated Threat Memory',
        body: 'When a bad event is confirmed, we extract only the attacking device’s fingerprint (e.g. TLS/JA3/JA4 type), stripped of any identity, and add it to a shared threat memory so other customers are hardened before they face the same attack.',
      },
      {
        heading: 'What is shared and what is not',
        points: [
          'Shared: the stripped threat fingerprint—non-sensitive data with no company identifier.',
          'Never shared: user data, server details, full logs, account information.',
        ],
      },
      {
        heading: 'Security decisions independent of external services',
        body: 'Allow and block decisions are made entirely inside the Zero Plus engine. External services (e.g. Gemini) are used only to draft text after the decision; no sensitive decision depends on a third-party response.',
      },
      {
        heading: 'Reporting a security vulnerability',
        body: 'If you discover a vulnerability in Zero Plus, email security@example.com with details. We will review it seriously and respond.',
      },
    ],
  },
]

export default function SitePoliciesPage() {
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const active = POLICIES.find((p) => p.id === tabParam) ?? POLICIES[0]

  return (
    <LandingLayout>
      <PageHero
        title={
          <>
            Policies <GradientText>& terms</GradientText>
          </>
        }
        description="We state clearly how we handle your data, what you can expect from us, and what we expect from you."
      />

      <section className="mx-auto max-w-4xl px-6 py-8">
        <div
          role="tablist"
          className="mb-8 flex flex-wrap gap-2 rounded-2xl border border-white/8 bg-white/3 p-2"
        >
          {POLICIES.map(({ id, label, icon: Icon }) => {
            const isActive = id === active.id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setParams({ tab: id }, { replace: true })}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.2)]'
                    : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span dir="ltr">{label}</span>
              </button>
            )
          })}
        </div>

        <article className={`${cardClass} p-8`} role="tabpanel">
          <p className="mb-8 leading-relaxed text-slate-300">{active.intro}</p>

          <div className="space-y-8">
            {active.sections.map((section) => (
              <div key={section.heading}>
                <h2 className="mb-3 text-lg font-semibold text-white">
                  {section.heading}
                </h2>

                {section.body && (
                  <p className="leading-loose text-slate-400">{section.body}</p>
                )}

                {section.points && (
                  <ul className="space-y-2.5">
                    {section.points.map((point) => (
                      <li key={point} className="flex gap-3 leading-relaxed text-slate-400">
                        <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <p className="mt-10 border-t border-white/6 pt-5 text-xs text-slate-600">
            Last updated: October 2026
          </p>
        </article>
      </section>
    </LandingLayout>
  )
}