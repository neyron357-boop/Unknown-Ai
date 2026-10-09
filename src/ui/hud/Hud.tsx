import { useEffect, useRef, useState } from 'react';
import type { EchoLineId } from '@/game/core/director';
import type { Action, RoundKind, UpgradeId } from '@/game/core/types';
import { useT, type StringKey } from '@/i18n/strings';
import { useHud, type CallKind } from '@/state/hud';
import { useSettings } from '@/state/settings';
import { IconPause } from '../icons';

/** Lines that explain a mechanic are always shown; flavour lines follow the "ECHO comments" setting. */
const ESSENTIAL_ECHO = new Set<EchoLineId>(['takt', 'taktBlind', 'phantoms', 'phantomSubtle', 'overcharge', 'ascend']);
const ROUNDS: RoundKind[] = ['takt', 'phantoms', 'overcharge', 'ascension'];

const CALL_STYLE: Record<CallKind, string> = {
  perfect: 'text-volt glow-volt text-[34px]',
  good: 'text-bone glow-bone text-[24px]',
  miss: 'text-blood glow-blood text-[26px]',
  wrong: 'text-blood glow-blood text-[20px]',
  fooled: 'text-blood glow-blood text-[28px]',
  ignored: 'hidden',
  early: 'text-mist text-[15px]',
  onBeat: 'text-[#ffd27a] [text-shadow:0_0_14px_rgba(255,210,122,0.8)] text-[22px]',
  offBeat: 'text-bone/70 text-[16px]',
  orbGood: 'text-[#ffd27a] [text-shadow:0_0_14px_rgba(255,210,122,0.8)] text-[24px]',
  orbBad: 'text-blood glow-blood text-[22px]',
  runeGood: 'text-volt glow-volt text-[26px]',
  runeBad: 'text-blood glow-blood text-[22px]',
  clash: 'text-[#ffd27a] [text-shadow:0_0_18px_rgba(255,210,122,0.9)] text-[30px]',
  shielded: 'text-volt/80 text-[18px]',
};

export function Hud({ onPause, onPick }: { onPause: () => void; onPick: (id: UpgradeId) => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <TopBar onPause={onPause} />
      <IntroCard />
      <Directive />
      <Combo />
      <Call />
      <Guide />
      <RebootOverlay />
      <BottomBar />
      <UpgradePicker onPick={onPick} />
    </div>
  );
}

function TopBar({ onPause }: { onPause: () => void }) {
  const t = useT();
  const round = useHud((s) => s.round);
  const hp = useHud((s) => s.meters.enemyHp);
  const score = useHud((s) => s.meters.score);
  const [trail, setTrail] = useState(hp);
  useEffect(() => {
    const id = window.setTimeout(() => setTrail(hp), 450);
    return () => window.clearTimeout(id);
  }, [hp]);
  return (
    <div className="safe-top safe-x absolute inset-x-0 top-0">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex gap-1.5" aria-hidden>
            {ROUNDS.map((r, i) => (
              <span
                key={r}
                className={`h-1.5 w-5 skew-x-[-20deg] transition-colors ${round && i < round.index ? 'bg-volt/70' : round && i === round.index ? 'bg-bone shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'bg-white/15'}`}
              />
            ))}
          </div>
          <span className="truncate font-display text-[10px] tracking-[0.28em] text-bone/80">{round ? t(`round.${round.kind}` as StringKey) : ''}</span>
        </div>
        <span className="font-display text-[12px] tabular-nums tracking-[0.08em] text-bone/70">{score}</span>
        <button
          type="button"
          onClick={onPause}
          aria-label={t('pause.title')}
          className="pointer-events-auto -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-bone/70 active:bg-white/10"
        >
          <IconPause />
        </button>
      </div>
      <div className="mt-1">
        <div className="mb-1 flex items-baseline justify-between text-[9px] uppercase tracking-[0.34em] text-blood/90">
          <span>{t('hud.enemy')}</span>
          <span className="tabular-nums text-blood/60">{Math.max(0, Math.round(hp / 10))}%</span>
        </div>
        <div className="relative h-[6px] w-full skew-x-[-20deg] overflow-hidden bg-blood/15">
          <div className="absolute inset-y-0 left-0 bg-white/70 transition-[width] duration-500 ease-out" style={{ width: `${trail / 10}%` }} />
          <div className="absolute inset-y-0 left-0 bg-blood shadow-[0_0_12px_rgba(255,42,68,1)] transition-[width] duration-150" style={{ width: `${hp / 10}%` }} />
        </div>
      </div>
    </div>
  );
}

