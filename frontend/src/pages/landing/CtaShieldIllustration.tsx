// frontend/src/pages/landing/CtaShieldIllustration.tsx
// ==================================================================
// Zero Plus — خلفية الدرع الكوانتي المتحركة لقسم التسجيل النهائي (Final CTA Backdrop)
// حلقات تيليمترية تدور ببطء فائق مع نبضات مغناطيسية ناعمة لا تشتت الانتباه
// ==================================================================

export function CtaShieldBackdrop() {
  return (
    <div
      dir="ltr"
      className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 select-none opacity-40"
      aria-hidden="true"
    >
      <svg viewBox="0 0 400 400" fill="none" className="w-full h-full">
        <defs>
          <linearGradient id="cta-shield-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00F5A0" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#38BDF8" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#6366F1" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        {/* Outer orbital ring with slow rotation */}
        <circle
          cx="200"
          cy="200"
          r="170"
          stroke="url(#cta-shield-grad)"
          strokeWidth="1.2"
          strokeDasharray="4 8"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 200 200"
            to="360 200 200"
            dur="60s"
            repeatCount="indefinite"
          />
        </circle>

        {/* Middle counter-rotating ring with tick marks */}
        <circle
          cx="200"
          cy="200"
          r="130"
          stroke="rgba(56,189,248,0.25)"
          strokeWidth="1.5"
          strokeDasharray="1 7"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 200 200"
            to="-360 200 200"
            dur="45s"
            repeatCount="indefinite"
          />
        </circle>

        {/* Inner subtle magnetic glow ring */}
        <circle
          cx="200"
          cy="200"
          r="90"
          fill="rgba(56,189,248,0.03)"
          stroke="rgba(0,245,160,0.3)"
          strokeWidth="1"
        >
          <animate attributeName="r" values="85;95;85" dur="4s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  )
}
