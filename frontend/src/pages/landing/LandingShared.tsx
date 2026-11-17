// frontend/src/pages/landing/LandingShared.tsx
// ==================================================================
// Zero Plus - Landing Shared Components — UHD Pro Max Edition
// عناصر مشتركة بين صفحات الـ Landing مع أنيميشن احترافي
// ==================================================================

import type { ReactNode } from 'react'
import { useInView } from '../../hooks/useInView'

// ==================================================================
// Shared Classes
// ==================================================================

export const cardClass =
  'rounded-2xl border border-white/8 bg-white/3 backdrop-blur-xl'

// ==================================================================
// Gradient Text — نص بتدرج متحرك
// ==================================================================

export function GradientText({ children }: { children: ReactNode }) {
  return (
    <span className="bg-linear-to-r from-cyan-300 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
      {children}
    </span>
  )
}

// ==================================================================
// Section Heading — عنوان القسم مع reveal animation
// ==================================================================

interface SectionHeadingProps {
  title: ReactNode
  description?: string
  badge?: string
}

export function SectionHeading({ title, description, badge }: SectionHeadingProps) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} className="mx-auto mb-12 max-w-2xl text-center">
      {badge && (
        <div
          className={`mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-3.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 transition-all duration-600 ${
            inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          }`}
        >
          <span className="h-1 w-1 rounded-full bg-cyan-400/80" />
          {badge}
        </div>
      )}
      <h2
        className={`text-3xl font-bold leading-snug tracking-tight text-white sm:text-4xl transition-all duration-700 delay-75 ${
          inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
        }`}
      >
        {title}
      </h2>
      {description && (
        <p
          className={`mt-4 leading-relaxed text-slate-400 transition-all duration-700 delay-150 ${
            inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          }`}
        >
          {description}
        </p>
      )}
    </div>
  )
}

// ==================================================================
// Page Hero — للصفحات الداخلية مع particle dots
// ==================================================================

interface PageHeroProps {
  title: ReactNode
  description: string
}

export function PageHero({ title, description }: PageHeroProps) {
  return (
    <section className="relative mx-auto max-w-4xl px-6 pb-12 pt-16 text-center sm:pt-24 overflow-hidden">
      {/* Decorative orbs */}
      <div className="pointer-events-none absolute left-1/4 top-0 h-64 w-64 rounded-full bg-cyan-500/10 blur-[80px] zp-glow-pulse" />
      <div className="pointer-events-none absolute right-1/4 bottom-0 h-48 w-48 rounded-full bg-indigo-500/10 blur-[60px] zp-glow-pulse" style={{ animationDelay: '1.5s' }} />

      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-cyan-400 zp-anim-fade-up">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
        Zero Plus
      </div>

      <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl zp-anim-fade-up" style={{ animationDelay: '0.1s' }}>
        {title}
      </h1>
      <p className="mx-auto mt-5 max-w-2xl leading-relaxed text-slate-400 zp-anim-fade-up" style={{ animationDelay: '0.2s' }}>
        {description}
      </p>
    </section>
  )
}

// ==================================================================
// Reveal Wrapper — غلاف للأنيميشن عند الظهور
// ==================================================================

interface RevealProps {
  children: ReactNode
  delay?: number
  direction?: 'up' | 'left' | 'right'
  className?: string
}

export function Reveal({ children, delay = 0, direction = 'up', className = '' }: RevealProps) {
  const [ref, inView] = useInView<HTMLDivElement>()

  const dirMap = {
    up: 'translate-y-8',
    left: '-translate-x-8',
    right: 'translate-x-8',
  }

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        inView ? 'opacity-100 translate-x-0 translate-y-0' : `opacity-0 ${dirMap[direction]}`
      } ${className}`}
    >
      {children}
    </div>
  )
}
