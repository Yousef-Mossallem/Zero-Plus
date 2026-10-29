// frontend/src/pages/landing/AboutPage.tsx
// ==================================================================
// Zero Plus - About Page ("/about")
// Vision • Problem • Principles • Decision vs Explanation • Tech Stack
// ==================================================================
import { Link } from 'react-router-dom'
import { Eye, Target, Scale, Scan, Users, EyeOff, Cpu, MessageSquareText } from 'lucide-react'
import LandingLayout from './LandingLayout'
import { GradientText, PageHero, SectionHeading, cardClass } from './LandingShared'

// ==================================================================
// Data
// ==================================================================
const PRINCIPLES = [
  {
    icon: EyeOff,
    title: 'Clear logic instead of a black box',
    desc: 'The allow/block decision passes through known modules, each with a single role. You can understand why any decision was made and review it.',
  },
  {
    icon: Scale,
    title: 'A fair chance for every new device',
    desc: 'We don\'t register a device unless an actual bad event occurs (Lazy Registration). A new device is innocent until proven otherwise.',
  },
  {
    icon: Scan,
    title: 'Heavy inspection only for those who deserve it',
    desc: 'Deeper checks (like TLS/JA3/JA4) are reserved for a small suspicious percentage, saving resources and reducing latency.',
  },
  {
    icon: Users,
    title: 'Privacy without compromise',
    desc: 'Each company\'s data stays within its isolated environment. The only shared element is the threat fingerprint stripped of any identity.',
  },
]

const STACK = [
  { layer: 'Frontend', items: 'React, TypeScript, Vite, Tailwind CSS, Zustand, Recharts' },
  { layer: 'Backend', items: 'Node.js, Express, TypeScript, Socket.io, Zod' },
  { layer: 'Infrastructure', items: 'Docker, Nginx, PostgreSQL, Redis' },
  { layer: 'IoT Simulation', items: 'ESP32 + MicroPython to simulate legitimate and attacking devices' },
]

// ==================================================================
// Component
// ==================================================================
export default function AboutPage() {
  return (
    <LandingLayout>
      <PageHero
        title={
          <>
            Reorganizing protection with <GradientText>Smarter security</GradientText>
          </>
        }
        description="Zero Plus is a project aimed at making DDoS protection accessible and transparent for small and medium-sized businesses, without the cost of enterprise solutions and without bothering visitors."
      />

      {/* Vision & Mission */}
      <section className="mx-auto grid max-w-5xl gap-5 px-6 py-8 md:grid-cols-2">
        <div className={`${cardClass} p-7`}>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Eye className="h-5 w-5" />
          </div>
          <h2 className="mb-3 text-xl font-bold text-white">Our vision</h2>
          <p className="leading-relaxed text-slate-400">
            That every service on the internet continues to work even during an
            attack, and that real visitors reach the site smoothly as if nothing
            happened.
          </p>
        </div>
        <div className={`${cardClass} p-7`}>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Target className="h-5 w-5" />
          </div>
          <h2 className="mb-3 text-xl font-bold text-white">Our mission</h2>
          <p className="leading-relaxed text-slate-400">
            To provide tiered, intelligent protection: we trust those who deserve
            trust, deeply inspect those who raise suspicion, and share immunity
            among clients without compromising anyone's privacy.
          </p>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <SectionHeading title="Why we built Zero Plus" />
        <div className={`${cardClass} space-y-5 p-8 leading-loose text-slate-300`}>
          <p>
            DDoS attacks are no longer a marginal phenomenon. Cloudflare detected
            around 47.1 million attacks during 2025, a 121% increase over the
            previous year, and the largest attack in history was recorded in
            December 2025 with a force of 31.4 terabits per second.
          </p>
          <p>
            The more dangerous aspect is that these attacks no longer rely solely
            on compromised computers, but on Internet of Things (IoT) devices such
            as smart TVs, cameras, and insecure routers—devices found in ordinary
            homes owned by people who don't know they're being exploited.
          </p>
          <p>
            Small businesses face two options: expensive global solutions, or
            systems that rely on CAPTCHAs that bother users and sometimes block
            legitimate visitors by mistake. Zero Plus is a third way: protection
            that inspects based on Reputation, staying fast and lightweight for
            real visitors.
          </p>
        </div>
      </section>

      {/* Principles */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionHeading title="Principles we build on" />
        <div className="grid gap-5 md:grid-cols-2">
          {PRINCIPLES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className={`${cardClass} flex gap-4 p-6`}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="mb-1.5 font-semibold text-white">{title}</h3>
                <p className="text-sm leading-relaxed text-slate-400">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Decision Engine vs Gemini */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHeading
          title="Who decides, and who explains?"
          description="A clear separation between making security decisions and phrasing them in understandable language, so no sensitive decision depends on an external service."
        />
        <div className="grid gap-5 md:grid-cols-2">
          <div className={`${cardClass} border-cyan-500/30 p-7`}>
            <div className="mb-4 flex items-center gap-3">
              <Cpu className="h-5 w-5 text-cyan-400" />
              <h3 className="font-semibold text-white">Zero Plus AI Engine</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-400">
              The decision engine is built and owned entirely by the project. It
              decides to allow, block, or perform additional inspection for each
              request, based on the request's own data (IP, device fingerprint,
              Reputation, TLS), and operates without any external cloud service.
            </p>
          </div>
          <div className={`${cardClass} p-7`}>
            <div className="mb-4 flex items-center gap-3">
              <MessageSquareText className="h-5 w-5 text-slate-400" />
              <h3 className="font-semibold text-white">Gemini API</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-400">
              It makes no security decisions. Its role begins after the decision is
              made, to convert event data into a sentence or paragraph that appears
              in the reports page and notification text.
            </p>
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <SectionHeading title="Technology stack" />
        <div className={`${cardClass} divide-y divide-white/6`}>
          {STACK.map((s) => (
            <div
              key={s.layer}
              className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-center sm:gap-6"
            >
              <span className="w-40 shrink-0 font-semibold text-cyan-300" dir="ltr">
                {s.layer}
              </span>
              <span className="text-sm text-slate-400">{s.items}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-6 pt-8 text-center">
        <p className="text-slate-400">Have a question about the project or want to try the protection?</p>
        <Link
          to="/contact"
          className="mt-5 inline-block rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:brightness-110"
        >
          Contact us
        </Link>
      </section>
    </LandingLayout>
  )
}