import { useState } from 'react';

/**
 * Chart marks use a validated dark-mode step (OKLCH L inside 0.48–0.67 on #0b0c11);
 * text always uses ink tokens, never the series colour.
 */
export const CHART = {
  accent: '#1a96d0',
  miss: '#ff2a44',
  muted: '#5c6078',
  track: '#1b2a36',
  surface: '#0b0c11',
  grid: '#1c1e28',
};

/**
 * Single-series sparkline: de-emphasis line, accent end-dot (current run).
 * Touch/hover anywhere to read the nearest value (tooltip never gates — min/max/last
 * are printed beside the chart).
 */
export function Sparkline({
  values,
  format,
  label,
  invert = false,
}: {
  values: number[];
  format: (v: number) => string;
  label: string;
  /** For metrics where lower is better (reaction ms) the y-axis is flipped so "up" = better. */
  invert?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const W = 300;
  const H = 72;
  const pad = 8;
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (values.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (values.length - 1));
  const y = (v: number) => {
    const t = (v - min) / span;
    return pad + (invert ? t : 1 - t) * (H - pad * 2);
  };
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  const shown = active ?? last;

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bd = Infinity;
    values.forEach((_, i) => {
      const dd = Math.abs(x(i) - px);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    setActive(best);
  };

  return (
    <figure className="m-0">
      <div className="mb-1 flex items-baseline justify-between">
        <figcaption className="text-[12px] text-mist">{label}</figcaption>
        <div className="text-[13px] font-semibold text-bone">
          {format(values[shown])}
          <span className="ml-2 text-[11px] font-normal text-mist">#{shown + 1}</span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[72px] w-full touch-none"
        role="img"
        aria-label={`${label}: ${values.map(format).join(', ')}`}
        onPointerDown={onPointer}
        onPointerMove={(e) => e.buttons || e.pointerType === 'mouse' ? onPointer(e) : undefined}
        onPointerLeave={() => setActive(null)}
      >
        <line x1={0} x2={W} y1={H - 1} y2={H - 1} stroke={CHART.grid} strokeWidth={1} />
        {active !== null && <line x1={x(active)} x2={x(active)} y1={0} y2={H} stroke={CHART.muted} strokeWidth={1} />}
        <path d={d} fill="none" stroke={CHART.muted} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(shown)} cy={y(values[shown])} r={5} fill={CHART.accent} stroke={CHART.surface} strokeWidth={2} />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-mist">
        <span>min {format(min)}</span>
        <span>max {format(max)}</span>
      </div>
    </figure>
  );
}

/** Horizontal success bar: accent fill over a same-hue darker track, ≤ 8px thick. */
export function RatioBar({ label, ok, n }: { label: string; ok: number; n: number }) {
  const pct = n ? ok / n : 0;
  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] text-bone/85">{label}</span>
        <span className="text-[13px] font-semibold text-bone">
          {ok}/{n}
          <span className="ml-2 text-[11px] font-normal text-mist">{n ? Math.round(pct * 100) : 0}%</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-[4px]" style={{ background: CHART.track }}>
        <div className="h-full rounded-[4px]" style={{ width: `${pct * 100}%`, background: CHART.accent }} />
      </div>
    </div>
  );
}

export function StatTile({ label, value, delta, deltaGood }: { label: string; value: string; delta?: string; deltaGood?: boolean }) {
  return (
    <div className="border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
      <div className="text-[12px] text-mist">{label}</div>
      <div className="mt-1 text-[22px] font-semibold leading-tight text-bone">{value}</div>
      {delta && (
        <div className="mt-0.5 text-[11px]" style={{ color: deltaGood ? '#7fd8ff' : '#ff8a99' }}>
          {deltaGood ? '▲' : '▼'} {delta}
        </div>
      )}
    </div>
  );
}
