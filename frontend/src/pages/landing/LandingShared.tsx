// frontend/src/pages/landing/LandingShared.tsx
// ==================================================================
// Zero Plus - Landing Shared Components
// عناصر صغيرة مشتركة بين صفحات الـ Landing (عشان منكررش الكود)
// ==================================================================

import type { ReactNode } from 'react'

// ==================================================================
// Shared Classes
// ==================================================================

// ستايل الكارت الزجاجي - نفس شكل كارت صفحة تسجيل الدخول بالظبط
export const cardClass =
  'rounded-2xl border border-white/8 bg-white/3 backdrop-blur-xl'

// ==================================================================
// Gradient Text
// ==================================================================

// نص بتدرج (cyan → blue → indigo) زي عنوان صفحة Login
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

// عنوان قسم داخل الصفحة: عنوان كبير + وصف قصير تحته
export function SectionHeading({ title, description }: SectionHeadingProps) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <h2 className="text-3xl font-bold leading-snug tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 leading-relaxed text-slate-400">{description}</p>
      )}
    </div>
  )
}

// ==================================================================
// Page Hero (للصفحات الداخلية: About / Contact / Policies)
// ==================================================================

interface PageHeroProps {
  title: ReactNode
  description: string
}

// ترويسة الصفحات الداخلية، أصغر من الـ Hero بتاع الصفحة الرئيسية
export function PageHero({ title, description }: PageHeroProps) {
  return (
    <section className="mx-auto max-w-4xl px-6 pb-12 pt-16 text-center sm:pt-24">
      <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
        {title}
      </h1>
      <p className="mx-auto mt-5 max-w-2xl leading-relaxed text-slate-400">
        {description}
      </p>
    </section>
  )
}
