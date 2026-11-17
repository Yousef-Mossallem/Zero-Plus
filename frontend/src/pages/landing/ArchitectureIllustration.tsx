// frontend/src/pages/landing/ArchitectureIllustration.tsx
// ==================================================================
// Zero Plus — مقارنة البنية التحتية التفاعلية قبل وبعد الحماية
// (Before vs After Architecture Visualization)
// 1. قبل الحماية: هجوم مباشر يغمر الخادم الأصلي مسبباً سقوط الخدمة (502 Outage)
// 2. بعد الحماية: طبقة تنقية سحابية تمتص الهجمات وتمرر الحركة النظيفة فقط
// ==================================================================

import { ZeroLogo } from '../../components/ZeroLogo'

export function ArchitectureBefore() {
  return (
    <div dir="ltr" className="relative w-full select-none overflow-hidden rounded-2xl border border-rose-500/20 bg-[#0c0912]/80 p-5 shadow-xl" aria-hidden="true">
      <div className="mb-4 flex items-center justify-between border-b border-rose-500/15 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping" />
          <span className="text-xs font-bold uppercase tracking-wider text-rose-400">
            Unprotected Origin (Direct Exposure)
          </span>
        </div>
        <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-rose-300">
          502 Bad Gateway
        </span>
      </div>

      <svg viewBox="0 0 540 140" fill="none" className="w-full h-auto">
        <defs>
          <path id="arch-b-atk1" d="M 50 40 L 450 70" />
          <path id="arch-b-atk2" d="M 50 70 L 450 70" />
          <path id="arch-b-atk3" d="M 50 100 L 450 70" />
        </defs>

        {/* Attack Ingress Node */}
        <g transform="translate(50, 70)">
          <circle r="24" fill="rgba(244,63,94,0.12)" stroke="rgba(244,63,94,0.4)" strokeWidth="1.5" />
          <circle r="12" fill="rgba(244,63,94,0.2)" />
          <text y="3" textAnchor="middle" fill="#FDA4AF" fontSize="9" fontWeight="bold" fontFamily="monospace">
            BOTNET
          </text>
          <text y="36" textAnchor="middle" fill="rgba(244,63,94,0.7)" fontSize="7.5" fontFamily="monospace">
            Unfiltered Flood
          </text>
        </g>

        {/* Aggressive Red Attack Vectors Slamming Direct into Server */}
        {['M 74 60 L 420 68', 'M 74 70 L 420 70', 'M 74 80 L 420 72'].map((d, i) => (
          <path key={i} d={d} stroke="rgba(244,63,94,0.5)" strokeWidth="2.5" strokeDasharray="6 6">
            <animate attributeName="stroke-dashoffset" from="0" to="-24" dur="0.4s" repeatCount="indefinite" />
          </path>
        ))}

        {/* Animated Rapid Attack Packets */}
        <circle r="4" fill="#F43F5E">
          <animateMotion dur="0.9s" begin="0s" repeatCount="indefinite">
            <mpath {...{ href: '#arch-b-atk1' }} />
          </animateMotion>
        </circle>
        <circle r="4" fill="#F43F5E">
          <animateMotion dur="0.9s" begin="-0.3s" repeatCount="indefinite">
            <mpath {...{ href: '#arch-b-atk2' }} />
          </animateMotion>
        </circle>
        <circle r="4" fill="#F43F5E">
          <animateMotion dur="0.9s" begin="-0.6s" repeatCount="indefinite">
            <mpath {...{ href: '#arch-b-atk3' }} />
          </animateMotion>
        </circle>

        {/* Overloaded Origin Server Node */}
        <g transform="translate(460, 70)">
          {/* Overheat warning pulse */}
          <circle r="32" fill="none" stroke="rgba(244,63,94,0.4)" strokeWidth="1.5">
            <animate attributeName="r" values="28;40;28" dur="1.2s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.8;0;0.8" dur="1.2s" repeatCount="indefinite" />
          </circle>

          <rect x="-24" y="-20" width="48" height="40" rx="6" fill="rgba(244,63,94,0.2)" stroke="#F43F5E" strokeWidth="2" />
          <line x1="-16" y1="-8" x2="16" y2="-8" stroke="#FDA4AF" strokeWidth="1.5" />
          <line x1="-16" y1="2" x2="16" y2="2" stroke="#FDA4AF" strokeWidth="1.5" />
          <line x1="-16" y1="12" x2="16" y2="12" stroke="#FDA4AF" strokeWidth="1.5" />

          <text y="-28" textAnchor="middle" fill="#F43F5E" fontSize="9" fontWeight="bold" fontFamily="monospace">
            CPU: 99.8% (CRASH)
          </text>
          <text y="34" textAnchor="middle" fill="rgba(244,63,94,0.8)" fontSize="8" fontFamily="monospace">
            Latency &gt; 4,800ms
          </text>
        </g>
      </svg>
    </div>
  )
}

