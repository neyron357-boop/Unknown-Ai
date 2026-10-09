import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { audio } from '@/audio/AudioEngine';

/** Every press makes a tiny sound and unlocks audio (safe inside user gestures). */
function press(handler?: () => void) {
  return () => {
    audio.unlock();
    audio.sfx('ui');
    handler?.();
  };
}

export function PrimaryButton({
  children,
  onPress,
  tone = 'volt',
  className = '',
  ...rest
}: { children: ReactNode; onPress?: () => void; tone?: 'volt' | 'blood' } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  const color =
    tone === 'volt'
      ? 'border-volt/70 text-bone shadow-[0_0_24px_rgba(57,213,255,0.25),inset_0_0_24px_rgba(57,213,255,0.12)]'
      : 'border-blood/70 text-bone shadow-[0_0_24px_rgba(255,42,68,0.25),inset_0_0_24px_rgba(255,42,68,0.12)]';
  return (
    <button
      type="button"
      onClick={press(onPress)}
      className={`relative h-16 w-full overflow-hidden rounded-[2px] border bg-black/40 font-display text-[15px] font-semibold uppercase tracking-[0.28em] transition active:scale-[0.98] active:bg-white/5 ${color} ${className}`}
      {...rest}
    >
      <span className="relative z-10 flex items-center justify-center gap-3">{children}</span>
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent [animation:sheen_3.2s_ease-in-out_infinite]" />
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
      className={`flex h-12 items-center justify-center gap-2 rounded-[2px] border border-white/10 bg-white/[0.03] px-4 text-[13px] font-medium tracking-[0.12em] text-bone/80 uppercase transition active:scale-[0.98] active:bg-white/10 ${className}`}
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
      className="flex h-12 w-12 items-center justify-center rounded-full text-bone/70 transition active:scale-90 active:bg-white/10"
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-7 text-[11px] font-semibold uppercase tracking-[0.3em] text-mist">{children}</h2>;
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-white/[0.06] py-2">
      <div className="min-w-0">
        <div className="text-[15px] text-bone">{label}</div>
        {hint && <div className="text-[12px] text-mist">{hint}</div>}
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
      className={`relative h-8 w-14 rounded-full border transition ${value ? 'border-volt/60 bg-volt/20' : 'border-white/15 bg-white/5'}`}
    >
      <span
        className={`absolute top-1 h-[22px] w-[22px] rounded-full transition-all ${value ? 'left-7 bg-volt shadow-[0_0_12px_rgba(57,213,255,0.8)]' : 'left-1 bg-mist'}`}
      />
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
    <div role="radiogroup" aria-label={label} className="flex rounded-[2px] border border-white/10 bg-white/[0.03] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={press(() => onChange(o.value))}
          className={`h-9 min-w-14 px-3 text-[12px] font-medium uppercase tracking-[0.08em] transition ${
            o.value === value ? 'bg-volt/20 text-bone shadow-[inset_0_0_0_1px_rgba(57,213,255,0.5)]' : 'text-mist'
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
    <div className="w-36">
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
        onPointerUp={() => audio.sfx('ui')}
        className="slider"
        style={{ ['--fill' as string]: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

export function ScreenHeader({ title, onBack, backLabel }: { title: string; onBack: () => void; backLabel: string }) {
  return (
    <header className="safe-top safe-x flex items-center gap-2 pb-2">
      <IconButton label={backLabel} onPress={onBack}>
        <BackGlyph />
      </IconButton>
      <h1 className="font-display text-[18px] font-semibold uppercase tracking-[0.2em]">{title}</h1>
    </header>
  );
}

function BackGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
