import { lazy, Suspense, useEffect } from 'react';
import { audio } from '@/audio/AudioEngine';
import { useApp } from '@/state/app';
import { useSettings } from '@/state/settings';
import { HubScreen } from '@/ui/screens/HubScreen';
import { ResultsScreen } from '@/ui/screens/ResultsScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { StatsScreen } from '@/ui/screens/StatsScreen';
import { TitleScreen } from '@/ui/screens/TitleScreen';
import { UpdatePrompt } from '@/ui/UpdatePrompt';
import { OrientationGuard } from '@/ui/OrientationGuard';

// Phaser (~1 MB) loads only for the mission, and is prefetched while the menus are shown.
const loadMission = () => import('@/ui/screens/MissionScreen');
const MissionScreen = lazy(loadMission);

export function App() {
  const screen = useApp((s) => s.screen);
  const nonce = useApp((s) => s.launch.nonce);
  const lang = useSettings((s) => s.lang);
  const reduceMotion = useSettings((s) => s.reduceMotion);

  useEffect(() => {
    void useApp.getState().load();
    const t = window.setTimeout(() => void loadMission(), 1200);
    return () => window.clearTimeout(t);
  }, []);

  // Keep the audio engine in sync with the settings.
  useEffect(
    () =>
      useSettings.subscribe((s) =>
        audio.setPrefs({ musicOn: s.musicOn, sfxOn: s.sfxOn, musicVolume: s.musicVolume, sfxVolume: s.sfxVolume, volumeLimit: s.volumeLimit }),
      ),
    [],
  );
  useEffect(() => {
    const s = useSettings.getState();
    audio.setPrefs({ musicOn: s.musicOn, sfxOn: s.sfxOn, musicVolume: s.musicVolume, sfxVolume: s.sfxVolume, volumeLimit: s.volumeLimit });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <div className={reduceMotion ? 'reduce-motion' : undefined}>
      {screen === 'title' && <TitleScreen />}
      {screen === 'hub' && <HubScreen />}
      {screen === 'mission' && (
        <Suspense fallback={<div className="app-height bg-void" />}>
          <MissionScreen key={nonce} />
        </Suspense>
      )}
      {screen === 'results' && <ResultsScreen />}
      {screen === 'stats' && <StatsScreen />}
      {screen === 'settings' && <SettingsScreen />}
      <OrientationGuard />
      <UpdatePrompt />
    </div>
  );
}