export function ArchitectureAfter() {
  return (
    <div dir="ltr" className="relative w-full select-none overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#06101e]/80 p-5 shadow-xl shadow-cyan-500/5" aria-hidden="true">
      <div className="mb-4 flex items-center justify-between border-b border-cyan-500/20 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
            Protected via Zero-Plus Anycast Mesh
          </span>
        </div>
        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-emerald-300">
          100% Operational • &lt; 0.8ms
        </span>
      </div>

      <svg viewBox="0 0 540 140" fill="none" className="w-full h-auto">
        <defs>
          <path id="arch-a-atk" d="M 50 35 L 230 70" />
          <path id="arch-a-clean" d="M 50 105 L 230 70" />
          <path id="arch-a-tunnel" d="M 310 70 L 460 70" />
        </defs>

        {/* Ingress Internet Traffic (Mixed) */}
        <g transform="translate(45, 70)">
          <circle r="24" fill="rgba(56,189,248,0.1)" stroke="rgba(56,189,248,0.3)" strokeWidth="1.5" />
          <text y="-4" textAnchor="middle" fill="#E2E8F0" fontSize="8.5" fontWeight="bold" fontFamily="monospace">
            INTERNET
          </text>
          <text y="10" textAnchor="middle" fill="rgba(148,163,184,0.7)" fontSize="7" fontFamily="monospace">
            Global Ingress
          </text>
        </g>

        {/* Threat Vector (Red) intercepted at Zero-Plus */}
        <path d="M 70 50 L 230 65" stroke="rgba(244,63,94,0.4)" strokeWidth="2" strokeDasharray="4 6">
          <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="0.6s" repeatCount="indefinite" />
        </path>

        {/* Clean Vector (Cyan) flowing in */}
        <path d="M 70 90 L 230 75" stroke="rgba(0,245,160,0.5)" strokeWidth="2" strokeDasharray="5 7">
          <animate attributeName="stroke-dashoffset" from="0" to="-24" dur="0.5s" repeatCount="indefinite" />
        </path>

        {/* Traveling packets before shield */}
        <circle r="3.5" fill="#F43F5E">
          <animateMotion dur="1.2s" begin="0s" repeatCount="indefinite">
            <mpath {...{ href: '#arch-a-atk' }} />
          </animateMotion>
        </circle>
        <circle r="3.5" fill="#00F5A0">
          <animateMotion dur="1.2s" begin="-0.6s" repeatCount="indefinite">
            <mpath {...{ href: '#arch-a-clean' }} />
          </animateMotion>
        </circle>

        {/* ========================================================= */}
        {/* CENTER: ZERO-PLUS SCRUBBING PROXY NODE                    */}
        {/* ========================================================= */}
        <g transform="translate(270, 70)">
          {/* Orbital Shield Ring */}
          <circle r="36" fill="rgba(6,10,24,0.95)" stroke="rgba(56,189,248,0.6)" strokeWidth="2" />
          <circle r="30" fill="none" stroke="rgba(0,245,160,0.3)" strokeWidth="1" strokeDasharray="3 5">
            <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="18s" repeatCount="indefinite" />
          </circle>

          {/* Embedded Logo */}
          <g transform="translate(-18, -18)">
            <ZeroLogo size={36} glow variant="gradient" />
          </g>

          <text y="-42" textAnchor="middle" fill="#38BDF8" fontSize="9" fontWeight="bold" fontFamily="monospace">
            ZERO-PLUS SCRUBBING
          </text>
          <text y="48" textAnchor="middle" fill="#00F5A0" fontSize="7.5" fontFamily="monospace">
            Threats Dissipated 100%
          </text>
        </g>

        {/* ========================================================= */}
        {/* VERIFIED ENCRYPTED TUNNEL TO PROTECTED ORIGIN             */}
        {/* ========================================================= */}
        <path d="M 310 70 L 460 70" stroke="#00F5A0" strokeWidth="2.5" strokeDasharray="6 8">
          <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="0.5s" repeatCount="indefinite" />
        </path>

        {/* Pure legitimate clean green packets entering origin server */}
        <circle r="4" fill="#00F5A0">
          <animateMotion dur="0.8s" begin="0s" repeatCount="indefinite">
            <mpath {...{ href: '#arch-a-tunnel' }} />
          </animateMotion>
        </circle>
        <circle r="4" fill="#38BDF8">
          <animateMotion dur="0.8s" begin="-0.4s" repeatCount="indefinite">
            <mpath {...{ href: '#arch-a-tunnel' }} />
          </animateMotion>
        </circle>

        {/* ========================================================= */}
        {/* PRISTINE ORIGIN SERVER NODE                               */}
        {/* ========================================================= */}
        <g transform="translate(480, 70)">
          {/* Calm green breathing halo */}
          <circle r="26" fill="rgba(6,78,59,0.3)" stroke="rgba(0,245,160,0.5)" strokeWidth="1.5" />
          <rect x="-18" y="-15" width="36" height="30" rx="5" fill="rgba(6,10,24,0.9)" stroke="#00F5A0" strokeWidth="1.5" />
          <line x1="-11" y1="-6" x2="11" y2="-6" stroke="rgba(0,245,160,0.6)" strokeWidth="1.5" />
          <line x1="-11" y1="1" x2="11" y2="1" stroke="rgba(0,245,160,0.4)" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="1.6" fill="#00F5A0" />

          <text y="-24" textAnchor="middle" fill="#00F5A0" fontSize="8.5" fontWeight="bold" fontFamily="monospace">
            CPU: 12% (PRISTINE)
          </text>
          <text y="30" textAnchor="middle" fill="rgba(148,163,184,0.8)" fontSize="7.5" fontFamily="monospace">
            Zero Dropped Packets
          </text>
        </g>
      </svg>
    </div>
  )
}
