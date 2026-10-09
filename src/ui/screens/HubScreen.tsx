import { useEffect } from 'react';
import { logChoice } from '@/cognitive/storage';
import type { ModeId } from '@/game/core/types';
import { useT, type StringKey } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Backdrop, Emblem } from '../Backdrop';
import { IconCalm, IconChart, IconFlow, IconGear, IconPlay, IconRestart, IconSpark } from '../icons';
import { GhostButton, IconButton, PrimaryButton } from '../primitives';

const MODES: { id: ModeId; Icon: typeof IconSpark }[] = [
  { id: 'spark', Icon: IconSpark },
  { id: 'flow', Icon: IconFlow },
  { id: 'calm', Icon: IconCalm },
];

export function HubScreen() {
  const t = useT();
  const mode = useSettings((s) => s.mode);
  const setSetting = useSettings((s) => s.set);
  const { checkpoint, runs, go, startMission, discardCheckpoint } = useApp();

  useEffect(() => {
    void useApp.getState().refreshAi();
  }, []);

  const pickMode = (m: ModeId) => {
    if (m === mode) return;
    setSetting('mode', m);
    setSetting('modeChosen', true);
    void logChoice({ at: Date.now(), kind: 'modeSelected', mode: m }).catch(() => undefined);
  };

  const canResume = checkpoint && checkpoint.mode === mode;
  const resumeStage = (checkpoint?.round ?? 0) + 1;
  const order = ['C', 'B', 'A', 'S'];
  const bestGrade = runs.reduce<string | null>((m, r) => (!m || order.indexOf(r.result.grade) > order.indexOf(m) ? r.result.grade : m), null);

  return (
    <div className="app-height relative flex flex-col overflow-hidden">
      <Backdrop />
      <header className="safe-top safe-x relative z-10 flex items-center justify-between">
        <div className="font-display text-[13px] font-bold tracking-[0.3em] text-bone/90">UNKNOWN</div>
        <div className="flex">
          <IconButton label={t('nav.stats')} onPress={() => go('stats')}>
            <IconChart />
          </IconButton>
          <IconButton label={t('nav.settings')} onPress={() => go('settings')}>
            <IconGear />
          </IconButton>
        </div>
      </header>

      <main className="safe-x relative z-10 flex flex-1 flex-col items-center justify-center text-center">
        <div className="anim-fade relative">
          <Emblem size={210} />
        </div>
        <div className="anim-rise mt-6 text-[11px] uppercase tracking-[0.4em] text-blood">{t('hub.mission')}</div>
        <h1 className="anim-rise mt-2 font-display text-[30px] font-bold tracking-[0.12em] text-bone glow-bone" style={{ animationDelay: '0.1s' }}>
          {t('hub.awakening')}
        </h1>
        <div className="anim-rise mt-2 text-[12px] tracking-[0.2em] text-mist" style={{ animationDelay: '0.2s' }}>
          {t('hub.duration')}
          {bestGrade && (
            <span className="ml-3 text-bone/60">
              · {t('hub.best')} <span className="font-display text-bone">{bestGrade}</span>
            </span>
          )}
        </div>
      </main>

      <section className="safe-x safe-bottom relative z-10 pb-4">
        <div role="radiogroup" aria-label={t('hub.mode')} className="mb-4 grid grid-cols-3 gap-2">
          {MODES.map(({ id, Icon }) => {
            const on = id === mode;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pickMode(id)}
                className={`flex h-[76px] flex-col items-center justify-center gap-1 border transition active:scale-[0.97] ${
                  on ? 'border-volt/60 bg-volt/10 text-bone shadow-[0_0_20px_rgba(57,213,255,0.18)]' : 'border-white/10 bg-white/[0.02] text-mist'
                }`}
              >
                <Icon size={20} className={on ? 'text-volt' : ''} />
                <span className="font-display text-[11px] font-semibold tracking-[0.2em]">{t(`mode.${id}` as StringKey)}</span>
                <span className="text-[10px] opacity-70">{t(`mode.${id}.d` as StringKey)}</span>
              </button>
            );
          })}
        </div>
        {canResume ? (
          <div className="flex gap-2">
            <PrimaryButton onPress={() => startMission(true)} className="flex-1">
              <IconPlay size={16} />
              {t('hub.continue')}
              <span className="text-[11px] tracking-[0.1em] text-mist normal-case">
                {t('hub.fromStage')} {resumeStage}
              </span>
            </PrimaryButton>
            <GhostButton
              aria-label={t('hub.restart')}
              onPress={() => {
                void discardCheckpoint();
                startMission(false);
              }}
              className="h-16 w-16 shrink-0 px-0"
            >
              <IconRestart />
            </GhostButton>
          </div>
        ) : (
          <PrimaryButton onPress={() => startMission(false)}>
            <IconPlay size={16} />
            {t('hub.play')}
          </PrimaryButton>
        )}
      </section>
    </div>
  );
}
