// frontend/src/pages/landing/LiveDemoIllustration.tsx
// ==================================================================
// Zero Plus — منظار الفحص الحي لتحليل الحزم البرمجية (Live Heuristic Packet Scope)
// يعرض محاكاة حية لفحص حزم البيانات القادمة في أجزاء من الميلي ثانية:
// - تحليل بصمة JA4 وتوزيع رأس الحزمة
// - حساب مؤشر الشذوذ السلوكي (Anomaly Score: 0.02 مقابل 0.98)
// - اتخاذ قرار فوري (ALLOW / SCRUB) بدون تأخير زمني
// ==================================================================

import { useEffect, useState } from 'react'

const PACKET_STREAM = [
  {
    ip: '192.0.2.45',
    proto: 'HTTPS/TLS 1.3',
    ja4: 't13d1516h2_8daaf6152771_b186095e22b6',
    score: '0.04 (Clean)',
    action: 'PASS',
    color: 'emerald',
  },
  {
    ip: '185.220.101.5',
    proto: 'TCP SYN 64B',
    ja4: 't13d000000_000000000000_000000000000',
    score: '0.99 (Volumetric)',
    action: 'SCRUBBED',
    color: 'rose',
  },
  {
    ip: '198.51.100.88',
    proto: 'HTTP/2 GET',
    ja4: 't13d1516h2_7718daaf6152_95e22b6b1860',
    score: '0.08 (Verified)',
    action: 'PASS',
    color: 'emerald',
  },
  {
    ip: '45.142.212.19',
    proto: 'DNS AMP 512B',
    ja4: 't13d0304h0_450012891289_111122223333',
    score: '0.96 (Malicious)',
    action: 'SCRUBBED',
    color: 'rose',
  },
]

export function LiveDemoScope() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % PACKET_STREAM.length)
    }, 2400)
    return () => clearInterval(timer)
  }, [])

  const current = PACKET_STREAM[index]
  const isClean = current.color === 'emerald'

  return (
    <div
      dir="ltr"
      className="relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-[#070b16]/90 p-6 shadow-2xl backdrop-blur-xl"
      aria-hidden="true"
    >
      {/* Top accent ray */}
      <div
        className={`absolute inset-x-0 top-0 h-px transition-colors duration-500 ${
          isClean
            ? 'bg-linear-to-r from-transparent via-emerald-400/60 to-transparent'
            : 'bg-linear-to-r from-transparent via-rose-500/60 to-transparent'
        }`}
      />

      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isClean ? 'bg-emerald-400' : 'bg-rose-500'
              } animate-pulse`}
            />
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-300">
              Heuristic Inspection Engine
            </span>
          </div>
          <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[11px] text-cyan-300">
            0.8ms Eval
          </span>
        </div>

        {/* Live Packet Scope Graphic */}
        <div className="mt-4 rounded-xl border border-white/6 bg-black/40 p-4 font-mono text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span>INCOMING IP:</span>
            <span className="font-bold text-white">{current.ip}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-slate-400">
            <span>PROTOCOL:</span>
            <span className="text-cyan-300">{current.proto}</span>
          </div>
          <div className="mt-2 text-slate-400">
            <span>JA4 FINGERPRINT:</span>
            <div className="mt-1 truncate rounded bg-white/4 px-2 py-1 text-[11px] text-slate-300">
              {current.ja4}
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between text-slate-400">
            <span>ANOMALY SCORE:</span>
            <span className={isClean ? 'font-bold text-emerald-400' : 'font-bold text-rose-400'}>
              {current.score}
            </span>
          </div>
        </div>
      </div>

      {/* Decision Output Pill */}
      <div className="mt-5 flex items-center justify-between rounded-xl border border-white/8 bg-white/2 p-3.5">
        <div className="flex items-center gap-2">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg font-mono font-bold ${
              isClean
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/20 text-rose-400'
            }`}
          >
            {isClean ? '✓' : '✕'}
          </div>
          <div>
            <div className="text-xs font-semibold text-white">Instant Edge Verdict</div>
            <div className="text-[11px] text-slate-400">Zero origin resource consumed</div>
          </div>
        </div>

        <span
          className={`rounded-lg px-3 py-1 font-mono text-xs font-bold transition-all duration-300 ${
            isClean
              ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'border border-rose-500/40 bg-rose-500/15 text-rose-300'
          }`}
        >
          {current.action}
        </span>
      </div>
    </div>
  )
}
