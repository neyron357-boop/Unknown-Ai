import { useEffect, useState } from 'react';
import { audio3, unlockAudio } from '@/audio/bus';
import { useT } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings, type Lang } from '@/state/settings';
import { Backdrop } from '../Backdrop';
import { GhostButton, PrimaryButton } from '../primitives';

/**
 * First screen. Until the player confirms they are 18+, it is a stark, static content warning
 * (no strobe, no motion, no sound). After that: the title card — one tap and you are in
 * (the very first launch goes straight into the fight).
 */
export function TitleScreen() {
  const adultOk = useSettings((s) => s.adultOk);
  return adultOk ? <TitleCard /> : <AgeGate />;
}

function AgeGate() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const set = useSettings((s) => s.set);
  const [declined, setDeclined] = useState(false);

  const enter = (lessGore: boolean) => {
    // the first real gesture: audio context + voice bank
    unlockAudio();
    if (lessGore) set('gore', 'low');
    set('adultOk', true);
  };

  return (
    <div className="app-height relative flex flex-col overflow-hidden">
      <Backdrop tone="dim" still />
      <header className="safe-top safe-x relative z-10 flex justify-end">
        <LangSwitch value={lang} onChange={(v) => set('lang', v)} />
      </header>

      <main className="safe-x relative z-10 flex flex-1 flex-col justify-center pb-4">
        <div className="font-blood text-[104px] leading-[0.9] text-blood glow-moon" aria-hidden>
          18+
        </div>
        <h1 className="mt-4 font-cut text-[22px] uppercase leading-tight tracking-[0.14em] text-bone">{t('gate.title')}</h1>
        <ul className="mt-6 space-y-2.5 text-[15px] leading-snug text-bone/85">
          {(['gate.violence', 'gate.flashes', 'gate.sound'] as const).map((k) => (
            <li key={k} className="flex gap-3">
              <span aria-hidden className="mt-[9px] h-px w-3 shrink-0 bg-blood" />
              {t(k)}
            </li>
          ))}
        </ul>
        <p className="mt-6 border-l-2 border-blood pl-3 text-[15px] font-semibold leading-snug text-bone">{t('gate.notMedical')}</p>
        <p className="mt-3 text-[12px] leading-relaxed text-mist">{t('gate.tune')}</p>
      </main>

      <footer className="safe-x safe-bottom relative z-10 flex flex-col gap-2 pb-2">
        <PrimaryButton onPress={() => enter(false)}>{t('gate.confirm')}</PrimaryButton>
        <GhostButton onPress={() => enter(true)}>{t('gate.lessGore')}</GhostButton>
        <button
          type="button"
          onClick={() => setDeclined(true)}
          className="focus-bone mx-auto h-11 px-4 text-[13px] text-mist underline decoration-white/20 underline-offset-4"
        >
          {t('gate.notNow')}
        </button>
        <p role="status" className={`min-h-[18px] text-center text-[12px] text-bone/70 ${declined ? '' : 'invisible'}`}>
          {declined ? t('gate.stay') : ''}
        </p>
      </footer>
    </div>
  );
}

/** Silent language switch (the gate must not start audio before consent). */
function LangSwitch({ value, onChange }: { value: Lang; onChange: (v: Lang) => void }) {
  return (
    <div role="radiogroup" aria-label="Язык / Language" className="flex border border-white/10 bg-black/40 p-0.5">
      {(['ru', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          onClick={() => onChange(l)}
          className={`focus-inset h-11 w-12 font-cut text-[12px] tracking-[0.1em] ${value === l ? 'bg-white/10 text-bone' : 'text-mist'}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function TitleCard() {
  const t = useT();
  const firstRunDone = useSettings((s) => s.firstRunDone);
  const loaded = useApp((s) => s.loaded);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 700);
    return () => window.clearTimeout(id);
  }, []);

  const begin = () => {
    if (!loaded) return;
    unlockAudio();
    audio3.sfx('uiConfirm');
    // First launch: no menus — straight into the fight (unless there is a run to continue).
    if (!firstRunDone && !useApp.getState().checkpoint) useApp.getState().startMission(false);
    else useApp.getState().go('hub');
  };

  return (
    <button
      type="button"
      onClick={begin}
      aria-label={t('title.tap')}
      className="app-height relative flex w-full flex-col items-center overflow-hidden text-left focus-visible:outline-none"
    >
      <Backdrop tone="title" />
      <div className="relative z-10 mt-[44vh] flex flex-col items-center px-6 text-center">
        <div className="anim-slash font-cut text-[56px] leading-none tracking-[0.03em] text-bone glow-ash">UNKNOWN</div>
        <div className="mt-3 flex items-center gap-3">
          <span className="anim-blade h-px w-10 bg-blood" style={{ animationDelay: '0.35s' }} />
          <span className="anim-fade font-glitch text-[16px] tracking-[0.42em] text-blood glow-moon" style={{ animationDelay: '0.45s' }}>
            ASCENSION
          </span>
          <span className="anim-blade h-px w-10 bg-blood" style={{ animationDelay: '0.35s' }} />
        </div>
        <p className="anim-whisper mt-8 font-cut text-[15px] uppercase tracking-[0.22em] text-bone/80" style={{ animationDelay: '0.8s' }}>
          {t('title.tagline')}
        </p>
      </div>
      <div className="safe-bottom absolute inset-x-0 bottom-0 z-10 flex flex-col items-center pb-12">
        <div className={`h-12 w-px bg-gradient-to-b from-transparent to-blood transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`} />
        <div
          className={`mt-4 font-cut text-[13px] uppercase tracking-[0.3em] text-bone/90 transition-opacity duration-700 ${ready && loaded ? 'anim-pulse opacity-100' : 'opacity-0'}`}
        >
          {t('title.tap')}
        </div>
      </div>
    </button>
  );
}
