// frontend/src/pages/landing/StatsIllustrations.tsx
// ==================================================================
// Zero Plus — أشكال ورسوم توضيحية متحركة لكل بطاقة إحصائية
// كل شكل يمثل القياس الأمني الفعلي بحركة هادئة وفاخرة مريحة للعين:
// 1. هجمات تم صدها: مطياف إخماد الهجمات الحي (Threat Clamping Wave)
// 2. نمو الهجمات: مخطط قياس تصاعدي مع نقاط تيليمترية متوهجة
// 3. سعة التصفية: أنبوب تدفق هائل فائق السرعة عبر حلقات بصرية
// 4. دقة العبور: مؤشر دائري قياسي يفرز الحركة الحقيقية بدقة 90%+
// ==================================================================

// 1. STAT 1: 47.1M Attacks Blocked — Spectrogram Wave
export function StatIllustrationAttacks() {
  return (
    <div dir="ltr" className="relative h-12 w-full overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 160 48" fill="none" className="w-full h-full">
        <defs>
          <linearGradient id="stat-wave-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.4" />
            <stop offset="45%" stopColor="#38BDF8" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#00F5A0" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="stat-wave-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Dynamic Clamping Wave — Attack spikes clamped to flatline */}
        <path
          d="M 0 32 Q 20 8, 40 28 T 80 24 T 120 24 T 160 24"
          stroke="url(#stat-wave-grad)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        >
          <animate
            attributeName="d"
            values="
              M 0 32 Q 20 6, 40 28 T 80 24 T 120 24 T 160 24;
              M 0 28 Q 20 18, 40 22 T 80 24 T 120 24 T 160 24;
              M 0 32 Q 20 6, 40 28 T 80 24 T 120 24 T 160 24
            "
            dur="3.2s"
            repeatCount="indefinite"
          />
        </path>

        {/* Subtle area fill */}
        <path
          d="M 0 32 Q 20 8, 40 28 T 80 24 T 120 24 T 160 24 L 160 48 L 0 48 Z"
          fill="url(#stat-wave-fill)"
        />

        {/* Traveling telemetry pulse */}
        <circle r="3" fill="#00F5A0">
          <animateMotion
            path="M 0 32 Q 20 8, 40 28 T 80 24 T 120 24 T 160 24"
            dur="2.4s"
            repeatCount="indefinite"
          />
          <animate attributeName="opacity" values="0;1;1;0" dur="2.4s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  )
}

// 2. STAT 2: +121% Surge — Ascending Telemetry Curve
export function StatIllustrationIncrease() {
  return (
    <div dir="ltr" className="relative h-12 w-full overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 160 48" fill="none" className="w-full h-full">
        <defs>
          <linearGradient id="stat-inc-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366F1" />
            <stop offset="60%" stopColor="#F43F5E" />
            <stop offset="100%" stopColor="#FDA4AF" />
          </linearGradient>
        </defs>

        {/* Background baseline */}
        <line x1="0" y1="42" x2="160" y2="42" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="0" y1="24" x2="160" y2="24" stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="3 3" />

        {/* Stepped Surge Trajectory */}
        <path
          d="M 10 40 L 45 34 L 80 26 L 115 16 L 150 8"
          stroke="url(#stat-inc-grad)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {[
          { cx: 10, cy: 40 },
          { cx: 45, cy: 34 },
          { cx: 80, cy: 26 },
          { cx: 115, cy: 16 },
          { cx: 150, cy: 8 },
        ].map((pt, i) => (
          <g key={i}>
            <circle cx={pt.cx} cy={pt.cy} r={i === 4 ? 3.5 : 2} fill={i === 4 ? '#F43F5E' : '#FDA4AF'}>
              {i === 4 && (
                <animate attributeName="r" values="3.5;5;3.5" dur="1.6s" repeatCount="indefinite" />
              )}
            </circle>
            {i === 4 && (
              <circle cx={pt.cx} cy={pt.cy} r="8" stroke="rgba(244,63,94,0.4)" strokeWidth="1" fill="none">
                <animate attributeName="r" values="6;12;6" dur="2s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

// 3. STAT 3: 31.4 Tbps — High-Velocity Throughput Conduit
export function StatIllustrationThroughput() {
  return (
    <div dir="ltr" className="relative h-12 w-full overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 160 48" fill="none" className="w-full h-full">
        <defs>
          <linearGradient id="stat-pipe-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#38BDF8" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#818CF8" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Conduit guide tubes */}
        <line x1="0" y1="18" x2="160" y2="18" stroke="rgba(56,189,248,0.15)" strokeWidth="1" />
        <line x1="0" y1="30" x2="160" y2="30" stroke="rgba(56,189,248,0.15)" strokeWidth="1" />

        {/* Center high-speed laser stream */}
        <line
          x1="0"
          y1="24"
          x2="160"
          y2="24"
          stroke="url(#stat-pipe-grad)"
          strokeWidth="2.5"
          strokeDasharray="8 6"
        >
          <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="0.45s" repeatCount="indefinite" />
        </line>

        {/* Optical filtration rings */}
        {[40, 80, 120].map((x, idx) => (
          <ellipse
            key={idx}
            cx={x}
            cy="24"
            rx="4"
            ry="10"
            stroke="rgba(56,189,248,0.4)"
            strokeWidth="1.2"
            fill="none"
          >
            <animate attributeName="stroke-opacity" values="0.3;0.8;0.3" dur="1.8s" begin={`${idx * 0.3}s`} repeatCount="indefinite" />
          </ellipse>
        ))}
      </svg>
    </div>
  )
}

// 4. STAT 4: ~90% Pass Rate — Biometric Accuracy Meter
export function StatIllustrationPassRate() {
  return (
    <div dir="ltr" className="relative h-12 w-full overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 160 48" fill="none" className="w-full h-full">
        {/* Progress Bar background */}
        <rect x="10" y="20" width="140" height="8" rx="4" fill="rgba(255,255,255,0.06)" />

        {/* Filled Safe 90% portion */}
        <rect x="10" y="20" width="126" height="8" rx="4" fill="url(#pass-rate-fill)">
          <animate attributeName="width" values="120;126;120" dur="3s" repeatCount="indefinite" />
        </rect>

        {/* Tick marks */}
        {[38, 66, 94, 122].map((x, i) => (
          <line key={i} x1={x} y1="18" x2={x} y2="30" stroke="rgba(6,10,24,0.6)" strokeWidth="1.5" />
        ))}

        {/* Scanning needle */}
        <circle cx="134" cy="24" r="3.5" fill="#00F5A0">
          <animate attributeName="opacity" values="1;0.4;1" dur="1.4s" repeatCount="indefinite" />
        </circle>

        <defs>
          <linearGradient id="pass-rate-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#064E3B" />
            <stop offset="60%" stopColor="#00F5A0" />
            <stop offset="100%" stopColor="#38BDF8" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}
