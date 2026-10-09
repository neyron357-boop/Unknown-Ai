import { useEffect, useState } from 'react';
import type { EchoLineId } from '@/game/core/director';
import type { Action, AttackType, StageId } from '@/game/core/types';
import { useT, type StringKey } from '@/i18n/strings';
import { useHud, type FeedbackKind } from '@/state/hud';
import { useSettings } from '@/state/settings';
import { IconPause } from '../icons';

const STAGE_NO: Record<StageId, string> = { awakening: '01', contact: '02', pattern: '03', ascension: '04', evolution: '05' };

/** Lines that explain a mechanic are always shown; flavour lines follow the "ECHO comments" setting. */
const ESSENTIAL_ECHO = new Set<EchoLineId>(['patternIntro', 'newAttack', 'assist']);

const FEEDBACK_STYLE: Record<FeedbackKind, { key: StringKey; cls: string }> = {
  read: { key: 'fb.read', cls: 'text-volt glow-volt text-[34px]' },
  react: { key: 'fb.react', cls: 'text-bone glow-bone text-[24px]' },
  block: { key: 'fb.block', cls: 'text-volt/90 glow-volt text-[24px]' },
  recovered: { key: 'fb.recovered', cls: 'text-bone glow-volt text-[22px]' },
  hit: { key: 'fb.hit', cls: 'text-blood glow-blood text-[26px]' },
  wrong: { key: 'fb.wrong', cls: 'text-blood glow-blood text-[24px]' },
  misread: { key: 'fb.misread', cls: 'text-blood glow-blood text-[24px]' },
  early: { key: 'fb.early', cls: 'text-mist text-[14px]' },
  perfect: { key: 'asc.perfect', cls: 'text-bone glow-volt text-[34px]' },
};

export function Hud({ onPause }: { onPause: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <TopBar onPause={onPause} />
      <StageCard />
      <NameCard />
      <Trace />
      <Feedback />
      <GestureGuide />
      <AscensionPrompt />
      <RebootOverlay />
      <BottomBar />
    </div>
  );
}

function TopBar({ onPause }: { onPause: () => void }) {
  const t = useT();
  const stage = useHud((s) => s.stage);
  const loop = useHud((s) => s.loop);
  const barrier = useHud((s) => s.barrier);
  const showEnemy = stage !== 'awakening' && stage !== 'evolution';
  const stageKey: StringKey = loop === 'overdrive' ? 'stage.overdrive' : (`stage.${stage}` as StringKey);
  return (
    <div className="safe-top safe-x absolute inset-x-0 top-0 flex items-start gap-3">
      <div className="min-w-0 flex-1 pt-3">
        <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-[0.3em] text-mist">
          <span className="font-display text-bone/80">{STAGE_NO[stage]}</span>
          <span className="truncate">{t(stageKey)}</span>
        </div>
        <div className={`mt-2.5 transition-opacity duration-700 ${showEnemy ? 'opacity-100' : 'opacity-0'}`}>
          <div className="mb-1 flex justify-between text-[9px] uppercase tracking-[0.34em] text-blood/90">
            <span>{t('hud.enemy')}</span>
          </div>
          <div className="h-[3px] w-full bg-blood/15">
            <div
              className="h-full bg-blood shadow-[0_0_10px_rgba(255,42,68,0.9)] transition-[width] duration-500 ease-out"
              style={{ width: `${barrier}%` }}
            />
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onPause}
        aria-label={t('pause.title')}
        className="pointer-events-auto -mr-2 flex h-12 w-12 items-center justify-center rounded-full text-bone/70 active:bg-white/10"
      >
        <IconPause />
      </button>
    </div>
  );
}

function StageCard() {
  const t = useT();
  const banner = useHud((s) => s.banner);
  // The Ascension Moment speaks for itself — only its Overdrive phase gets a title card.
  if (!banner || banner.stage === 'evolution' || (banner.stage === 'ascension' && banner.loop !== 'overdrive')) return null;
  const key: StringKey = banner.loop === 'overdrive' ? 'stage.overdrive' : (`stage.${banner.stage}` as StringKey);
  return (
    <div key={banner.id} className="anim-card absolute inset-x-0 top-[38%] flex flex-col items-center">
      <div className="h-px w-40 bg-gradient-to-r from-transparent via-bone/60 to-transparent" />
      <div className="mt-3 font-display text-[11px] tracking-[0.5em] text-mist">{STAGE_NO[banner.stage]}</div>
      <div className={`mt-1 font-display text-[22px] font-bold tracking-[0.24em] ${banner.loop === 'overdrive' ? 'text-blood glow-blood' : 'text-bone glow-bone'}`}>
        {t(key)}
      </div>
      <div className="mt-3 h-px w-40 bg-gradient-to-r from-transparent via-bone/60 to-transparent" />
    </div>
  );
}

