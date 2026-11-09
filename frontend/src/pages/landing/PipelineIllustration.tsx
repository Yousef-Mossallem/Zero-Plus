// frontend/src/pages/landing/PipelineIllustration.tsx
// ==================================================================
// Zero Plus — الرسم التوضيحي لمسار التحليل والفحص (9-Stage Pipeline)
// 1. PipelineFlowLine: ناقل بصري فائق السرعة يربط مراحل الفحص التسع مع حزم ضوئية
// 2. PipelineStageGlyph: أيقونة محفورة متحركة مخصصة لكل مرحلة من المراحل التسع
// ==================================================================

export function PipelineFlowLine() {
  return (
    <div dir="ltr" className="relative mx-auto mb-10 h-12 max-w-4xl select-none overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 880 48" fill="none" className="w-full h-full">
        <defs>
          <linearGradient id="pipe-glow-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.1" />
            <stop offset="30%" stopColor="#00F5A0" stopOpacity="0.8" />
            <stop offset="70%" stopColor="#6366F1" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.1" />
          </linearGradient>

          <path id="pipe-rail" d="M 10 24 L 870 24" />
        </defs>

        {/* Ambient track guide lines */}
        <line x1="10" y1="18" x2="870" y2="18" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        <line x1="10" y1="30" x2="870" y2="30" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />

        {/* Core optic laser line */}
        <path d="M 10 24 L 870 24" stroke="rgba(56,189,248,0.18)" strokeWidth="2" />

        {/* Fast animated traveling pulse beam */}
        <path
          d="M 10 24 L 870 24"
          stroke="url(#pipe-glow-grad)"
          strokeWidth="2.5"
          strokeDasharray="14 18"
        >
          <animate attributeName="stroke-dashoffset" from="0" to="-32" dur="0.6s" repeatCount="indefinite" />
        </path>

        {/* 9 Stage precision waypoints */}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
          const cx = 35 + i * 101
          return (
            <g key={i}>
              {/* Outer pulsing ring */}
              <circle cx={cx} cy="24" r="10" fill="none" stroke="rgba(56,189,248,0.25)" strokeWidth="1">
                <animate
                  attributeName="r"
                  values="8;13;8"
                  dur="2.5s"
                  begin={`${i * 0.28}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="stroke-opacity"
                  values="0.4;0;0.4"
                  dur="2.5s"
                  begin={`${i * 0.28}s`}
                  repeatCount="indefinite"
                />
              </circle>

              {/* Waypoint Base */}
              <circle
                cx={cx}
                cy="24"
                r="7"
                fill="rgba(6,10,24,0.95)"
                stroke={i === 8 ? '#00F5A0' : 'rgba(56,189,248,0.6)'}
                strokeWidth="1.5"
              />

              {/* Stage Index */}
              <text
                x={cx}
                y="27"
                textAnchor="middle"
                fill={i === 8 ? '#00F5A0' : '#E2E8F0'}
                fontSize="8"
                fontWeight="bold"
                fontFamily="sans-serif"
              >
                {i + 1}
              </text>
            </g>
          )
        })}

        {/* High-speed packet trains with glowing trails */}
        <circle r="4" fill="#00F5A0">
          <animateMotion dur="3s" begin="0s" repeatCount="indefinite">
            <mpath {...{ href: '#pipe-rail' }} />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0" dur="3s" begin="0s" repeatCount="indefinite" />
        </circle>

        <circle r="3.5" fill="#38BDF8">
          <animateMotion dur="3s" begin="-1.5s" repeatCount="indefinite">
            <mpath {...{ href: '#pipe-rail' }} />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0" dur="3s" begin="-1.5s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  )
}

// ----------------------------------------------------------------
// Pipeline Stage Mini-Glyph (أيقونة ميكرو متخصصة لكل مرحلة)
// ----------------------------------------------------------------
export function PipelineStageGlyph({ stageKey }: { stageKey: string }) {
  switch (stageKey) {
    case 'intake': // Intake Classifier (Prism Spectrum)
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-cyan-400" aria-hidden="true">
          <polygon points="12,3 21,20 3,20" stroke="currentColor" strokeWidth="1.5" fill="rgba(56,189,248,0.1)" />
          <line x1="12" y1="8" x2="12" y2="17" stroke="#00F5A0" strokeWidth="1.5">
            <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" />
          </line>
        </svg>
      )

    case 'baseline': // Baseline Verifier (Gaussian Normalizer)
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true">
          <path d="M 2 18 Q 12 4, 22 18" stroke="currentColor" strokeWidth="1.8" />
          <line x1="2" y1="18" x2="22" y2="18" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
          <circle cx="12" cy="11" r="2" fill="#00F5A0">
            <animate attributeName="r" values="1.5;3;1.5" dur="1.8s" repeatCount="indefinite" />
          </circle>
        </svg>
      )

    case 'ipScanner': // IP Reputation Scanner (Radar Eye)
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 3" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <line x1="12" y1="12" x2="19" y2="7" stroke="#38BDF8" strokeWidth="1.5">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="3s" repeatCount="indefinite" />
          </line>
        </svg>
      )

    case 'similarity': // Similarity Matcher (Matrix Match)
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-indigo-400" aria-hidden="true">
          <rect x="3" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="14" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="8.5" y="13" width="7" height="7" rx="1.5" fill="rgba(99,102,241,0.2)" stroke="#00F5A0" strokeWidth="1.5" />
        </svg>
      )

    case 'deep': // Deep Comparison Engine (Microprocessor Core)
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="9" width="6" height="6" fill="rgba(245,158,11,0.25)" stroke="#F59E0B" strokeWidth="1" />
          <line x1="9" y1="2" x2="9" y2="6" stroke="currentColor" strokeWidth="1.2" />
          <line x1="15" y1="2" x2="15" y2="6" stroke="currentColor" strokeWidth="1.2" />
          <line x1="9" y1="18" x2="9" y2="22" stroke="currentColor" strokeWidth="1.2" />
          <line x1="15" y1="18" x2="15" y2="22" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      )

    case 'fingerprint': // Fingerprint Authenticator (JA4 Cryptographic Key)
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true">
          <path d="M 6 12 C 6 8.7 8.7 6 12 6 C 15.3 6 18 8.7 18 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 9 13 C 9 11.3 10.3 10 12 10 C 13.7 10 15 11.3 15 13 V 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="14" r="1.5" fill="#00F5A0" />
        </svg>
      )

    case 'orchestrator': // Traffic Orchestrator (BGP Switch)
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true">
          <circle cx="12" cy="6" r="2.5" fill="currentColor" />
          <circle cx="5" cy="18" r="2.5" fill="#38BDF8" />
          <circle cx="19" cy="18" r="2.5" fill="#00F5A0" />
          <line x1="12" y1="8.5" x2="5" y2="15.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
          <line x1="12" y1="8.5" x2="19" y2="15.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
        </svg>
      )

    case 'dashboard': // Adaptive Dashboard Engine (Live Telemetry Pulse)
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-teal-400" aria-hidden="true">
          <path d="M 3 15 L 7 11 L 11 14 L 16 8 L 21 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="16" cy="8" r="2" fill="#00F5A0">
            <animate attributeName="r" values="1.5;3;1.5" dur="1.4s" repeatCount="indefinite" />
          </circle>
        </svg>
      )

    case 'isolation': // Isolation & Immunity Manager (Quantum Vault)
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true">
          <rect x="4" y="9" width="16" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(0,245,160,0.1)" />
          <path d="M 8 9 V 6 C 8 3.8 9.8 2 12 2 C 14.2 2 16 3.8 16 6 V 9" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="15" r="1.5" fill="#00F5A0" />
        </svg>
      )

    default:
      return null
  }
}
