/**
 * Shared noir backdrop for the menu screens: a blood moon, rain and a city skyline under it.
 * Pure CSS/SVG (no canvas), GPU-cheap: only the rain layers and the moon's glow animate, with
 * transform/opacity, and both stop under "reduce motion".
 */

type Tone =
  /** Title: a big moon high in the middle. */
  | 'title'
  /** Hub: the moon over the right shoulder. */
  | 'hub'
  /** Results: a smaller, darker moon. */
  | 'dim'
  /** Data screens: haze only — no moon, no rain. */
  | 'plain'
  // legacy names (v2 callers)
  | 'mixed'
  | 'blood'
  | 'volt';

const MOON: Record<'title' | 'hub' | 'dim', { size: string; top: string; left: string; opacity: number }> = {
  title: { size: '74vmin', top: '7%', left: '50%', opacity: 1 },
  hub: { size: '58vmin', top: '4%', left: '78%', opacity: 0.92 },
  dim: { size: '44vmin', top: '3%', left: '84%', opacity: 0.55 },
};

export function Backdrop({ tone = 'hub', still = false }: { tone?: Tone; still?: boolean }) {
  const kind = tone === 'mixed' || tone === 'blood' ? 'hub' : tone === 'volt' ? 'dim' : tone;
  const moon = kind === 'plain' ? null : MOON[kind];
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${still ? 'still' : 'grain'}`}>
      <div className="absolute inset-0 bg-[#040305]" />
      {/* red haze high in the sky */}
      <div
        className="absolute inset-0"
        style={{
          background:
            kind === 'plain'
              ? 'radial-gradient(120% 40% at 70% -8%, rgba(130,10,28,0.32), transparent 70%)'
              : 'radial-gradient(130% 62% at 62% -4%, rgba(140,8,28,0.5), transparent 68%)',
        }}
      />
      {moon && (
        <div
          className="absolute"
          style={{ width: moon.size, height: moon.size, top: moon.top, left: moon.left, transform: 'translateX(-50%)', opacity: moon.opacity }}
        >
          <div className="bd-moon-glow absolute -inset-[35%]" />
          <div className="bd-moon absolute inset-0" />
          {/* a torn cloud across the face */}
          <div
            className="absolute left-[-30%] right-[-25%] top-[56%] h-[13%] rounded-[50%] bg-[#050306]"
            style={{ filter: 'blur(7px)', opacity: 0.85, transform: 'rotate(-7deg)' }}
          />
          <div
            className="absolute left-[-12%] right-[30%] top-[71%] h-[6%] rounded-[50%] bg-[#050306]"
            style={{ filter: 'blur(5px)', opacity: 0.7, transform: 'rotate(-5deg)' }}
          />
        </div>
      )}
      {kind !== 'plain' && <div className="bd-rain" />}
      {kind !== 'plain' && <Skyline />}
      {/* vignette */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(95% 75% at 50% 45%, transparent 52%, rgba(0,0,0,0.88))' }} />
    </div>
  );
}

// ---------------------------------------------------------------- skyline (deterministic)

interface Block {
  x: number;
  w: number;
  h: number;
  spire?: number;
}

function blocks(seed: number, count: number, minH: number, maxH: number, width = 400): Block[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const out: Block[] = [];
  let x = -6;
  for (let i = 0; i < count && x < width + 6; i++) {
    const w = 14 + Math.floor(rnd() * 26);
    const h = minH + Math.floor(rnd() * (maxH - minH));
    out.push({ x, w, h, spire: rnd() < 0.22 ? 6 + Math.floor(rnd() * 16) : undefined });
    x += w + (rnd() < 0.3 ? 2 : 0);
  }
  return out;
}

const FAR = blocks(7, 40, 46, 128);
const NEAR = blocks(19, 40, 18, 74);
const H = 160;

/** Lit windows: sparse, mostly dead; a few burn red. */
const WINDOWS = (() => {
  let s = 99;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const out: { x: number; y: number; red: boolean }[] = [];
  for (const b of FAR) {
    for (let y = H - b.h + 6; y < H - 8; y += 7) {
      for (let x = b.x + 3; x < b.x + b.w - 3; x += 5) if (rnd() < 0.045) out.push({ x, y, red: rnd() < 0.45 });
    }
  }
  return out;
})();

function Skyline() {
  return (
    <svg className="absolute bottom-0 left-0 h-[30%] w-full" viewBox={`0 0 400 ${H}`} preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="bd-fog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a0612" stopOpacity="0" />
          <stop offset="100%" stopColor="#1a0308" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {/* far towers */}
      <g fill="#0d0910">
        {FAR.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={H - b.h} width={b.w} height={b.h} />
            {b.spire && <rect x={b.x + b.w / 2 - 0.6} y={H - b.h - b.spire} width={1.2} height={b.spire} />}
          </g>
        ))}
      </g>
      {FAR.filter((b) => b.spire).map((b, i) => (
        <circle key={i} cx={b.x + b.w / 2} cy={H - b.h - (b.spire ?? 0)} r={0.9} fill="#ff2a44" opacity={0.85} />
      ))}
      {WINDOWS.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width={1.6} height={2.2} fill={w.red ? '#ff2a44' : '#e8c9a8'} opacity={w.red ? 0.55 : 0.22} />
      ))}
      <rect x="0" y="0" width="400" height={H} fill="url(#bd-fog)" />
      {/* temple on the far right — act IV waits there */}
      <g fill="#07050a">
        <rect x="338" y={H - 50} width="28" height="50" />
        <path d={`M 322 ${H - 49} Q 337 ${H - 52} 343 ${H - 61} L 361 ${H - 61} Q 367 ${H - 52} 382 ${H - 49} Z`} />
        <rect x="344" y={H - 72} width="16" height="12" />
        <path d={`M 331 ${H - 71} Q 343 ${H - 73} 347 ${H - 82} L 357 ${H - 82} Q 361 ${H - 73} 373 ${H - 71} Z`} />
        <rect x="351.4" y={H - 94} width="1.2" height="13" />
      </g>
      {/* near rooftops */}
      <g fill="#020203">
        {NEAR.map((b, i) => (
          <rect key={i} x={b.x} y={H - b.h} width={b.w} height={b.h} />
        ))}
      </g>
    </svg>
  );
}

/** The emblem: a halo ring with a red core — VERDICT's sigil (kept for older callers). */
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
      <circle cx="100" cy="100" r="66" stroke="rgba(238,240,247,0.25)" strokeWidth="1" fill="none" strokeDasharray="2 6" />
      <rect x="99" y="66" width="2" height="68" rx="1" fill="#ffd0d6" filter="url(#neon)" />
    </svg>
  );
}
