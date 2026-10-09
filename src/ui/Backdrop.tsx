/** Shared cinematic backdrop for menu screens (pure CSS/SVG, GPU-cheap). */
export function Backdrop({ tone = 'mixed' }: { tone?: 'mixed' | 'blood' | 'volt' }) {
  const top = tone === 'volt' ? 'rgba(57,213,255,0.14)' : 'rgba(170,16,40,0.32)';
  const bottom = tone === 'blood' ? 'rgba(170,16,40,0.18)' : 'rgba(26,92,255,0.16)';
  return (
    <div aria-hidden className="grain pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[#050507]" />
      <div className="absolute inset-0" style={{ background: `radial-gradient(120% 60% at 50% -5%, ${top}, transparent 60%)` }} />
      <div className="absolute inset-0" style={{ background: `radial-gradient(100% 50% at 50% 110%, ${bottom}, transparent 65%)` }} />
      <div
        className="absolute inset-x-0 top-[47%] h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(255,42,68,0.55), transparent)' }}
      />
      <svg className="absolute bottom-0 left-0 h-[53%] w-full opacity-40" viewBox="0 0 100 100" preserveAspectRatio="none">
        {Array.from({ length: 13 }, (_, i) => (
          <line key={i} x1={50 + (i - 6) * 2.5} y1={0} x2={50 + (i - 6) * 16} y2={100} stroke="#2c3c66" strokeWidth={0.15} />
        ))}
        {Array.from({ length: 9 }, (_, j) => {
          const y = Math.pow((j + 1) / 9, 2.1) * 100;
          return <line key={j} x1={0} x2={100} y1={y} y2={y} stroke="#2c3c66" strokeWidth={0.12 + j * 0.02} />;
        })}
      </svg>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(90% 70% at 50% 50%, transparent 55%, rgba(0,0,0,0.85))' }} />
    </div>
  );
}

/** The emblem: a halo ring with a red core — VERDICT's sigil, seen by the anomaly. */
export function Emblem({ size = 220 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden className="overflow-visible">
      <defs>
        <radialGradient id="core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="25%" stopColor="#ff6a7a" />
          <stop offset="60%" stopColor="rgba(255,42,68,0.25)" />
          <stop offset="100%" stopColor="rgba(255,42,68,0)" />
        </radialGradient>
        <filter id="neon" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx="100" cy="100" r="46" fill="url(#core)" opacity="0.8" />
      <g className="anim-spin-slow" style={{ transformOrigin: '100px 100px' }} filter="url(#neon)">
        {Array.from({ length: 9 }, (_, i) => {
          const a0 = (i / 9) * Math.PI * 2;
          const a1 = a0 + (Math.PI * 2) / 9 - 0.18;
          const r = 84;
          return (
            <path
              key={i}
              d={`M ${100 + Math.cos(a0) * r} ${100 + Math.sin(a0) * r} A ${r} ${r} 0 0 1 ${100 + Math.cos(a1) * r} ${100 + Math.sin(a1) * r}`}
              stroke="#ff2a44"
              strokeWidth="2.2"
              fill="none"
            />
          );
        })}
      </g>
      <circle cx="100" cy="100" r="66" stroke="rgba(57,213,255,0.35)" strokeWidth="1" fill="none" strokeDasharray="2 6" />
      <rect x="99" y="66" width="2" height="68" rx="1" fill="#ffd0d6" filter="url(#neon)" />
    </svg>
  );
}
