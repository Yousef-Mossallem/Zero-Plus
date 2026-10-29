// frontend/src/components/logo.tsx
// Zero Plus — simple interlocking Z + P monogram

export default function Logo({
  className = 'h-8 w-8',
}: {
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Zero Plus"
    >
      <defs>
        <linearGradient
          id="zpGrad"
          x1="6"
          y1="6"
          x2="42"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#22D3EE" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
      </defs>

      {/*
        Interlocking ZP:
        - Z on the left (top bar, diagonal, bottom bar)
        - P shares the vertical stem on the right side of Z
      */}
      <g fill="url(#zpGrad)">
        {/* Z top bar */}
        <rect x="6" y="9" width="28" height="6" rx="1.2" />
        {/* Z diagonal */}
        <path d="M30.5 9 14 33h-7.2L23.3 9h7.2z" />
        {/* Z bottom bar / P stem base */}
        <rect x="6" y="33" width="20" height="6" rx="1.2" />
        {/* P vertical stem (shared) */}
        <rect x="20" y="20" width="6.5" height="19" rx="1.2" />
        {/* P bowl */}
        <path d="M26.5 20h7.5c6 0 10.5 3.4 10.5 9s-4.5 9-10.5 9H26.5V20zm6.2 5.2v7.6h1.6c2.9 0 4.6-1.5 4.6-3.8s-1.7-3.8-4.6-3.8h-1.6z" />
      </g>
    </svg>
  )
}
