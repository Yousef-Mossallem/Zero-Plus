// frontend/src/pages/landing/HeroIllustration.tsx
// ==================================================================
// Zero Plus — الرسم التوضيحي الرئيسي للبطل (Autonomous Edge Scrubbing Matrix)
// محاكاة حية لمنظومة تنقية الهجمات السحابية:
// - تدفقات هجمات عالمية حقيقية (SYN, UDP, HTTP/2 Rapid Reset) تُمتص عند الحافة
// - حزام التنقية الحلقي (Scrubbing Perimeter) يفكك حزم الهجوم فورياً
// - الحركة المشروعة (TLS/HTTPS) تمر بسلاسة فائقة إلى الخوادم المحمية
// ==================================================================

import { ZeroLogo } from '../../components/ZeroLogo'

// ---- Threat ingress node ---- //
function ThreatNode({ cx, cy, label, sub }: { cx: number; cy: number; label: string; sub: string }) {
  return (
    <g className="cursor-default">
      {/* Outer subtle sensor ripple */}
      <circle cx={cx} cy={cy} r="22" fill="none" stroke="rgba(244,63,94,0.15)" strokeWidth="1">
        <animate attributeName="r" values="18;26;18" dur="3s" repeatCount="indefinite" />
        <animate attributeName="stroke-opacity" values="0.25;0;0.25" dur="3s" repeatCount="indefinite" />
      </circle>

      {/* Node base */}
      <circle cx={cx} cy={cy} r="12" fill="rgba(244,63,94,0.08)" stroke="rgba(244,63,94,0.5)" strokeWidth="1.5" />
      
      {/* Blinking threat core */}
      <circle cx={cx} cy={cy} r="4.5" fill="#F43F5E">
        <animate attributeName="opacity" values="0.9;0.4;0.9" dur="1.8s" repeatCount="indefinite" />
      </circle>

      {/* Node labels */}
      <text
        x={cx}
        y={cy - 16}
        textAnchor="middle"
        fill="rgba(253,164,175,0.85)"
        fontSize="8"
        fontFamily="monospace"
        fontWeight="600"
        letterSpacing="0.04em"
      >
        {label}
      </text>
      <text
        x={cx}
        y={cy + 22}
        textAnchor="middle"
        fill="rgba(244,63,94,0.6)"
        fontSize="7"
        fontFamily="monospace"
      >
        {sub}
      </text>
    </g>
  )
}

// ---- Clean traffic node (Protected Origin Server / CDN Edge) ---- //
function CleanNode({ cx, cy, label, sub }: { cx: number; cy: number; label: string; sub: string }) {
  return (
    <g className="cursor-default">
      {/* Glow aura */}
      <circle cx={cx} cy={cy} r="20" fill="none" stroke="rgba(0,245,160,0.18)" strokeWidth="1">
        <animate attributeName="r" values="16;24;16" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="stroke-opacity" values="0.3;0;0.3" dur="2.6s" repeatCount="indefinite" />
      </circle>

      {/* Hexagonal container */}
      <rect
        x={cx - 16}
        y={cy - 13}
        width="32"
        height="26"
        rx="6"
        fill="rgba(6,78,59,0.25)"
        stroke="rgba(0,245,160,0.55)"
        strokeWidth="1.5"
      />

      {/* Server rack horizontal lines */}
      <line x1={cx - 10} y1={cy - 6} x2={cx + 10} y2={cy - 6} stroke="rgba(0,245,160,0.4)" strokeWidth="1" />
      <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke="rgba(0,245,160,0.3)" strokeWidth="1" />
      <line x1={cx - 10} y1={cy + 6} x2={cx + 10} y2={cy + 6} stroke="rgba(0,245,160,0.25)" strokeWidth="1" />

      {/* Status LED */}
      <circle cx={cx + 9} cy={cy - 6} r="1.8" fill="#00F5A0">
        <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
      </circle>

      {/* Text label */}
      <text
        x={cx}
        y={cy > 240 ? cy + 24 : cy - 18}
        textAnchor="middle"
        fill="rgba(0,245,160,0.9)"
        fontSize="8.5"
        fontFamily="monospace"
        fontWeight="bold"
      >
        {label}
      </text>
      <text
        x={cx}
        y={cy > 240 ? cy + 33 : cy - 9}
        textAnchor="middle"
        fill="rgba(148,163,184,0.6)"
        fontSize="6.5"
        fontFamily="monospace"
      >
        {sub}
      </text>
    </g>
  )
}