function IntroCard() {
  const t = useT();
  const intro = useHud((s) => s.intro);
  const phase = useHud((s) => s.phase);
  if (!intro || phase !== 'intro') return null;
  return (
    <div key={intro.id} className="anim-card absolute left-[7%] top-[16%] [animation-delay:0.6s] [animation-duration:3s]">
      <div className="font-display text-[30px] font-extrabold tracking-[0.16em] text-blood glow-blood">{t('hud.enemy')}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.26em] text-bone/70">{t('hud.enemySub')}</div>
    </div>
  );
}

function Legend({ kind }: { kind: RoundKind }) {
  const t = useT();
  if (kind === 'overcharge') {
    return (
      <div className="mt-3 flex items-center justify-center gap-3 text-[12px] text-bone/80">
        <span className="font-display text-[#ffd27a]">‹ ›</span>
        <span>{t('legend.side')}</span>
      </div>
    );
  }
  if (kind === 'ascension') return null;
  const items: [string, string, StringKey][] = [
    ['◆', 'text-volt', 'legend.tap'],
    ['▼', 'text-[#ffc65a]', 'legend.down'],
    ['▲', 'text-[#c58bff]', 'legend.up'],
  ];
  const shown = kind === 'phantoms' ? items.filter((i) => i[2] !== 'legend.down') : items.filter((i) => i[2] !== 'legend.up');
  return (
    <div className="mt-3 flex items-center justify-center gap-4 text-[12px] text-bone/80">
      {shown.map(([g, c, k]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={`${c} text-[14px]`}>{g}</span>
          {t(k)}
        </span>
      ))}
    </div>
  );
}

function Directive() {
  const t = useT();
  const d = useHud((s) => s.directive);
  const round = useHud((s) => s.round);
  if (!d) return null;
  return (
    <div key={d.id} className="anim-card absolute inset-x-0 top-[24%] flex flex-col items-center px-6 text-center [animation-duration:2.6s]">
      <div className="h-px w-44 bg-gradient-to-r from-transparent via-bone/60 to-transparent" />
      <div className="mt-3 font-display text-[11px] tracking-[0.5em] text-mist">
        0{(round?.index ?? 0) + 1} / 04
      </div>
      <div className="mt-1 font-display text-[28px] font-extrabold tracking-[0.18em] text-bone glow-bone">{t(`round.${d.kind}` as StringKey)}</div>
      <div className="mt-2 max-w-[19rem] text-[14px] leading-snug text-bone/85 [text-shadow:0_1px_10px_rgba(0,0,0,0.9)]">{t(`goal.${d.kind}` as StringKey)}</div>
      <Legend kind={d.kind} />
      <div className="mt-3 h-px w-44 bg-gradient-to-r from-transparent via-bone/60 to-transparent" />
    </div>
  );
}

function Combo() {
  const t = useT();
  const combo = useHud((s) => s.meters.combo);
  const hype = useHud((s) => s.meters.hype);
  if (combo < 3) return null;
  return (
    <div className="absolute right-[5%] top-[15.5%] flex flex-col items-end">
      <div key={combo} className="anim-pop font-display text-[40px] font-extrabold leading-none tabular-nums text-bone [text-shadow:0_0_18px_rgba(57,213,255,0.7)]">
        {combo}
      </div>
      <div className="mt-1 font-display text-[9px] tracking-[0.4em] text-volt">{t('hud.combo')}</div>
      <div className="mt-1.5 flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1 w-3 skew-x-[-20deg] ${i <= hype ? 'bg-volt shadow-[0_0_6px_rgba(57,213,255,0.9)]' : 'bg-white/15'}`} />
        ))}
      </div>
    </div>
  );
}

