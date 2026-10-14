import { useState, type ReactNode } from 'react';

/**
 * Chart marks in the v3 noir palette, checked against the ink surface (#0b0c11):
 * accent blood 5.3:1, series bone-gray 7.5:1, muted line 3.2:1. One series per chart, so no
 * legend boxes; emphasis = one mark in blood, the rest in bone-gray. Text always uses ink
 * tokens (bone / mist), never the mark colour.
 */
export const CHART = {
  accent: '#ff2a44',
  series: '#9aa0b4',
  muted: '#5c6078',
  track: '#1b1c25',
  surface: '#0b0c11',
  grid: '#1c1e28',
  good: '#eef0f7',
  bad: '#ff8a99',
};

/**
 * Single-series sparkline: de-emphasis line, accent end-dot (current run).
 * Touch/hover anywhere to read the nearest value (the tooltip never gates — min/max/last
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
  /** For metrics where lower is better (timing ms) the y-axis is flipped so "up" = better. */
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
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <figcaption className="text-[12px] text-mist">{label}</figcaption>
        <div className="shrink-0 text-[13px] font-semibold text-bone">
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
        onPointerMove={(e) => (e.buttons || e.pointerType === 'mouse' ? onPointer(e) : undefined)}
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

/** One horizontal bar: square at the baseline, 4 px rounded data end, same-ramp darker track. */
function Bar({ pct, highlight }: { pct: number; highlight?: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden" style={{ background: CHART.track }}>
      <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%`, background: highlight ? CHART.accent : CHART.series }} />
    </div>
  );
}

/**
 * Success ratio with counts. `highlight` marks the one row the story is about (the weak spot):
 * the bar turns blood and `note` (a label, never colour alone) explains why.
 */
export function RatioBar({ label, ok, n, highlight = false, note }: { label: string; ok: number; n: number; highlight?: boolean; note?: ReactNode }) {
  const pct = n ? ok / n : 0;
  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[13px] text-bone/85">
          {label}
          {note && <span className="ml-2">{note}</span>}
        </span>
        <span className="shrink-0 text-[13px] font-semibold text-bone">
          {ok}/{n}
          <span className="ml-2 inline-block w-9 text-right text-[11px] font-normal text-mist">{n ? Math.round(pct * 100) : 0}%</span>
        </span>
      </div>
      <Bar pct={pct} highlight={highlight} />
    </div>
  );
}

/** A 0..1 share without counts (aggregates); null renders as a dash. */
export function MeterRow({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[13px] text-bone/85">
          {label}
          {hint && <span className="block text-[11px] text-mist">{hint}</span>}
        </span>
        <span className="shrink-0 text-[13px] font-semibold text-bone">{value === null ? '—' : `${Math.round(value * 100)}%`}</span>
      </div>
      <Bar pct={value ?? 0} />
    </div>
  );
}

export function StatTile({
  label,
  value,
  delta,
  deltaGood,
  deltaDir,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaGood?: boolean;
  /** Arrow direction; defaults to ▲ for good / ▼ for bad. */
  deltaDir?: 'up' | 'down';
  /** Secondary line under the value. */
  sub?: string;
  /** The tile the story is about (thin blood rule on the left). */
  accent?: boolean;
}) {
  const dir = deltaDir ?? (deltaGood ? 'up' : 'down');
  return (
    <div className={`relative min-w-0 border bg-black/35 px-3 py-2.5 ${accent ? 'border-blood/35' : 'border-white/[0.07]'}`}>
      {accent && <span aria-hidden className="absolute inset-y-2 left-0 w-[2px] bg-blood" />}
      <div className="truncate text-[11px] leading-tight text-mist">{label}</div>
      <div className="mt-1 text-[21px] font-semibold leading-tight text-bone">{value}</div>
      {delta && (
        <div className="mt-0.5 text-[11px] leading-tight" style={{ color: deltaGood ? CHART.good : CHART.bad }}>
          {dir === 'up' ? '▲' : '▼'} {delta}
        </div>
      )}
      {sub && <div className="mt-0.5 text-[11px] leading-tight text-mist">{sub}</div>}
    </div>
  );
}