function NameCard() {
  const t = useT();
  const cinematic = useHud((s) => s.cinematic);
  const lang = useSettings((s) => s.lang);
  if (!cinematic || cinematic.kind !== 'enemyIntro') return null;
  return (
    <div key={cinematic.id} className="anim-card absolute left-[8%] top-[12%] [animation-delay:0.9s] [animation-duration:2.6s]">
      <div className="font-display text-[26px] font-extrabold tracking-[0.18em] text-blood glow-blood">{t('hud.enemy')}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.28em] text-bone/70">
        {lang === 'ru' ? 'Исполнитель Совета Зенита' : 'Enforcer of the Zenith Council'}
      </div>
    </div>
  );
}

const TRACE_GLYPH: Record<AttackType, string> = { slashL: '◣', slashR: '◢', crush: '▼', pierce: '│' };

function Trace() {
  const trace = useHud((s) => s.trace);
  const depth = useHud((s) => s.traceDepth);
  const ascension = useHud((s) => s.ascension);
  if (depth === 0 || ascension) return null;
  return (
    <div className="absolute inset-x-0 top-[47.5%] flex justify-center gap-2" aria-hidden>
      {Array.from({ length: depth }, (_, k) => {
        const item = trace[k];
        const isLast = k === trace.length - 1;
        return (
          <div
            key={item ? item.id : `empty-${k}`}
            className={`flex h-6 w-6 items-center justify-center border text-[11px] transition ${
              item ? (isLast ? 'border-blood/70 text-blood' : 'border-white/15 text-bone/50') : 'border-white/5 text-transparent'
            }`}
          >
            {item ? TRACE_GLYPH[item.type] : '·'}
          </div>
        );
      })}
      <div className="flex h-6 w-6 items-center justify-center border border-dashed border-volt/40 text-[11px] text-volt/80">?</div>
    </div>
  );
}

function Feedback() {
  const t = useT();
  const fb = useHud((s) => s.feedback);
  const streak = useHud((s) => s.readStreak);
  if (!fb) return null;
  const style = FEEDBACK_STYLE[fb.kind];
  return (
    <div key={fb.id} className="absolute inset-x-0 top-[40%] flex flex-col items-center">
      <div className={`anim-punch font-display font-extrabold uppercase ${style.cls}`}>{t(style.key)}</div>
      {fb.kind === 'read' && streak >= 2 && <div className="anim-punch mt-1 font-display text-[13px] tracking-[0.3em] text-volt/80">×{streak}</div>}
    </div>
  );
}

function GestureGlyph({ action, size = 64 }: { action: Action; size?: number }) {
  if (action === 'block') {
    return (
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <span className="anim-ripple absolute inset-0 rounded-full border-2 border-volt/80" />
        <span className="anim-tap h-7 w-7 rounded-full bg-volt/80 shadow-[0_0_18px_rgba(57,213,255,0.9)]" />
      </div>
    );
  }
  const right = action === 'dodgeR';
  return (
    <div className="relative flex items-center justify-center overflow-visible" style={{ width: size * 1.6, height: size }}>
      <div className="absolute h-px w-full bg-gradient-to-r from-transparent via-volt/40 to-transparent" />
      <div className={`${right ? 'anim-swipe-r' : 'anim-swipe-l'} flex items-center`}>
        <span className="h-6 w-6 rounded-full bg-volt/85 shadow-[0_0_18px_rgba(57,213,255,0.9)]" />
        <span className={`absolute text-[22px] text-volt ${right ? 'left-8' : 'right-8'}`}>{right ? '›' : '‹'}</span>
      </div>
    </div>
  );
}

