// frontend/src/pages/landing/SetupIllustration.tsx
// ==================================================================
// Zero Plus — الرسم التوضيحي لمراحل التفعيل السريع (3-Minute Setup Rail)
// مسار بصري يوضح سهولة ربط الموقع وتفعيل الحماية خلال 3 دقائق فقط بدون تعديل كود
// ==================================================================

export function SetupFlowRail() {
  return (
    <div dir="ltr" className="relative mx-auto mb-10 h-10 max-w-4xl select-none overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 800 40" fill="none" className="w-full h-full">
        <defs>
          <linearGradient id="setup-rail-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#00F5A0" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#6366F1" stopOpacity="0.4" />
          </linearGradient>
          <path id="setup-path" d="M 40 20 L 760 20" />
        </defs>

        {/* Base rail */}
        <line x1="40" y1="20" x2="760" y2="20" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
        <line
          x1="40"
          y1="20"
          x2="760"
          y2="20"
          stroke="url(#setup-rail-grad)"
          strokeWidth="2"
          strokeDasharray="8 12"
        >
          <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="0.8s" repeatCount="indefinite" />
        </line>

        {/* 5 Milestone Nodes */}
        {[0, 1, 2, 3, 4].map((i) => {
          const cx = 50 + i * 175
          return (
            <g key={i}>
              <circle cx={cx} cy="20" r="11" fill="rgba(6,10,24,0.95)" stroke="rgba(0,245,160,0.5)" strokeWidth="1.5" />
              <circle cx={cx} cy="20" r="4" fill="#00F5A0">
                <animate attributeName="r" values="3;5;3" dur="2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
              </circle>
            </g>
          )
        })}

        {/* Traveling setup signal */}
        <circle r="4" fill="#FFFFFF">
          <animateMotion dur="2.8s" begin="0s" repeatCount="indefinite">
            <mpath {...{ href: '#setup-path' }} />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0" dur="2.8s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  )
}
