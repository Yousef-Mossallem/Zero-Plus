// frontend/src/components/RiskGauge.tsx
// ==================================================================
// Zero Plus - Risk Gauge
// مؤشر بصري لـ Risk Score (0-100)
//   variant="bar"  → شريط صغير جوه الجداول
//   variant="ring" → دائرة كبيرة للتفاصيل
// الألوان حسب حدود الدوسيه: 0-30 أخضر • 31-60 أصفر • 61-80 برتقالي • 81+ أحمر
// ==================================================================

interface RiskGaugeProps {
  score: number
  variant?: 'bar' | 'ring'
  /** حدود مخصصة (من الـ Policy بتاعة الشركة) */
  thresholds?: { allow: number; rateLimit: number; challenge: number }
}

const DEFAULT_THRESHOLDS = { allow: 30, rateLimit: 60, challenge: 80 }

function colorFor(score: number, t: NonNullable<RiskGaugeProps['thresholds']>) {
  if (score <= t.allow) return { hex: '#10B981', text: 'text-emerald-400', label: 'Low' }
  if (score <= t.rateLimit) return { hex: '#F59E0B', text: 'text-amber-400', label: 'Medium' }
  if (score <= t.challenge) return { hex: '#FB923C', text: 'text-orange-400', label: 'High' }
  return { hex: '#F43F5E', text: 'text-rose-400', label: 'Critical' }
}

export default function RiskGauge({
  score,
  variant = 'bar',
  thresholds = DEFAULT_THRESHOLDS,
}: RiskGaugeProps) {
  const value = Math.min(100, Math.max(0, Math.round(score)))
  const color = colorFor(value, thresholds)

  // ---------------- Bar ----------------
  if (variant === 'bar') {
    return (
      <div className="flex w-28 items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
          <div
            className="zp-anim-bar h-full rounded-full"
            style={{ width: `${value}%`, backgroundColor: color.hex }}
          />
        </div>
        <span className={`w-7 text-right text-xs font-semibold tabular-nums ${color.text}`}>
          {value}
        </span>
      </div>
    )
  }

  // ---------------- Ring ----------------
  const radius = 44
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - value / 100)

  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color.hex}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-3xl font-bold tabular-nums ${color.text}`}>{value}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {color.label}
        </span>
      </div>
    </div>
  )
}