function GestureGuide() {
  const t = useT();
  const tutorial = useHud((s) => s.tutorial);
  const hint = useHud((s) => s.hint);
  const predict = useHud((s) => s.predictWindow);
  const committed = useHud((s) => s.committed);
  const readStreak = useHud((s) => s.readStreak);
  const stage = useHud((s) => s.stage);
  const [readsSeen, setReadsSeen] = useState(0);

  useEffect(() => {
    if (readStreak > 0) setReadsSeen((n) => n + 1);
  }, [readStreak]);

  if (tutorial && !tutorial.done) {
    const key: StringKey = tutorial.expect === 'block' ? 'tut.block' : tutorial.expect === 'dodgeR' ? 'tut.dodgeR' : 'tut.dodgeL';
    return (
      <div key={`tut-${tutorial.step}`} className="anim-rise absolute inset-x-0 top-[53%] flex flex-col items-center gap-3">
        <GestureGlyph action={tutorial.expect} />
        <div className="text-[12px] uppercase tracking-[0.3em] text-bone/85">{t(key)}</div>
      </div>
    );
  }
  if (hint) {
    return (
      <div className="anim-fade absolute inset-x-0 top-[56%] flex items-center justify-center gap-8">
        {hint.map((a) => (
          <GestureGlyph key={a} action={a} size={52} />
        ))}
      </div>
    );
  }
  // Teach the prediction window until the player has landed a couple of reads.
  if (predict && !committed && readsSeen < 2 && (stage === 'pattern' || stage === 'ascension')) {
    return (
      <div className="anim-fade absolute inset-x-0 top-[83%] flex justify-center">
        <div className="text-[10px] uppercase tracking-[0.34em] text-volt/80">{t('fb.predict')}</div>
      </div>
    );
  }
  return null;
}

function AscensionPrompt() {
  const t = useT();
  const a = useHud((s) => s.ascension);
  if (!a || a.phase === 'trigger' || a.phase === 'strike' || a.phase === 'finisher') return null;
  const recall = a.phase === 'recall';
  return (
    <div className="absolute inset-x-0 top-[33%] flex flex-col items-center gap-2">
      <div key={a.phase} className="anim-rise text-[12px] uppercase tracking-[0.36em] text-volt glow-volt">
        {t(recall ? 'asc.recall' : 'asc.watch')}
      </div>
      {recall && (
        <div className="flex gap-2">
          {Array.from({ length: a.points }, (_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rotate-45 border ${i < a.tapped ? 'border-volt bg-volt shadow-[0_0_8px_rgba(57,213,255,0.9)]' : 'border-volt/50'}`}
            />
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
    const typer = window.setInterval(() => setTyped((n) => (n >= text.length ? n : n + 1)), 22);
    const hide = window.setTimeout(() => setVisible((v) => (v?.id === echo.id ? null : v)), 1600 + text.length * 45);
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
  const integrity = useHud((s) => s.integrity);
  const aura = useHud((s) => s.aura);
  const stage = useHud((s) => s.stage);
  const loop = useHud((s) => s.loop);
  const auraVisible = loop === 'pattern' || loop === 'overdrive';
  const full = aura >= 100;
  return (
    <div className="safe-bottom safe-x absolute inset-x-0 bottom-0 flex flex-col gap-3 pb-3">
      <EchoLine />
      <div className={`flex items-end gap-4 transition-opacity duration-500 ${stage === 'awakening' ? 'opacity-0' : 'opacity-100'}`}>
        <div className="flex-1">
          <div className="mb-1 text-[9px] uppercase tracking-[0.3em] text-mist">{t('hud.integrity')}</div>
          <div className="h-[3px] bg-volt/15">
            <div
              className={`h-full transition-[width] duration-300 ${integrity <= 40 ? 'bg-blood shadow-[0_0_10px_rgba(255,42,68,0.9)]' : 'bg-volt shadow-[0_0_10px_rgba(57,213,255,0.8)]'}`}
              style={{ width: `${integrity}%` }}
            />
          </div>
        </div>
        <div className={`w-[42%] transition-opacity duration-500 ${auraVisible ? 'opacity-100' : 'opacity-25'}`}>
          <div className={`mb-1 text-right text-[9px] uppercase tracking-[0.3em] ${full ? 'text-volt glow-volt' : 'text-mist'}`}>{t('hud.aura')}</div>
          <div className="flex gap-[3px]">
            {Array.from({ length: 10 }, (_, i) => {
              const on = aura >= (i + 1) * 10 - 0.001;
              return (
                <span
                  key={i}
                  className={`h-[5px] flex-1 skew-x-[-20deg] transition ${on ? (full ? 'bg-bone shadow-[0_0_10px_rgba(57,213,255,1)]' : 'bg-volt shadow-[0_0_6px_rgba(57,213,255,0.7)]') : 'bg-white/10'}`}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
