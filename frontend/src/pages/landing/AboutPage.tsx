// frontend/src/pages/landing/AboutPage.tsx
// ==================================================================
// Zero Plus - About Page (English) "/about"
// ==================================================================

import { Link } from 'react-router-dom'
import { Eye, Target, Scale, Scan, Users, EyeOff, Cpu, MessageSquareText } from 'lucide-react'

import LandingLayout from './LandingLayout'
import { GradientText, PageHero, SectionHeading, cardClass } from './LandingShared'

const PRINCIPLES = [
  {
    icon: EyeOff,
    title: 'Clear logic, not a black box',
    desc: 'Allow or block decisions pass through known stages, each with one job. You can understand and review why any decision was made.',
  },
  {
    icon: Scale,
    title: 'A fair chance for every new device',
    desc: 'We only register a device when a real bad event occurs (Lazy Registration). A new device is innocent until proven otherwise.',
  },
  {
    icon: Scan,
    title: 'Heavy checks only when needed',
    desc: 'Deeper inspection (e.g. TLS/JA3/JA4) is spent on a small suspicious share, so we save resources and keep latency low.',
  },
  {
    icon: Users,
    title: 'Privacy that is not compromised',
    desc: 'Each company’s data stays in its isolated environment. The only thing shared is a threat fingerprint stripped of any identity.',
  },
]

const STACK = [
  { layer: 'Frontend', items: 'React, TypeScript, Vite, Tailwind CSS, Zustand, Recharts' },
  { layer: 'Backend', items: 'Node.js, Express, TypeScript, Socket.io, Zod' },
  { layer: 'Infrastructure', items: 'Docker, Nginx, PostgreSQL, Redis' },
  { layer: 'IoT Simulation', items: 'ESP32 + MicroPython to simulate legitimate and attacking devices' },
]

export default function AboutPage() {
  return (
    <LandingLayout>
      <PageHero
        title={
          <>
            Rethinking protection <GradientText>the smarter way</GradientText>
          </>
        }
        description="Zero Plus aims to make DDoS protection accessible and transparent for small and medium businesses—without enterprise cost and without annoying visitors."
      />

      <section className="mx-auto grid max-w-5xl gap-5 px-6 py-8 md:grid-cols-2">
        <div className={`${cardClass} p-7`}>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Eye className="h-5 w-5" />
          </div>
          <h2 className="mb-3 text-xl font-bold text-white">Our vision</h2>
          <p className="leading-relaxed text-slate-400">
            That every service on the internet keeps running even during an attack,
            and that a real visitor reaches the site smoothly as if nothing happened.
          </p>
        </div>

        <div className={`${cardClass} p-7`}>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Target className="h-5 w-5" />
          </div>
          <h2 className="mb-3 text-xl font-bold text-white">Our mission</h2>
          <p className="leading-relaxed text-slate-400">
            Deliver graduated, smart protection: trust who deserves it, inspect
            deeply who raises suspicion, and share immunity across customers without
            compromising anyone’s privacy.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-16">
        <SectionHeading title="Why we built Zero Plus" />

        <div className={`${cardClass} space-y-5 p-8 leading-loose text-slate-300`}>
          <p>
            DDoS attacks are no longer a fringe issue. Cloudflare observed about
            47.1 million attacks in 2025—a 121% increase over the previous year—and
            in December 2025 the largest attack in history was recorded at 31.4 Tbps.
          </p>
          <p>
            What makes this worse is that these attacks no longer rely only on
            compromised PCs, but on IoT devices—smart TVs, cameras, insecure
            routers—sitting in ordinary homes, owned by people who have no idea
            they are being abused.
          </p>
          <p>
            Small companies face two options: expensive global solutions, or
            CAPTCHA-heavy systems that frustrate users and sometimes block real
            visitors by mistake. Zero Plus is a third path: protection that checks
            by reputation, so it stays fast and light for legitimate visitors.
          </p>
        </div>
      </section>

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

      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHeading
          title="Who decides, and who explains?"
          description="A clear split between making the security decision and phrasing it in plain language—so no sensitive decision depends on an external service."
        />
        <div className="grid gap-5 md:grid-cols-2">
          <div className={`${cardClass} border-cyan-500/30 p-7`}>
            <div className="mb-4 flex items-center gap-3">
              <Cpu className="h-5 w-5 text-cyan-400" />
              <h3 className="font-semibold text-white">Zero Plus AI Engine</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-400">
              The decision engine is built and owned entirely by the project. It
              decides allow, block, or extra checks for every request based on the
              request itself (IP, device fingerprint, reputation, TLS)—with no
              external cloud service in the loop.
            </p>
          </div>

          <div className={`${cardClass} p-7`}>
            <div className="mb-4 flex items-center gap-3">
              <MessageSquareText className="h-5 w-5 text-slate-400" />
              <h3 className="font-semibold text-white">Gemini API</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-400">
              It does not make any security decision. Its role starts after the
              decision is made: turning event data into a clear sentence or paragraph
              shown on the reports page and in notification text.
            </p>
          </div>
        </div>
      </section>

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

      <section className="mx-auto max-w-3xl px-6 pt-8 text-center">
        <p className="text-slate-400">Have a question about the project or want to try protection?</p>
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
