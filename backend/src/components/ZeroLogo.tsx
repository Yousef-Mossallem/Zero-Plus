// frontend/src/components/ZeroLogo.tsx
// ==================================================================
// Zero Plus — الشعار الرسمي الفاخر للمنصة (Ultra-Premium Bespoke Identity)
// التكوين الرياضي:
// 1. الحلقة المحيطية "0" (Perimeter Shield Ring): تمثل درع الحماية و مبدأ Zero Trust
//    مقسمة إلى 4 قطاعات متطورة مع حواف مشطوفة ودبابيس استشعار تيليمترية عند الزوايا 45°
// 2. النواة الداخلية "+" (Precision Defense Reticle): نقطة تصويب دقيقة مع ماسة مركزية
// 3. التدرج اللوني: مزيج من السيان النقي والكوبالت الفضائي والبنفسجي الكهربائي
// ==================================================================

import { useId } from 'react'

export interface ZeroLogoProps {
  size?: number
  className?: string
  glow?: boolean
  variant?: 'gradient' | 'white' | 'mono'
  animated?: boolean
}

export function ZeroLogo({
  size = 34,
  className = '',
  glow = true,
  variant = 'gradient',
  animated = false,
}: ZeroLogoProps) {
  const rawId = useId()
  const uid = rawId.replace(/:/g, '')

  const gradPrimary = `zp-logo-gp-${uid}`
  const gradSecondary = `zp-logo-gs-${uid}`
  const gradCore = `zp-logo-gc-${uid}`
  const filterGlow = `zp-logo-fl-${uid}`

  const strokeMain =
    variant === 'gradient'
      ? `url(#${gradPrimary})`
      : variant === 'white'
      ? '#FFFFFF'
      : '#94A3B8'

  const strokeAccent =
    variant === 'gradient'
      ? `url(#${gradSecondary})`
      : variant === 'white'
      ? 'rgba(255,255,255,0.85)'
      : '#64748B'

  const fillCore =
    variant === 'gradient'
      ? `url(#${gradCore})`
      : variant === 'white'
      ? '#FFFFFF'
      : '#94A3B8'

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`shrink-0 select-none ${className}`}
    >
      <defs>
        {/* التدرج اللوني الأساسي للدرع 0 */}
        <linearGradient id={gradPrimary} x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00F5A0" />
          <stop offset="35%" stopColor="#38BDF8" />
          <stop offset="70%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#818CF8" />
        </linearGradient>

        {/* التدرج اللوني الثانوي للأذرع المحورية */}
        <linearGradient id={gradSecondary} x1="12" y1="32" x2="52" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="50%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#818CF8" />
        </linearGradient>

        {/* التدرج اللوني للماسة المركزية + */}
        <radialGradient id={gradCore} cx="32" cy="32" r="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#6366F1" />
        </radialGradient>

        {/* فلتر الإشعاع الضوئي الفاخر (Soft Optics Glow) */}
        {glow && (
          <filter id={filterGlow} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="
                1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.55 0"
              result="glowMatrix"
            />
            <feMerge>
              <feMergeNode in="glowMatrix" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>

      <g filter={glow ? `url(#${filterGlow})` : undefined}>
        {/* 1. الهالة المحيطية الرقيقة جداً (Outer Orbit Wire) */}
        <circle
          cx="32"
          cy="32"
          r="28"
          stroke={variant === 'gradient' ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.1)'}
          strokeWidth="1"
          strokeDasharray="2 6"
        />

        {/* 2. قطاعات درع الصفر "0" الرئيسي (Precision Shield Quadrants) */}
        {/* نصف القطر R=22، فجوات رشيقة عند المحاور 0/90/180/270 تتيح مرور علامة الزائد */}
        {/* قوس الشمال الشرقي (NE) */}
        <path
          d="M 38 10.8 C 45.5 12.5 51.5 18.5 53.2 26"
          stroke={strokeMain}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        {/* قوس الجنوب الشرقي (SE) */}
        <path
          d="M 53.2 38 C 51.5 45.5 45.5 51.5 38 53.2"
          stroke={strokeMain}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        {/* قوس الجنوب الغربي (SW) */}
        <path
          d="M 26 53.2 C 18.5 51.5 12.5 45.5 10.8 38"
          stroke={strokeMain}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        {/* قوس الشمال الغربي (NW) */}
        <path
          d="M 10.8 26 C 12.5 18.5 18.5 12.5 26 10.8"
          stroke={strokeMain}
          strokeWidth="3.2"
          strokeLinecap="round"
        />

        {/* 3. شطافات أمان هندسية داخلية (Inner Chamfer Guides) */}
        <circle
          cx="32"
          cy="32"
          r="16"
          stroke={variant === 'gradient' ? 'rgba(129,140,248,0.25)' : 'rgba(255,255,255,0.15)'}
          strokeWidth="1"
          strokeDasharray="1 5"
        />

        {/* 4. نقاط الاستشعار الأربع عند الزوايا القطرية 45° (Telemetry Sensor Pips) */}
        <circle cx="47.5" cy="16.5" r="1.6" fill={variant === 'gradient' ? '#38BDF8' : '#FFFFFF'} />
        <circle cx="47.5" cy="47.5" r="1.6" fill={variant === 'gradient' ? '#818CF8' : '#FFFFFF'} />
        <circle cx="16.5" cy="47.5" r="1.6" fill={variant === 'gradient' ? '#6366F1' : '#FFFFFF'} />
        <circle cx="16.5" cy="16.5" r="1.6" fill={variant === 'gradient' ? '#00F5A0' : '#FFFFFF'} />

        {/* 5. خطوط علامة الزائد "+" المحورية التهديفية (Precision Crosshair) */}
        {/* المحور الأفقي */}
        <line
          x1="8"
          y1="32"
          x2="24"
          y2="32"
          stroke={strokeAccent}
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <line
          x1="40"
          y1="32"
          x2="56"
          y2="32"
          stroke={strokeAccent}
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        {/* المحور الرأسي */}
        <line
          x1="32"
          y1="8"
          x2="32"
          y2="24"
          stroke={strokeAccent}
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <line
          x1="32"
          y1="40"
          x2="32"
          y2="56"
          stroke={strokeAccent}
          strokeWidth="2.8"
          strokeLinecap="round"
        />

        {/* 6. الماسة المركزية ذات البعد البؤري (Targeting Prism Core) */}
        <polygon
          points="32,26.5 37.5,32 32,37.5 26.5,32"
          fill={fillCore}
          stroke={variant === 'gradient' ? '#FFFFFF' : 'transparent'}
          strokeWidth="0.8"
        />
        <circle cx="32" cy="32" r="1.8" fill="#FFFFFF" />

        {/* إذا كان وضع الحركة مفعلاً — رادار ناعم جداً بدون إزعاج */}
        {animated && (
          <line
            x1="32"
            y1="32"
            x2="32"
            y2="10"
            stroke="rgba(56,189,248,0.7)"
            strokeWidth="1.2"
            strokeLinecap="round"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 32 32"
              to="360 32 32"
              dur="6s"
              repeatCount="indefinite"
            />
          </line>
        )}
      </g>
    </svg>
  )
}
