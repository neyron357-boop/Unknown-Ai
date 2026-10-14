import { useEffect, useState } from 'react';
import { useApp } from '@/state/app';
import { useHud3 } from '@/state/hud3';
import { useSettings } from '@/state/settings';
import { useBT, type BattleKey } from '@/i18n/battle';
import type { Dir } from '@/game/v3/core/types';
import { IconPause } from '../icons';
import './hud3.css';

const ARROW: Record<Dir, string> = { left: '←', right: '→', up: '↑', down: '↓' };

/**
 * The v3 battle HUD: everything sits on the edges so the eyes stay on the fight. Thin bars,
 * no panels; the big moments (act titles, cut-ins, the fake crash) take over for a second.
 */
export function Hud3({ onPause }: { onPause: () => void }) {
  const flags = useHud3((s) => s.flags);
  const complete = useHud3((s) => s.complete);
  return (
    <div
      className={`pointer-events-none absolute inset-0 select-none overflow-hidden transition-opacity duration-700 ${flags.hudCut ? 'hud-cut' : ''} ${flags.glitch ? 'hud-glitch' : ''} ${complete ? 'opacity-0' : ''}`}
    >
      {flags.bloodlust && <div className="hud-lust absolute inset-0" />}
      <HitFlash />
      <TopBar onPause={onPause} />
      <BossBar />
      <SavedToast />
      <ActCard />
      <CutIn />
      <Hint />
      <Subtitle />
      <Reboot />
      {flags.fakeCrash && <FakeCrash />}
    </div>
  );
}