function Call() {
  const t = useT();
  const c = useHud((s) => s.call);
  if (!c || c.kind === 'ignored') return null;
  return (
    <div key={c.id} className="absolute inset-x-0 top-[38%] flex flex-col items-center">
      <div className={`anim-punch font-display font-extrabold uppercase ${CALL_STYLE[c.kind]}`}>{t(`call.${c.kind}` as StringKey)}</div>
    </div>
  );
}

function GestureGlyph({ action }: { action: Action }) {
  if (action === 'tap') {
    return (
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="anim-ripple absolute inset-0 rounded-full border-2 border-volt/80" />
        <span className="anim-tap h-6 w-6 rounded-full bg-volt/85 shadow-[0_0_18px_rgba(57,213,255,0.9)]" />
      </div>
    );
  }
  const up = action === 'up';
  return (
    <div className="relative flex h-14 w-14 items-center justify-center overflow-visible">
      <div className={`${up ? 'anim-swipe-u' : 'anim-swipe-d'} flex flex-col items-center`}>
        <span className={`h-6 w-6 rounded-full ${up ? 'bg-[#c58bff]' : 'bg-[#ffc65a]'} shadow-[0_0_18px_rgba(255,255,255,0.5)]`} />
      </div>
      <span className={`absolute text-[20px] ${up ? '-top-3 text-[#c58bff]' : '-bottom-3 text-[#ffc65a]'}`}>{up ? '▲' : '▼'}</span>
    </div>
  );
}

