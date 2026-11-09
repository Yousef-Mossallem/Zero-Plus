// frontend/src/pages/landing/FeatureIllustrations.tsx
// ==================================================================
// Zero Plus — رسوم توضيحية فاخرة ومخصصة لميزات النظام (Bespoke Feature Glyphs)
// تصميم هندسي دقيق، مستوحى من شركات الحماية السيبرانية الكبرى (Stripe / Cloudflare / Linear)
// كل شكل يمتلك حركة ذاتية متناغمة ومريحة للعين تعكس طبيعة الميزة التقنية:
// 1. TIERED: منظومة تصفية ثلاثية الطبقات (L3 / L4 / L7 Filtration Stack)
// 2. REPUTATION: رادار البصمة الرقمية وتقييم سمعة العناوين العالمية (IP Heuristics)
// 3. SILENT: مصادقة صامتة وفحص خفي بدون أية كابتشا (Zero-Friction TLS Proof)
// 4. FEDERATED: شبكة استخبارات سحابية موزعة بنبضات حية (Global Mesh Intelligence)
// 5. ISOLATION: جدار العزل الكوانتي المشفر (Cryptographic Tenant Sandbox)
// 6. REPORTS: غرفة القياس والتحليل الجنائي الحي (Live Forensic Telemetry)
// ==================================================================

// ----------------------------------------------------------------
// 1. TIERED — طبقات التصفية الثلاثية (L3 / L4 / L7 Stack)
// ----------------------------------------------------------------
export function IllustrationTiered() {
  return (
    <div dir="ltr" className="relative flex h-16 w-24 items-center justify-center select-none" aria-hidden="true">
      <svg viewBox="0 0 96 68" fill="none" className="w-full h-full drop-shadow-md">
        <defs>
          <linearGradient id="tier-l7-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00F5A0" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="tier-l4-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#6366F1" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="tier-l3-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366F1" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#818CF8" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        {/* L3 Base Layer (Volumetric) */}
        <polygon
          points="48,46 86,55 48,64 10,55"
          fill="rgba(99,102,241,0.08)"
          stroke="url(#tier-l3-grad)"
          strokeWidth="1.2"
        />

        {/* L4 Middle Layer (Transport / Protocol) */}
        <polygon
          points="48,30 86,39 48,48 10,39"
          fill="rgba(56,189,248,0.12)"
          stroke="url(#tier-l4-grad)"
          strokeWidth="1.4"
        >
          <animate
            attributeName="transform"
            type="translate"
            values="0,0; 0,-2; 0,0"
            dur="3.2s"
            repeatCount="indefinite"
          />
        </polygon>

        {/* L7 Top Layer (Application / Semantic AI) */}
        <polygon
          points="48,14 86,23 48,32 10,23"
          fill="rgba(0,245,160,0.15)"
          stroke="url(#tier-l7-grad)"
          strokeWidth="1.6"
        >
          <animate
            attributeName="transform"
            type="translate"
            values="0,0; 0,-4; 0,0"
            dur="3.2s"
            repeatCount="indefinite"
          />
        </polygon>

        {/* Vertical laser filtration ray passing down */}
        <line x1="48" y1="4" x2="48" y2="60" stroke="#00F5A0" strokeWidth="1.5" strokeDasharray="3 6">
          <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="0.8s" repeatCount="indefinite" />
        </line>

        {/* Glowing focal photon at apex */}
        <circle cx="48" cy="14" r="3.5" fill="#00F5A0">
          <animate attributeName="r" values="3;4.5;3" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  )
}

// ----------------------------------------------------------------
// 2. REPUTATION — رادار البصمة الرقمية والتقييم السلوكي (IP Heuristics)
// ----------------------------------------------------------------
export function IllustrationReputation() {
  return (
    <div dir="ltr" className="relative flex h-16 w-24 items-center justify-center select-none" aria-hidden="true">
      <svg viewBox="0 0 96 68" fill="none" className="w-full h-full drop-shadow-md">
        {/* Outer biometric concentric arcs */}
        <circle cx="48" cy="36" r="28" stroke="rgba(56,189,248,0.12)" strokeWidth="1" strokeDasharray="4 6" />
        <circle cx="48" cy="36" r="20" stroke="rgba(56,189,248,0.22)" strokeWidth="1.2" />
        <circle cx="48" cy="36" r="12" stroke="rgba(0,245,160,0.35)" strokeWidth="1.4">
          <animate attributeName="stroke-opacity" values="0.35;0.8;0.35" dur="2.2s" repeatCount="indefinite" />
        </circle>

        {/* Rotating radar sweep */}
        <line x1="48" y1="36" x2="48" y2="8" stroke="rgba(0,245,160,0.7)" strokeWidth="1.5" strokeLinecap="round">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 48 36"
            to="360 48 36"
            dur="3.6s"
            repeatCount="indefinite"
          />
        </line>

        {/* Soft radar sweep cone */}
        <path d="M 48 36 L 48 8 A 28 28 0 0 1 74 36 Z" fill="rgba(0,245,160,0.06)">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 48 36"
            to="360 48 36"
            dur="3.6s"
            repeatCount="indefinite"
          />
        </path>

        {/* Detected IP Blip 1 (Safe) */}
        <circle cx="58" cy="24" r="2.5" fill="#00F5A0">
          <animate attributeName="opacity" values="0.2;1;0.2" dur="1.8s" repeatCount="indefinite" />
        </circle>

        {/* Detected IP Blip 2 (Blocked Threat) */}
        <circle cx="34" cy="46" r="2.5" fill="#F43F5E">
          <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" repeatCount="indefinite" />
        </circle>

        {/* Core center eye */}
        <circle cx="48" cy="36" r="3.5" fill="#38BDF8" />
        <circle cx="48" cy="36" r="1.5" fill="#FFFFFF" />
      </svg>
    </div>
  )
}