function TopBar({ onPause }: { onPause: () => void }) {
  const t = useBT();
  const m = useHud3((s) => s.meters);
  const hit = useHud3((s) => s.hit);
  const [trail, setTrail] = useState(m.hp);
  useEffect(() => {
    const id = window.setTimeout(() => setTrail(m.hp), 420);
    return () => window.clearTimeout(id);
  }, [m.hp]);
  const low = m.hp < 35;
  return (
    <div className="hud-edges safe-top safe-x absolute inset-x-0 top-0">
      <div className="flex items-start gap-3 pt-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div key={hit?.id ?? 0} className={`relative h-[9px] w-[132px] skew-x-[-20deg] border border-bone/40 bg-black/60 ${hit ? 'hud-shake' : ''}`}>
              <div className="absolute inset-y-0 left-0 bg-bone/70 transition-[width] duration-500" style={{ width: `${Math.max(0, trail)}%` }} />
              <div
                className={`absolute inset-y-0 left-0 transition-[width] duration-100 ${low ? 'anim-pulse bg-blood' : 'bg-[#e0102a]'}`}
                style={{ width: `${Math.max(0, m.hp)}%`, boxShadow: '0 0 10px rgba(255,20,40,0.7)' }}
              />
            </div>
            <span className={`hud-font-num text-[13px] ${low ? 'text-blood' : 'text-bone/85'}`}>{Math.max(0, Math.round(m.hp))}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="relative h-[3px] w-[110px] skew-x-[-20deg] bg-white/10">
              <div
                className={`absolute inset-y-0 left-0 transition-[width] duration-200 ${m.bloodlust ? 'bg-blood' : 'bg-blood-deep'}`}
                style={{ width: `${m.bloodlust ? 100 : Math.round(m.rage * 100)}%`, boxShadow: m.bloodlust || m.rage > 0.85 ? '0 0 8px rgba(255,30,50,0.9)' : undefined }}
              />
            </div>
            {m.bloodlust && <span className="hud-font-glitch anim-pulse text-[11px] tracking-[0.12em] text-blood">{t('hud.bloodlust')}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end pt-0.5 text-right">
          <span className="hud-font-num text-[19px] leading-none text-bone [text-shadow:0_2px_8px_rgba(0,0,0,0.9)]">{m.score.toLocaleString('ru-RU')}</span>
          {m.combo >= 3 && (
            <span key={m.mult} className="hud-in mt-1 flex items-baseline gap-1.5">
              <span className="hud-font-num text-[15px] text-blood [text-shadow:0_0_10px_rgba(255,30,50,0.8)]">×{m.mult}</span>
              <span className="hud-font-num text-[11px] text-bone/70">
                {m.combo} {t('hud.combo')}
              </span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onPause}
          aria-label="Pause"
          className="pointer-events-auto -mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-bone/70 active:bg-white/10"
        >
          <IconPause />
        </button>
      </div>
    </div>
  );
}

function BossBar() {
  const t = useBT();
  const boss = useHud3((s) => s.boss);
  const hp = useHud3((s) => s.meters.bossHp);
  const posture = useHud3((s) => s.meters.posture);
  const [trail, setTrail] = useState(hp ?? 1);
  useEffect(() => {
    const id = window.setTimeout(() => setTrail(hp ?? 1), 500);
    return () => window.clearTimeout(id);
  }, [hp]);
  if (!boss) return null;
  return (
    <div className="hud-edges hud-in absolute inset-x-0 top-[calc(var(--sat)+64px)] px-6">
      <div className="flex items-baseline justify-between">
        <span className="hud-font-glitch text-[17px] tracking-[0.18em] text-blood [text-shadow:0_0_12px_rgba(255,20,40,0.7)]">{t('hud.boss')}</span>
        <span className="text-[9px] uppercase tracking-[0.3em] text-bone/45">{t('hud.bossTag')}</span>
      </div>
      <div className="relative mt-1 h-[6px] bg-black/70 ring-1 ring-blood/40">
        <div className="absolute inset-y-0 left-0 bg-bone/60 transition-[width] duration-500" style={{ width: `${(trail ?? 1) * 100}%` }} />
        <div className="absolute inset-y-0 left-0 bg-[#c8001c] transition-[width] duration-150" style={{ width: `${(hp ?? 1) * 100}%`, boxShadow: '0 0 12px rgba(255,0,30,0.6)' }} />
      </div>
      {posture !== null && (
        <div className="mt-1 flex items-center gap-2">
          <div className="relative h-[3px] flex-1 bg-white/10">
            <div className={`absolute inset-y-0 left-0 transition-[width] duration-150 ${posture >= 0.85 ? 'bg-white' : 'bg-bone/60'}`} style={{ width: `${posture * 100}%`, boxShadow: posture >= 0.85 ? '0 0 8px #fff' : undefined }} />
          </div>
          <span className="text-[9px] uppercase tracking-[0.25em] text-bone/50">{t('hud.posture')}</span>
        </div>
      )}
    </div>
  );
}

function ActCard() {
  const t = useBT();
  const act = useHud3((s) => s.act);
  const episode = useApp((s) => s.episode);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!act) return;
    setShown(act.id);
    const id = window.setTimeout(() => setShown(null), 2300);
    return () => window.clearTimeout(id);
  }, [act]);
  if (!act || shown !== act.id) return null;
  return (
    <div key={act.id} className="hud-act absolute inset-x-0 top-[27%] flex flex-col items-center text-center">
      <span className="hud-font-num text-[12px] tracking-[0.6em] text-bone/70">
        {t('act.label')} {act.num}
      </span>
      <span className="hud-font-paint mt-1 text-[58px] leading-none text-[#e3122c] [text-shadow:0_4px_0_#000,0_0_30px_rgba(255,0,30,0.5)]">
        {t(`act.${act.key}` as BattleKey)}
      </span>
      {act.num === 'I' && episode?.title && <span className="mt-3 max-w-[80%] text-[12px] uppercase tracking-[0.28em] text-bone/60">{episode.title}</span>}
    </div>
  );
}

function CutIn() {
  const t = useBT();
  const c = useHud3((s) => s.cutIn);
  if (!c) return null;
  const left = c.side === 'left';
  const tag = c.who === 'verdict' ? t('hud.bossTag') : c.who === 'butcher' ? t('hud.minibossTag') : t('hud.cameo');
  return (
    <div key={c.id} className={`absolute top-[19%] ${left ? 'left-0 hud-cutin-left' : 'right-0 hud-cutin-right'} w-[86%]`}>
      <div className={`relative bg-black/90 py-3 ${left ? 'pl-6 pr-4 text-left' : 'pl-4 pr-6 text-right'}`} style={{ boxShadow: '0 0 0 1px rgba(255,40,60,0.35), 0 10px 30px rgba(0,0,0,0.8)' }}>
        <div className={`absolute inset-y-0 ${left ? 'left-0' : 'right-0'} w-[6px] bg-blood`} />
        <div className="text-[10px] uppercase tracking-[0.5em] text-blood">{tag}</div>
        <div className="hud-font-glitch text-[30px] leading-tight text-bone [text-shadow:2px_0_#ff2a44,-2px_0_#39d5ff]">{c.name}</div>
      </div>
    </div>
  );
}

