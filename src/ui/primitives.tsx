import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { audio3, unlockAudio } from '@/audio/bus';

type Click = 'ui' | 'uiConfirm';

/** Every press makes a tiny sound and unlocks audio (safe inside user gestures). */
export function press(handler?: () => void, sound: Click = 'ui') {
  return () => {
    unlockAudio();
    audio3.sfx(sound);
    handler?.();
  };
}

/**
 * The main action: a blade-cut slab. `blood` (default) is filled red; `bone` is a quiet outline.
 * `volt` is the legacy name and renders as `bone` in the v3 palette.
 */
export function PrimaryButton({
  children,
  onPress,
  tone = 'blood',
  className = '',
  ...rest
}: { children: ReactNode; onPress?: () => void; tone?: 'blood' | 'bone' | 'volt' } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  const filled = tone === 'blood';
  return (
    <button
      type="button"
      onClick={press(onPress, 'uiConfirm')}
      className={`cut-corners focus-inset relative h-16 w-full overflow-hidden font-cut text-[16px] uppercase tracking-[0.2em] transition active:scale-[0.98] ${
        filled
          ? 'bg-gradient-to-r from-[#a70d26] via-[#d8162f] to-[#ff2a44] text-bone shadow-[0_0_30px_rgba(255,42,68,0.35)] active:brightness-110'
          : 'border border-bone/35 bg-black/50 text-bone active:bg-white/10'
      } ${className}`}
      {...rest}
    >
      <span className="relative z-10 flex items-center justify-center gap-3 [text-shadow:0_1px_0_rgba(60,0,10,0.6)]">{children}</span>
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/15 to-transparent [animation:sheen_3.4s_ease-in-out_infinite] [.reduce-motion_&]:hidden" />
    </button>
  );
}

export function GhostButton({
  children,
  onPress,
  className = '',
  ...rest
}: { children: ReactNode; onPress?: () => void } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button
      type="button"
      onClick={press(onPress)}
      className={`cut-corners-sm focus-inset flex h-12 items-center justify-center gap-2 border border-bone/15 bg-black/40 px-4 font-cut text-[13px] uppercase tracking-[0.14em] text-bone/85 transition active:scale-[0.98] active:bg-white/10 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={press(onPress)}
      className="focus-bone flex h-12 w-12 items-center justify-center rounded-full text-bone/75 transition active:scale-90 active:bg-white/10"
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 mt-8 flex items-center gap-2.5 font-cut text-[11px] uppercase tracking-[0.3em] text-mist">
      <span aria-hidden className="h-px w-4 bg-blood/80" />
      {children}
    </h2>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-b border-white/[0.06] py-2">
      <div className="min-w-0">
        <div className="text-[15px] text-bone">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-mist">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={press(() => onChange(!value))}
      className="focus-bone flex h-11 w-14 items-center justify-center"
    >
      <span className={`relative block h-7 w-12 rounded-full border transition ${value ? 'border-blood/70 bg-blood/25' : 'border-white/15 bg-white/[0.04]'}`}>
        <span
          className={`absolute top-[2px] h-[22px] w-[22px] rounded-full transition-all ${
            value ? 'left-[22px] bg-bone shadow-[0_0_12px_rgba(255,42,68,0.9)]' : 'left-[2px] bg-mist/80'
          }`}
        />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex border border-white/10 bg-black/30 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={press(() => onChange(o.value))}
          className={`focus-inset h-11 min-w-[52px] px-2.5 font-cut text-[11px] uppercase tracking-[0.08em] transition ${
            o.value === value ? 'bg-blood/20 text-bone shadow-[inset_0_0_0_1px_rgba(255,42,68,0.6)]' : 'text-mist'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const id = useId();
  return (
    <div className="w-28">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={() => audio3.sfx('ui')}
        className="slider slider-blood focus-bone"
        style={{ ['--fill' as string]: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

export function ScreenHeader({ title, onBack, backLabel }: { title: string; onBack: () => void; backLabel: string }) {
  return (
    <header className="safe-top safe-x relative z-10 flex items-center gap-1 pb-2">
      <div className="-ml-3">
        <IconButton label={backLabel} onPress={onBack}>
          <BackGlyph />
        </IconButton>
      </div>
      <h1 className="font-cut text-[18px] uppercase tracking-[0.18em] text-bone">{title}</h1>
    </header>
  );
}

/** Tiny provenance label ("Gemini", "voice bank", "local"). */
export function SourceTag({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 border px-1.5 py-[1px] text-[10px] tracking-[0.06em] ${live ? 'border-blood/50 text-bone/80' : 'border-white/12 text-mist'}`}>
      <span aria-hidden className={`h-1 w-1 rounded-full ${live ? 'bg-blood' : 'bg-mist/70'}`} />
      {children}
    </span>
  );
}

/** Two-step destructive action: first press asks, second press does it. */
export function DangerConfirm({ label, confirmLabel, cancelLabel, onConfirm }: { label: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <div className="grid grid-cols-2 gap-2">
      <GhostButton
        className="border-blood/60 text-blood"
        onPress={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </GhostButton>
      <GhostButton onPress={() => setAsking(false)}>{cancelLabel}</GhostButton>
    </div>
  ) : (
    <GhostButton className="w-full" onPress={() => setAsking(true)}>
      {label}
    </GhostButton>
  );
}

function BackGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