// ----------------------------------------------------------------
// 3. SILENT — التحدي الخفي بدون كابتشا (Zero-Friction Cryptographic Handshake)
// ----------------------------------------------------------------
export function IllustrationSilent() {
  return (
    <div dir="ltr" className="relative flex h-16 w-24 items-center justify-center select-none" aria-hidden="true">
      <svg viewBox="0 0 96 68" fill="none" className="w-full h-full drop-shadow-md">
        {/* Left: User browser capsule */}
        <rect x="6" y="24" width="26" height="20" rx="5" fill="rgba(56,189,248,0.08)" stroke="rgba(56,189,248,0.4)" strokeWidth="1.2" />
        <circle cx="13" cy="34" r="2.5" fill="#38BDF8" />
        <line x1="18" y1="34" x2="28" y2="34" stroke="rgba(56,189,248,0.4)" strokeWidth="1.2" />

        {/* Right: Protected server destination */}
        <rect x="64" y="24" width="26" height="20" rx="5" fill="rgba(0,245,160,0.08)" stroke="rgba(0,245,160,0.5)" strokeWidth="1.2" />
        <line x1="70" y1="31" x2="84" y2="31" stroke="rgba(0,245,160,0.4)" strokeWidth="1" />
        <line x1="70" y1="37" x2="84" y2="37" stroke="rgba(0,245,160,0.3)" strokeWidth="1" />
        <circle cx="83" cy="31" r="1.5" fill="#00F5A0" />

        {/* Center: Invisible Quantum Shield Barrier */}
        <rect x="46" y="12" width="4" height="44" rx="2" fill="rgba(99,102,241,0.25)" stroke="#6366F1" strokeWidth="1">
          <animate attributeName="stroke-opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
        </rect>

        {/* Cryptographic token passing invisibly right through */}
        <circle cx="48" cy="34" r="5" fill="none" stroke="#00F5A0" strokeWidth="1.5">
          <animate attributeName="r" values="3;7;3" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="1;0;1" dur="2.4s" repeatCount="indefinite" />
        </circle>

        {/* Stream of verified zero-knowledge packets */}
        <line x1="32" y1="34" x2="64" y2="34" stroke="#00F5A0" strokeWidth="1.6" strokeDasharray="3 4">
          <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="0.6s" repeatCount="indefinite" />
        </line>
      </svg>
    </div>
  )
}

// ----------------------------------------------------------------
// 4. FEDERATED — شبكة استخبارات موزعة (Global Mesh Intelligence)
// ----------------------------------------------------------------
export function IllustrationFederated() {
  const nodes = [
    { cx: 48, cy: 34, r: 5, color: '#00F5A0' }, // Center Hub
    { cx: 20, cy: 18, r: 3.5, color: '#38BDF8' }, // Tokyo POP
    { cx: 76, cy: 18, r: 3.5, color: '#818CF8' }, // Frankfurt POP
    { cx: 18, cy: 50, r: 3.5, color: '#6366F1' }, // Ashburn POP
    { cx: 78, cy: 50, r: 3.5, color: '#38BDF8' }, // London POP
  ]

  return (
    <div dir="ltr" className="relative flex h-16 w-24 items-center justify-center select-none" aria-hidden="true">
      <svg viewBox="0 0 96 68" fill="none" className="w-full h-full drop-shadow-md">
        {/* Mesh connecting edges */}
        {[
          [0, 1], [0, 2], [0, 3], [0, 4],
          [1, 2], [2, 4], [4, 3], [3, 1],
        ].map(([a, b], idx) => (
          <line
            key={idx}
            x1={nodes[a].cx}
            y1={nodes[a].cy}
            x2={nodes[b].cx}
            y2={nodes[b].cy}
            stroke="rgba(56,189,248,0.22)"
            strokeWidth="1"
            strokeDasharray="2 4"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to={idx % 2 === 0 ? '-12' : '12'}
              dur={`${0.8 + idx * 0.15}s`}
              repeatCount="indefinite"
            />
          </line>
        ))}

        {/* Nodes with pulse rings */}
        {nodes.map((n, i) => (
          <g key={i}>
            <circle cx={n.cx} cy={n.cy} r={n.r + 3} fill="none" stroke={n.color} strokeWidth="0.8" opacity="0.4">
              <animate attributeName="r" values={`${n.r + 1};${n.r + 6};${n.r + 1}`} dur="2.4s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0;0.6" dur="2.4s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
            </circle>
            <circle cx={n.cx} cy={n.cy} r={n.r} fill={n.color} />
          </g>
        ))}
      </svg>
    </div>
  )
}