function Hint() {
  const t = useBT();
  const hint = useHud3((s) => s.hint);
  const hints = useSettings((s) => s.hints);
  if (!hint || !hints) return null;
  const key = `hint.${hint.kind}` as BattleKey;
  return (
    <div key={hint.id} className="hud-in absolute inset-x-0 bottom-[calc(var(--sab)+128px)] flex justify-center px-6">
      <div className="flex items-center gap-3 bg-black/75 px-4 py-2 ring-1 ring-white/10">
        {hint.dir && <span className="hud-font-num text-[22px] leading-none text-blood">{ARROW[hint.dir]}</span>}
        <span className="text-[13px] font-semibold tracking-[0.04em] text-bone">{t(key)}</span>
      </div>
    </div>
  );
}

function Subtitle() {
  const t = useBT();
  const sub = useHud3((s) => s.subtitle);
  const lang = useSettings((s) => s.lang);
  const [visible, setVisible] = useState<number | null>(null);
  useEffect(() => {
    if (!sub) return;
    setVisible(sub.id);
    const id = window.setTimeout(() => setVisible(null), sub.durMs + 700);
    return () => window.clearTimeout(id);
  }, [sub]);
  if (!sub || visible !== sub.id) return null;
  const who = t(`speaker.${sub.speaker}` as BattleKey);
  const color = sub.speaker === 'verdict' ? 'text-blood' : sub.speaker === 'echo' ? 'text-[#9fd8ff]' : 'text-[#ffb070]';
  const text = lang === 'en' ? sub.en : sub.ru;
  return (
    <div key={sub.id} className="hud-in absolute inset-x-0 bottom-[calc(var(--sab)+40px)] flex justify-center px-5">
      <div className="max-w-[92%] text-center [text-shadow:0_2px_6px_#000,0_0_2px_#000]">
        {who && <div className={`text-[10px] font-bold uppercase tracking-[0.38em] ${color}`}>{who}</div>}
        <div className={`mt-0.5 text-[16px] font-medium leading-snug text-bone ${sub.speaker === 'narrator' ? 'italic text-bone/85' : ''}`}>{text}</div>
      </div>
    </div>
  );
}

function HitFlash() {
  const hit = useHud3((s) => s.hit);
  const flashes = useSettings((s) => s.flashes);
  if (!hit || flashes === 'off') return null;
  return <div key={hit.id} className="hud-hit absolute inset-0" style={flashes === 'low' ? { opacity: 0.5 } : undefined} />;
}

function SavedToast() {
  const t = useBT();
  const saved = useHud3((s) => s.saved);
  if (!saved) return null;
  return (
    <div key={saved.id} className="hud-toast absolute inset-x-0 top-[calc(var(--sat)+52px)] flex justify-center">
      <span className="hud-font-num bg-black/70 px-3 py-1 text-[10px] tracking-[0.35em] text-bone/80">✓ {t('hud.saved')}</span>
    </div>
  );
}

function Reboot() {
  const t = useBT();
  const r = useHud3((s) => s.reboot);
  if (!r) return null;
  return (
    <div key={r.id} className="anim-fade absolute inset-0 flex flex-col items-center justify-center bg-[#2a0006]/70">
      <div className="hud-font-glitch text-[34px] tracking-[0.12em] text-blood [text-shadow:3px_0_#39d5ff,-3px_0_#ff2a44]">{t('hud.reboot')}</div>
      <div className="mt-2 text-[12px] tracking-[0.2em] text-bone/70">{t('hud.rebootSub')}</div>
      <div className="mt-5 h-[3px] w-48 bg-white/10">
        <div className="hud-bar-fill h-full bg-blood" style={{ animationDuration: `${r.ms}ms` }} />
      </div>
    </div>
  );
}

/** A 4th-wall break: the game "hangs" for a moment — then VERDICT is still there. */
function FakeCrash() {
  const t = useBT();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-grayscale">
      <div className="w-[78%] max-w-[300px] bg-[#e9e9ee] text-[#1b1b1f] shadow-2xl">
        <div className="px-5 pt-5 text-[15px] font-semibold leading-snug">{t('crash.title')}</div>
        <div className="px-5 pb-4 pt-2 text-[12px] leading-snug text-[#55555c]">{t('crash.body')}</div>
        <div className="grid grid-cols-2 border-t border-black/10 text-[14px] text-[#2a5bd7]">
          <div className="py-3 text-center">{t('crash.wait')}</div>
          <div className="border-l border-black/10 py-3 text-center font-semibold">{t('crash.close')}</div>
        </div>
      </div>
    </div>
  );
}
