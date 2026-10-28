// frontend/src/pages/landing/LandingShared.tsx
// ==================================================================
// Zero Plus - Landing Shared Components
// عناصر مشتركة بين صفحات الـ Landing (عشان منكررش الكود)
// ==================================================================
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

// ==================================================================
// Shared Classes
// ==================================================================
// ستايل الكارت الزجاجي - نفس شكل كارت صفحة تسجيل الدخول
export const cardClass =
  'rounded-2xl border border-white/8 bg-white/3 backdrop-blur-xl'

// ==================================================================
// Gradient Text
// ==================================================================
// نص بتدرج (cyan → blue → indigo)
export function GradientText({ children }: { children: ReactNode }) {
  return (
    <span className="bg-linear-to-r from-cyan-300 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
      {children}
    </span>
  )
}

// ==================================================================
// Section Heading
// ==================================================================
interface SectionHeadingProps {
  title: ReactNode
  description?: string
}
export function SectionHeading({ title, description }: SectionHeadingProps) {
  return (
    <Reveal className="mx-auto mb-12 max-w-2xl text-center">
      <h2 className="text-3xl font-bold leading-snug tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 leading-relaxed text-slate-400">{description}</p>
      )}
    </Reveal>
  )
}

// ==================================================================
// Page Hero
// ==================================================================
interface PageHeroProps {
  title: ReactNode
  description: string
}
export function PageHero({ title, description }: PageHeroProps) {
  return (
    <section className="mx-auto max-w-4xl px-6 pb-12 pt-16 text-center sm:pt-24">
      <div className="animate-fade-in-up">
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
          {title}
        </h1>
        <p
          className="mx-auto mt-5 max-w-2xl leading-relaxed text-slate-400 animate-fade-in-up"
          style={{ animationDelay: '0.15s' }}
        >
          {description}
        </p>
      </div>
    </section>
  )
}

// ==================================================================
// Reveal Component (IntersectionObserver-based animation)
// ==================================================================
export function Reveal({
  children,
  delay = 0,
  y = 24,
  className = '',
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : `translateY(${y}px)`,
        transition: `opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s, transform 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s`,
      }}
    >
      {children}
    </div>
  )
}

// ==================================================================
// Premium Card (مع glow effect على hover)
// ==================================================================
export function PremiumCard({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <Reveal delay={delay}>
      <div
        className={`group relative rounded-2xl border border-white/8 bg-white/[0.03] backdrop-blur-xl transition-all duration-500 hover:border-white/15 hover:bg-white/[0.05] ${className}`}
      >
        {/* Glow effect on hover */}
        <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100">
          <div className="absolute inset-0 rounded-2xl bg-linear-to-br from-cyan-500/20 via-transparent to-indigo-500/20" />
        </div>
        {/* Top shine line */}
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/40 to-transparent opacity-60 transition-opacity duration-500 group-hover:opacity-100" />
        <div className="relative">{children}</div>
      </div>
    </Reveal>
  )
}