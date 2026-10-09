import { useEffect, useState } from 'react';
import { audio } from '@/audio/AudioEngine';
import { useT } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Backdrop } from '../Backdrop';

export function TitleScreen() {
  const t = useT();
  const firstRunDone = useSettings((s) => s.firstRunDone);
  const loaded = useApp((s) => s.loaded);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 900);
    return () => window.clearTimeout(id);
  }, []);

  const begin = () => {
    if (!loaded) return;
    audio.unlock();
    audio.sfx('ui');
    // First launch: no menus — straight into the awakening (unless there is a run to continue).
    if (!firstRunDone && !useApp.getState().checkpoint) useApp.getState().startMission(false);
    else useApp.getState().go('hub');
  };

  return (
    <button
      type="button"
      onClick={begin}
      aria-label={t('title.tap')}
      className="app-height relative flex w-full flex-col items-center justify-center overflow-hidden text-left"
    >
      <Backdrop />
      <div className="relative z-10 -mt-[18vh] flex flex-col items-center px-8 text-center">
        <div className="anim-glitch font-display text-[46px] font-extrabold leading-none tracking-[0.06em] text-bone glow-bone sm:text-[56px]">
          UNKNOWN
        </div>
        <div className="anim-rise mt-3 font-display text-[13px] font-medium tracking-cine text-blood glow-blood" style={{ animationDelay: '0.35s' }}>
          ASCENSION
        </div>
        <p className="anim-rise mt-10 max-w-[18rem] text-[14px] leading-relaxed text-bone/60" style={{ animationDelay: '0.7s' }}>
          {t('title.sub')}
        </p>
      </div>
      <div className="safe-bottom absolute inset-x-0 bottom-0 z-10 flex flex-col items-center pb-10">
        <div className={`h-12 w-px bg-gradient-to-b from-transparent to-volt/70 transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`} />
        <div
          className={`mt-4 text-[12px] uppercase tracking-[0.34em] text-bone/80 transition-opacity duration-700 ${ready && loaded ? 'anim-pulse opacity-100' : 'opacity-0'}`}
        >
          {t('title.tap')}
        </div>
      </div>
    </button>
  );
}
