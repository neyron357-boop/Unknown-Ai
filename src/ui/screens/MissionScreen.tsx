import { useCallback, useEffect, useState } from 'react';
import { audio } from '@/audio/AudioEngine';
import { computeAdaptation, type RunSummary } from '@/cognitive/adaptation';
import { clearCheckpoint, logChoice, saveCheckpoint, saveRun } from '@/cognitive/storage';
import type { MissionResult } from '@/game/core/metrics';
import { MissionSession } from '@/game/MissionSession';
import { PhaserHost } from '@/game/PhaserHost';
import { useT } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useHud } from '@/state/hud';
import { getSettings, useSettings } from '@/state/settings';
import { Hud } from '../hud/Hud';
import { GhostButton, PrimaryButton } from '../primitives';
import { IconPlay } from '../icons';

function createSession(onComplete: (r: MissionResult, s: MissionSession) => void): MissionSession {
  const settings = getSettings();
  const { runs, checkpoint, launch } = useApp.getState();
  const resume = launch.resume && checkpoint && checkpoint.mode === settings.mode ? checkpoint : null;
  const adaptation = computeAdaptation(runs, settings.mode);
  const session: MissionSession = new MissionSession({
    mode: resume?.mode ?? settings.mode,
    ease: resume?.ease ?? adaptation.ease,
    hints: settings.hints,
    resume,
    onCheckpoint: (cp) => {
      useApp.getState().setCheckpoint(cp);
      void saveCheckpoint(cp).catch(() => undefined);
    },
    onComplete: (r) => onComplete(r, session),
  });
  void logChoice({ at: Date.now(), kind: resume ? 'replay' : 'missionStarted', mode: session.mode }).catch(() => undefined);
  return session;
}

export default function MissionScreen() {
  const t = useT();
  const paused = useHud((s) => s.paused);
  const complete = useHud((s) => s.complete);
  const checkpoint = useApp((s) => s.checkpoint);

  const handleComplete = useCallback((result: MissionResult, s: MissionSession) => {
    const settings = getSettings();
    const run: RunSummary = {
      id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      missionId: 'awakening',
      mode: s.mode,
      modeChosen: settings.modeChosen,
      startedAt: s.startedAt,
      finishedAt: Date.now(),
      ease: s.director.ease,
      result,
    };
    useSettings.getState().set('firstRunDone', true);
    useApp.getState().finishRun(run);
    void saveRun(run).catch(() => undefined);
    void clearCheckpoint().catch(() => undefined);
    // Let the finisher breathe before the debrief.
    window.setTimeout(() => {
      if (useApp.getState().screen === 'mission') useApp.getState().go('results');
    }, 900);
  }, []);

  const [session] = useState(() => createSession(handleComplete));

  useEffect(() => {
    const pause = () => session.pause();
    const onVis = () => {
      if (document.visibilityState === 'hidden') pause();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', pause);
    window.addEventListener('blur', pause);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('blur', pause);
      session.dispose();
    };
  }, [session]);

  const quit = () => {
    if (!complete) void logChoice({ at: Date.now(), kind: 'missionAbandoned', mode: session.mode }).catch(() => undefined);
    useHud.setState({ paused: false });
    audio.resume();
    useApp.getState().go('hub');
  };

  return (
    <div className="app-height relative overflow-hidden bg-void">
      <PhaserHost session={session} />
      <Hud onPause={() => session.pause()} onPick={(id) => session.chooseUpgrade(id)} />
      {paused && !complete && (
        <div className="anim-fade absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="font-display text-[22px] font-bold uppercase tracking-[0.3em] text-bone">{t('pause.title')}</div>
          {checkpoint && <div className="mt-3 text-[12px] text-mist">{t('pause.saved')}</div>}
          <div className="safe-x mt-10 flex w-full max-w-sm flex-col gap-3">
            <PrimaryButton onPress={() => session.resume()} autoFocus>
              <IconPlay size={16} />
              {t('pause.resume')}
            </PrimaryButton>
            <GhostButton onPress={quit}>{t('pause.quit')}</GhostButton>
          </div>
        </div>
      )}
    </div>
  );
}