// ----------------------------------------------------------------
// 5. ISOLATION — العزل الكوانتي وحماية الموارد (Cryptographic Bunker)
// ----------------------------------------------------------------
export function IllustrationIsolation() {
  return (
    <div dir="ltr" className="relative flex h-16 w-24 items-center justify-center select-none" aria-hidden="true">
      <svg viewBox="0 0 96 68" fill="none" className="w-full h-full drop-shadow-md">
        {/* Left: Quarantined Attack Chamber */}
        <rect x="6" y="14" width="34" height="40" rx="5" fill="rgba(244,63,94,0.06)" stroke="rgba(244,63,94,0.3)" strokeWidth="1.2" />
        {/* Blocked malicious particles */}
        {[
          { cx: 16, cy: 26 },
          { cx: 28, cy: 22 },
          { cx: 20, cy: 42 },
          { cx: 30, cy: 38 },
        ].map((pt, i) => (
          <circle key={i} cx={pt.cx} cy={pt.cy} r="2.2" fill="#F43F5E">
            <animate attributeName="opacity" values="0.4;1;0.4" dur={`${1.4 + i * 0.3}s`} repeatCount="indefinite" />
          </circle>
        ))}

        {/* Center: Laser-Sealed Titanium Firewall */}
        <rect x="43" y="8" width="10" height="52" rx="3" fill="rgba(6,10,24,0.9)" stroke="rgba(0,245,160,0.6)" strokeWidth="1.4">
          <animate attributeName="stroke-opacity" values="0.5;1;0.5" dur="1.8s" repeatCount="indefinite" />
        </rect>
        <line x1="48" y1="12" x2="48" y2="56" stroke="#00F5A0" strokeWidth="1.2" />

        {/* Right: Sterile Zero-Trust Compute Core */}
        <rect x="56" y="14" width="34" height="40" rx="5" fill="rgba(0,245,160,0.06)" stroke="rgba(0,245,160,0.4)" strokeWidth="1.2" />
        {/* Protected Origin Shield Icon */}
        <path d="M 73 24 L 81 27 V 37 C 81 41 73 45 73 45 C 73 45 65 41 65 37 V 27 Z" fill="rgba(0,245,160,0.15)" stroke="#00F5A0" strokeWidth="1.2">
          <animate attributeName="stroke-opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite" />
        </path>
        <circle cx="73" cy="34" r="2" fill="#FFFFFF" />
      </svg>
    </div>
  )
}

// ----------------------------------------------------------------
// 6. REPORTS — التحليل الجنائي والتيليمترية الحية (Forensic Telemetry)
// ----------------------------------------------------------------
export function IllustrationReports() {
  return (
    <div dir="ltr" className="relative flex h-16 w-24 items-center justify-center select-none" aria-hidden="true">
      <svg viewBox="0 0 96 68" fill="none" className="w-full h-full drop-shadow-md">
        <defs>
          <linearGradient id="rep-line-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="60%" stopColor="#00F5A0" />
            <stop offset="100%" stopColor="#FFFFFF" />
          </linearGradient>
          <linearGradient id="rep-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00F5A0" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#00F5A0" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Outer terminal console */}
        <rect x="6" y="8" width="84" height="52" rx="6" fill="rgba(8,16,36,0.85)" stroke="rgba(56,189,248,0.25)" strokeWidth="1.2" />

        {/* Terminal Header Bar */}
        <line x1="6" y1="18" x2="90" y2="18" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        <circle cx="14" cy="13" r="1.8" fill="#F43F5E" />
        <circle cx="20" cy="13" r="1.8" fill="#F59E0B" />
        <circle cx="26" cy="13" r="1.8" fill="#00F5A0" />

        {/* Grid lines */}
        <line x1="12" y1="30" x2="84" y2="30" stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="2 3" />
        <line x1="12" y1="42" x2="84" y2="42" stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="2 3" />

        {/* Live incident metric wave */}
        <path
          d="M 12 48 L 26 44 L 40 32 L 54 36 L 68 24 L 84 22"
          stroke="url(#rep-line-grad)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <animate
            attributeName="stroke-dashoffset"
            from="120"
            to="0"
            dur="2s"
            repeatCount="indefinite"
          />
        </path>

        {/* Area under wave */}
        <path
          d="M 12 48 L 26 44 L 40 32 L 54 36 L 68 24 L 84 22 L 84 54 L 12 54 Z"
          fill="url(#rep-area-grad)"
        />

        {/* Pulsing active incident marker */}
        <circle cx="84" cy="22" r="3" fill="#00F5A0">
          <animate attributeName="r" values="2.5;4.5;2.5" dur="1.5s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  )
}