function Guide() {
  const t = useT();
  const hint = useHud((s) => s.hint);
  const prompt = useHud((s) => s.prompt);
  const recall = useHud((s) => s.recall);
  if (hint) {
    const label: StringKey = hint.action === 'tap' ? 'legend.tap' : hint.action === 'down' ? 'legend.down' : 'legend.up';
    return (
      <div key={hint.id} className="anim-rise absolute inset-x-0 top-[62.5%] flex flex-col items-center gap-1">
        <GestureGlyph action={hint.action} />
        <div className="text-[11px] uppercase tracking-[0.3em] text-bone/90 [text-shadow:0_1px_8px_rgba(0,0,0,0.9)]">{t(label)}</div>
      </div>
    );
  }
  if (!prompt) return null;
  const key: StringKey = `prompt.${prompt}` as StringKey;
  const tone = prompt === 'strike' || prompt === 'orbs' ? 'text-[#ffd27a] [text-shadow:0_0_14px_rgba(255,210,122,0.7)]' : 'text-volt glow-volt';
  const top = prompt === 'recall' || prompt === 'watch' ? 'top-[66%]' : prompt === 'orbs' ? 'top-[61.5%]' : 'top-[74.2%]';
  return (
    <div key={prompt} className={`anim-rise absolute inset-x-0 ${top} flex flex-col items-center gap-2`}>
      <div className={`font-display text-[12px] tracking-[0.34em] ${tone}`}>{t(key)}</div>
      {prompt === 'recall' && recall && (
        <div className="flex gap-2">
          {Array.from({ length: recall.points }, (_, i) => (
            <span key={i} className={`h-2 w-2 rotate-45 border ${i < recall.tapped ? 'border-volt bg-volt shadow-[0_0_8px_rgba(57,213,255,0.9)]' : 'border-volt/50'}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function RebootOverlay() {
  const t = useT();
  const rebooting = useHud((s) => s.rebooting);
  if (!rebooting) return null;
  return (
    <div className="anim-glitch absolute inset-x-0 top-[44%] text-center font-display text-[18px] font-bold tracking-[0.4em] text-bone/90">
      {t('echo.reboot').split('.')[0].toUpperCase()}
    </div>
  );
}

function EchoLine() {
  const t = useT();
  const echo = useHud((s) => s.echo);
  const mentor = useSettings((s) => s.mentor);
  const [visible, setVisible] = useState<{ id: number; text: string } | null>(null);
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    if (!echo) return;
    if (!mentor && !ESSENTIAL_ECHO.has(echo.line)) return;
    const text = t(`echo.${echo.line}` as StringKey);
    setVisible({ id: echo.id, text });
    setTyped(0);
    const typer = window.setInterval(() => setTyped((n) => (n >= text.length ? n : n + 1)), 20);
    const hide = window.setTimeout(() => setVisible((v) => (v?.id === echo.id ? null : v)), 1800 + text.length * 40);
    return () => {
      window.clearInterval(typer);
      window.clearTimeout(hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [echo?.id]);
  if (!visible) return <div className="h-5" />;
  return (
    <div key={visible.id} className="anim-fade flex min-h-5 items-start gap-2 text-[13px] leading-snug">
      <span className="mt-[3px] shrink-0 font-display text-[9px] tracking-[0.3em] text-volt">{t('echo.name')}</span>
      <span className="text-bone/90 [text-shadow:0_1px_8px_rgba(0,0,0,0.9)]">
        {visible.text.slice(0, typed)}
        <span className="text-transparent">{visible.text.slice(typed)}</span>
      </span>
    </div>
  );
}

function BottomBar() {
  const t = useT();
  const integrity = useHud((s) => s.meters.integrity);
  const phase = useHud((s) => s.phase);
  return (
    <div className="safe-bottom safe-x absolute inset-x-0 bottom-0 flex flex-col gap-2.5 pb-2">
      <EchoLine />
      <div className={`transition-opacity duration-500 ${phase === 'intro' ? 'opacity-0' : 'opacity-100'}`}>
        <div className="mb-1 flex justify-between text-[9px] uppercase tracking-[0.3em] text-mist">
          <span>{t('hud.integrity')}</span>
          <span className="tabular-nums">{integrity}</span>
        </div>
        <div className="h-[3px] skew-x-[-20deg] bg-volt/15">
          <div
            className={`h-full transition-[width] duration-300 ${integrity <= 30 ? 'bg-blood shadow-[0_0_10px_rgba(255,42,68,0.9)]' : 'bg-volt shadow-[0_0_10px_rgba(57,213,255,0.8)]'}`}
            style={{ width: `${integrity}%` }}
          />
        </div>
      </div>
    </div>
  );
}

const UP_ICON: Record<UpgradeId, string> = {
  resonance: 'M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5',
  foresight: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  secondWind: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4',
  coldMind: 'M12 2v20M4 6l16 12M20 6L4 18',
  bloodRhythm: 'M3 12h3l2-6 4 12 3-9 2 3h4',
  phantomSight: 'M6 20V9a6 6 0 0 1 12 0v11l-3-2-3 2-3-2-3 2zM10 10h.01M14 10h.01',
  overclock: 'M13 2L4 14h7l-1 8 9-12h-7z',
  echoMemory: 'M4 6h16M4 12h10M4 18h6M18 14l3 3-3 3',
  thirst: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z',
};

function UpgradePicker({ onPick }: { onPick: (id: UpgradeId) => void }) {
  const t = useT();
  const offer = useHud((s) => s.offer);
  const [chosen, setChosen] = useState<UpgradeId | null>(null);
  const lastOffer = useRef<UpgradeId[] | null>(null);
  if (offer !== lastOffer.current) {
    lastOffer.current = offer;
    if (chosen) setChosen(null);
  }
  if (!offer) return null;
  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-10 flex flex-col justify-center bg-black/55 px-5 backdrop-blur-[2px]">
      <div className="text-center font-display text-[20px] font-extrabold tracking-[0.24em] text-bone glow-bone">{t('up.title')}</div>
      <div className="mt-1 text-center text-[12px] text-mist">{t('up.sub')}</div>
      <div className="mt-6 flex flex-col gap-3">
        {offer.map((id, i) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (chosen) return;
              setChosen(id);
              window.setTimeout(() => onPick(id), 220);
            }}
            className={`anim-rise flex min-h-[78px] items-center gap-4 border px-4 text-left transition active:scale-[0.98] ${
              chosen === id ? 'border-volt bg-volt/20 shadow-[0_0_30px_rgba(57,213,255,0.4)]' : chosen ? 'border-white/5 bg-white/[0.02] opacity-40' : 'border-white/15 bg-[#0b0d16]/90'
            }`}
            style={{ animationDelay: `${0.08 * i}s` }}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-volt" aria-hidden>
              <path d={UP_ICON[id]} />
            </svg>
            <span className="min-w-0">
              <span className="block font-display text-[14px] font-bold tracking-[0.08em] text-bone">{t(`up.${id}` as StringKey)}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-bone/70">{t(`up.${id}.d` as StringKey)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
