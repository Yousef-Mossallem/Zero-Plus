// frontend/src/components/LoadingScreen.tsx
// Premium full-screen loader for Zero Plus

import { Shield } from 'lucide-react'
import Logo from './logo'

export default function LoadingScreen({
  message = 'Loading Zero Plus…',
  subMessage,
}: {
  message?: string
  subMessage?: string
}) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#05070f]">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(14,22,40,0.95)_0%,_#05070f_55%,_#02040a_100%)]" />
      <div className="pointer-events-none absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-cyan-500/12 blur-[120px] zp-anim-pulse-soft" />
      <div className="pointer-events-none absolute -right-32 bottom-1/4 h-80 w-80 rounded-full bg-indigo-600/14 blur-[110px] zp-anim-pulse-soft" style={{ animationDelay: '0.8s' }} />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/5 blur-[80px]" />

      {/* Grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8 px-6">
        {/* Logo mark */}
        <div className="relative">
          <div className="absolute inset-0 rounded-3xl bg-cyan-400/30 blur-xl zp-anim-pulse-soft" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-linear-to-br from-cyan-400 via-sky-500 to-blue-600 shadow-2xl shadow-cyan-500/40 ring-1 ring-white/20">
            <Logo className="h-10 w-10" />
          </div>
          {/* Orbit ring */}
          <div className="pointer-events-none absolute -inset-3 rounded-[1.75rem] border border-cyan-400/20 zp-anim-spin-slow" />
          <div className="pointer-events-none absolute -inset-5 rounded-[2rem] border border-dashed border-cyan-400/10 zp-anim-spin-reverse" />
        </div>

        {/* Brand */}
        <div className="text-center zp-anim-fade-up" style={{ animationDelay: '80ms' }}>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Zero<span className="text-cyan-400">Plus</span>
          </h1>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            Security Gateway
          </p>
        </div>

        {/* Progress rail */}
        <div className="w-48 zp-anim-fade-up" style={{ animationDelay: '160ms' }}>
          <div className="relative h-1 overflow-hidden rounded-full bg-white/8">
            <div className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-linear-to-r from-cyan-400/0 via-cyan-400 to-cyan-400/0 zp-anim-shimmer-bar" />
          </div>
          <p className="mt-4 text-center text-sm text-slate-400">{message}</p>
          {subMessage && (
            <p className="mt-1 text-center text-xs text-slate-600">{subMessage}</p>
          )}
        </div>
      </div>
    </div>
  )
}