// ---- Animated telemetry packet flowing along path ---- //
interface FlowDotProps {
  pathId: string
  dur: string
  begin: string
  color: string
  r?: number
}

function FlowDot({ pathId, dur, begin, color, r = 3.5 }: FlowDotProps) {
  return (
    <circle r={r} fill={color} opacity="0">
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite">
        <mpath {...{ href: `#${pathId}` }} />
      </animateMotion>
      <animate
        attributeName="opacity"
        values="0;0.95;0.95;0"
        keyTimes="0;0.1;0.85;1"
        dur={dur}
        begin={begin}
        repeatCount="indefinite"
      />
    </circle>
  )
}

export function HeroIllustration() {
  return (
    <div dir="ltr" className="relative w-full max-w-2xl select-none" aria-hidden="true">
      {/* Background ambient light */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500/10 blur-[100px]" />

      <svg
        viewBox="0 0 640 480"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-auto drop-shadow-2xl"
      >
        <defs>
          {/* Subtle matrix dot pattern */}
          <pattern id="hero-dotgrid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="12" r="0.8" fill="rgba(148,163,184,0.1)" />
          </pattern>

          {/* Holographic Scrubbing Gradient */}
          <linearGradient id="hero-scrub-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00F5A0" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#38BDF8" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#6366F1" stopOpacity="0.8" />
          </linearGradient>

          {/* Threat motion paths (Stop at scrubbing perimeter radius ~100 from center 320,240) */}
          <path id="hp-tl" d="M 64 64 L 248 184" />
          <path id="hp-ml" d="M 32 240 L 220 240" />
          <path id="hp-bl" d="M 64 416 L 248 296" />

          <path id="hp-tr" d="M 576 64 L 392 184" />
          <path id="hp-mr" d="M 608 240 L 420 240" />
          <path id="hp-br" d="M 576 416 L 392 296" />

          {/* Clean legitimate motion paths (Pass completely through to origin center) */}
          <path id="hp-top" d="M 320 24 L 320 240" />
          <path id="hp-bottom" d="M 320 456 L 320 240" />
        </defs>

        {/* Matrix grid background */}
        <rect width="640" height="480" fill="url(#hero-dotgrid)" rx="16" />

        {/* Perimeter coordinate arcs */}
        <circle cx="320" cy="240" r="180" stroke="rgba(56,189,248,0.06)" strokeWidth="1" strokeDasharray="3 6" />
        <circle cx="320" cy="240" r="140" stroke="rgba(99,102,241,0.08)" strokeWidth="1" />

        {/* Threat intake connection dashed vectors */}
        {[
          'M 64 64 L 248 184',
          'M 32 240 L 220 240',
          'M 64 416 L 248 296',
          'M 576 64 L 392 184',
          'M 608 240 L 420 240',
          'M 576 416 L 392 296',
        ].map((d, i) => (
          <path
            key={i}
            d={d}
            stroke="rgba(244,63,94,0.22)"
            strokeWidth="1.5"
            strokeDasharray="4 8"
            strokeLinecap="round"
          >
            <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="0.65s" repeatCount="indefinite" />
          </path>
        ))}

        {/* Clean transit channels (Cyan / Mint) */}
        {['M 320 24 L 320 180', 'M 320 456 L 320 300'].map((d, i) => (
          <path
            key={i}
            d={d}
            stroke="rgba(0,245,160,0.3)"
            strokeWidth="2"
            strokeDasharray="6 8"
            strokeLinecap="round"
          >
            <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="0.55s" repeatCount="indefinite" />
          </path>
        ))}

        {/* ============================================================== */}
        {/* THE ACTIVE SCRUBBING PERIMETER (Absorbs & neutralizes attacks) */}
        {/* ============================================================== */}
        <g>
          {/* Energy absorption halo */}
          <circle
            cx="320"
            cy="240"
            r="104"
            fill="rgba(6,10,24,0.85)"
            stroke="url(#hero-scrub-grad)"
            strokeWidth="2"
            strokeDasharray="16 8 4 8"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 320 240"
              to="360 320 240"
              dur="32s"
              repeatCount="indefinite"
            />
          </circle>

          {/* Dynamic Dissipation Sinkhole Pips (Where attacks dissolve) */}
          {[
            { cx: 248, cy: 184 },
            { cx: 220, cy: 240 },
            { cx: 248, cy: 296 },
            { cx: 392, cy: 184 },
            { cx: 420, cy: 240 },
            { cx: 392, cy: 296 },
          ].map((pt, idx) => (
            <g key={idx}>
              <circle cx={pt.cx} cy={pt.cy} r="6" fill="rgba(244,63,94,0.2)" stroke="#F43F5E" strokeWidth="1">
                <animate attributeName="r" values="4;8;4" dur="1.5s" begin={`${idx * 0.25}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.5s" begin={`${idx * 0.25}s`} repeatCount="indefinite" />
              </circle>
              <line x1={pt.cx - 4} y1={pt.cy - 4} x2={pt.cx + 4} y2={pt.cy + 4} stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
              <line x1={pt.cx + 4} y1={pt.cy - 4} x2={pt.cx - 4} y2={pt.cy + 4} stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
            </g>
          ))}

          {/* Reverse counter-rotating telemetry ring */}
          <circle
            cx="320"
            cy="240"
            r="82"
            fill="none"
            stroke="rgba(56,189,248,0.2)"
            strokeWidth="1.2"
            strokeDasharray="2 6"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 320 240"
              to="-360 320 240"
              dur="24s"
              repeatCount="indefinite"
            />
          </circle>

          {/* Central Protected Vault */}
          <circle cx="320" cy="240" r="62" fill="rgba(8,16,36,0.95)" stroke="rgba(56,189,248,0.4)" strokeWidth="1.5" />

          {/* Radar Sweep Ray */}
          <line x1="320" y1="240" x2="320" y2="178" stroke="rgba(0,245,160,0.6)" strokeWidth="1.5" strokeLinecap="round">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 320 240"
              to="360 320 240"
              dur="4s"
              repeatCount="indefinite"
            />
          </line>

          {/* Radar Cone Sector */}
          <path d="M 320 240 L 320 178 A 62 62 0 0 1 378 240 Z" fill="rgba(0,245,160,0.06)">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 320 240"
              to="360 320 240"
              dur="4s"
              repeatCount="indefinite"
            />
          </path>

          {/* ZERO-PLUS OFFICIAL EMBLEM AT CORE */}
          <g transform="translate(294, 214)">
            <ZeroLogo size={52} glow variant="gradient" animated />
          </g>

          {/* Status readout inside shield */}
          <text
            x="320"
            y="278"
            textAnchor="middle"
            fill="rgba(56,189,248,0.9)"
            fontSize="7"
            fontFamily="monospace"
            fontWeight="bold"
            letterSpacing="0.12em"
          >
            AUTONOMOUS DEFENSE
          </text>
          <text
            x="320"
            y="288"
            textAnchor="middle"
            fill="rgba(0,245,160,0.85)"
            fontSize="6"
            fontFamily="monospace"
          >
            LATENCY &lt; 0.8ms • 100% CLEAN
          </text>
        </g>

        {/* ============================================================== */}
        {/* INGRESS NODES & TELEMETRY LABELS                               */}
        {/* ============================================================== */}
        <ThreatNode cx={64} cy={64} label="185.220.101.x" sub="SYN Flood 28.4Mpps" />
        <ThreatNode cx={32} cy={240} label="45.142.212.x" sub="DNS Amplification" />
        <ThreatNode cx={64} cy={416} label="5.188.206.x" sub="HTTP/2 Rapid Reset" />

        <ThreatNode cx={576} cy={64} label="194.165.16.x" sub="NTP Reflection" />
        <ThreatNode cx={608} cy={240} label="89.248.167.x" sub="Memcached 1.2Tbps" />
        <ThreatNode cx={576} cy={416} label="198.98.51.x" sub="ACK Flood 12.8Mpps" />

        <CleanNode cx={320} cy={24} label="GLOBAL CDN EDGE" sub="TLS 1.3 Anycast Ingress" />
        <CleanNode cx={320} cy={456} label="PROTECTED ORIGIN" sub="High-Availability Cluster" />

        {/* ============================================================== */}
        {/* ANIMATED PACKET PULSES                                         */}
        {/* ============================================================== */}
        {/* Threat packets that vanish when reaching scrubbing boundary */}
        <FlowDot pathId="hp-tl" dur="2.4s" begin="0s" color="#F43F5E" />
        <FlowDot pathId="hp-tl" dur="2.4s" begin="-1.2s" color="#F43F5E" />
        <FlowDot pathId="hp-ml" dur="2.2s" begin="-0.5s" color="#F43F5E" />
        <FlowDot pathId="hp-ml" dur="2.2s" begin="-1.6s" color="#F43F5E" />
        <FlowDot pathId="hp-bl" dur="2.5s" begin="-0.8s" color="#F43F5E" />
        <FlowDot pathId="hp-bl" dur="2.5s" begin="-1.9s" color="#F43F5E" />

        <FlowDot pathId="hp-tr" dur="2.4s" begin="-0.3s" color="#F43F5E" />
        <FlowDot pathId="hp-tr" dur="2.4s" begin="-1.5s" color="#F43F5E" />
        <FlowDot pathId="hp-mr" dur="2.1s" begin="-0.9s" color="#F43F5E" />
        <FlowDot pathId="hp-mr" dur="2.1s" begin="-1.8s" color="#F43F5E" />
        <FlowDot pathId="hp-br" dur="2.6s" begin="-0.4s" color="#F43F5E" />
        <FlowDot pathId="hp-br" dur="2.6s" begin="-1.7s" color="#F43F5E" />

        {/* Legitimate traffic packets passing through cleanly */}
        <FlowDot pathId="hp-top" dur="1.8s" begin="0s" color="#00F5A0" r={4.5} />
        <FlowDot pathId="hp-top" dur="1.8s" begin="-0.9s" color="#38BDF8" r={4} />
        <FlowDot pathId="hp-bottom" dur="1.8s" begin="-0.4s" color="#00F5A0" r={4.5} />
        <FlowDot pathId="hp-bottom" dur="1.8s" begin="-1.3s" color="#38BDF8" r={4} />

        {/* ============================================================== */}
        {/* FLOATING HUD BADGES (Luxury Glassmorphic Security Markers)     */}
        {/* ============================================================== */}
        <g transform="translate(420, 28)">
          <rect
            width="134"
            height="26"
            rx="6"
            fill="rgba(6,10,24,0.85)"
            stroke="rgba(56,189,248,0.3)"
            strokeWidth="1"
          />
          <circle cx="12" cy="13" r="3" fill="#00F5A0" />
          <text x="22" y="17" fill="#E2E8F0" fontSize="8" fontFamily="sans-serif" fontWeight="bold">
            SCRUBBING: 31.4 Tbps
          </text>
        </g>

        <g transform="translate(86, 28)">
          <rect
            width="134"
            height="26"
            rx="6"
            fill="rgba(6,10,24,0.85)"
            stroke="rgba(0,245,160,0.3)"
            strokeWidth="1"
          />
          <circle cx="12" cy="13" r="3" fill="#38BDF8" />
          <text x="22" y="17" fill="#E2E8F0" fontSize="8" fontFamily="sans-serif" fontWeight="bold">
            ZERO ZERO-DAY LEAK
          </text>
        </g>
      </svg>
    </div>
  )
}
