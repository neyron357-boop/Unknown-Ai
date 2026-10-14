import { useEffect, useState } from 'react';
import { useT } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings, type GoreSetting, type Level } from '@/state/settings';
import { Backdrop } from '../Backdrop';
import { DangerConfirm, GhostButton, Row, ScreenHeader, SectionTitle, Segmented, Slider, Toggle } from '../primitives';

export function SettingsScreen() {
  const t = useT();
  const s = useSettings();
  const { go, back, aiStatus, refreshAi, wipe, runs, checkpoint } = useApp();
  const [wiped, setWiped] = useState(false);

  useEffect(() => {
    void refreshAi();
  }, [refreshAi]);

  // most → least, like the blood scale
  const levels: { value: Level; label: string }[] = [
    { value: 'full', label: t('set.full') },
    { value: 'low', label: t('set.low') },
    { value: 'off', label: t('set.off') },
  ];
  const gore: { value: GoreSetting; label: string }[] = [
    { value: 'high', label: t('set.gore.high') },
    { value: 'low', label: t('set.gore.low') },
    { value: 'off', label: t('set.gore.off') },
  ];

  const status = !s.mentor
    ? { text: t('set.ai.disabled'), dot: 'bg-mist/60' }
    : aiStatus === 'live'
      ? { text: t('set.ai.live'), dot: 'bg-blood shadow-[0_0_8px_rgba(255,42,68,1)]' }
      : aiStatus === 'demo'
        ? { text: t('set.ai.demo'), dot: 'bg-bone/60' }
        : aiStatus === 'offline'
          ? { text: t('set.ai.offline'), dot: 'bg-mist/60' }
          : { text: t('set.ai.checking'), dot: 'anim-pulse bg-bone/50' };

  return (
    <div className="app-height relative flex flex-col bg-ink">
      <Backdrop tone="plain" />
      <ScreenHeader title={t('set.title')} onBack={() => go(back === 'settings' ? 'hub' : back)} backLabel={t('nav.back')} />
      <main className="safe-x safe-bottom scroll-y relative z-10 flex-1 pb-10">
        <SectionTitle>{t('set.sound')}</SectionTitle>
        <Row label={t('set.music')}>
          <div className="flex items-center gap-2">
            {s.musicOn && <Slider label={t('set.music')} value={s.musicVolume} onChange={(v) => s.set('musicVolume', v)} />}
            <Toggle label={t('set.music')} value={s.musicOn} onChange={(v) => s.set('musicOn', v)} />
          </div>
        </Row>
        <Row label={t('set.sfx')}>
          <div className="flex items-center gap-2">
            {s.sfxOn && <Slider label={t('set.sfx')} value={s.sfxVolume} onChange={(v) => s.set('sfxVolume', v)} />}
            <Toggle label={t('set.sfx')} value={s.sfxOn} onChange={(v) => s.set('sfxOn', v)} />
          </div>
        </Row>
        <Row label={t('set.voice')}>
          <div className="flex items-center gap-2">
            {s.voiceOn && <Slider label={t('set.voice')} value={s.voiceVolume} onChange={(v) => s.set('voiceVolume', v)} />}
            <Toggle label={t('set.voice')} value={s.voiceOn} onChange={(v) => s.set('voiceOn', v)} />
          </div>
        </Row>
        <Row label={t('set.subtitles')}>
          <Toggle label={t('set.subtitles')} value={s.subtitles} onChange={(v) => s.set('subtitles', v)} />
        </Row>
        <Row label={t('set.limit')}>
          <Slider label={t('set.limit')} value={s.volumeLimit} onChange={(v) => s.set('volumeLimit', Math.max(0.1, v))} />
        </Row>

        <SectionTitle>{t('set.content')}</SectionTitle>
        <Row label={t('set.gore')}>
          <Segmented label={t('set.gore')} value={s.gore} options={gore} onChange={(v) => s.set('gore', v)} />
        </Row>
        <Row label={t('set.flashes')}>
          <Segmented label={t('set.flashes')} value={s.flashes} options={levels} onChange={(v) => s.set('flashes', v)} />
        </Row>
        <Row label={t('set.shake')}>
          <Segmented label={t('set.shake')} value={s.shake} options={levels} onChange={(v) => s.set('shake', v)} />
        </Row>
        <Row label={t('set.motion')}>
          <Toggle label={t('set.motion')} value={s.reduceMotion} onChange={(v) => s.set('reduceMotion', v)} />
        </Row>
        <Row label={t('set.effects')}>
          <Segmented
            label={t('set.effects')}
            value={s.effects}
            options={[
              { value: 'high', label: t('set.fxHigh') },
              { value: 'low', label: t('set.fxLow') },
            ]}
            onChange={(v) => s.set('effects', v)}
          />
        </Row>

        <SectionTitle>{t('set.game')}</SectionTitle>
        <Row label={t('set.hints')} hint={t('set.hints.d')}>
          <Toggle label={t('set.hints')} value={s.hints} onChange={(v) => s.set('hints', v)} />
        </Row>
        <Row label={t('set.haptics')} hint="Android">
          <Toggle label={t('set.haptics')} value={s.haptics} onChange={(v) => s.set('haptics', v)} />
        </Row>
        <Row label={t('set.lang')}>
          <Segmented
            label={t('set.lang')}
            value={s.lang}
            options={[
              { value: 'ru', label: 'RU' },
              { value: 'en', label: 'EN' },
            ]}
            onChange={(v) => s.set('lang', v)}
          />
        </Row>

        <SectionTitle>{t('set.ai')}</SectionTitle>
        <Row label={t('set.mentor')} hint={t('set.mentor.d')}>
          <Toggle label={t('set.mentor')} value={s.mentor} onChange={(v) => s.set('mentor', v)} />
        </Row>
        <div className="flex items-center gap-3 py-3" role="status">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} />
          <span className="text-[13px] text-bone/80">{status.text}</span>
        </div>

        <SectionTitle>{t('set.data')}</SectionTitle>
        <p className="text-[12px] leading-relaxed text-mist">{wiped ? t('stats.wiped') : t('set.privacy')}</p>
        <GhostButton className="mt-4 w-full" onPress={() => s.reset()}>
          {t('set.reset')}
        </GhostButton>
        {(runs.length > 0 || checkpoint) && (
          <div className="mt-2">
            <DangerConfirm
              label={t('stats.wipe')}
              confirmLabel={t('stats.wipeConfirm')}
              cancelLabel={t('set.cancel')}
              onConfirm={() => {
                void wipe().then(() => setWiped(true));
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
