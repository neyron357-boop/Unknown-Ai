import { useEffect } from 'react';
import { useT } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings, type Level } from '@/state/settings';
import { GhostButton, Row, ScreenHeader, SectionTitle, Segmented, Slider, Toggle } from '../primitives';

export function SettingsScreen() {
  const t = useT();
  const s = useSettings();
  const { go, back, aiStatus, refreshAi } = useApp();

  useEffect(() => {
    void refreshAi();
  }, [refreshAi]);

  const levels: { value: Level; label: string }[] = [
    { value: 'off', label: t('set.off') },
    { value: 'low', label: t('set.low') },
    { value: 'full', label: t('set.full') },
  ];

  return (
    <div className="app-height relative flex flex-col bg-ink">
      <ScreenHeader title={t('set.title')} onBack={() => go(back === 'settings' ? 'hub' : back)} backLabel={t('nav.back')} />
      <main className="safe-x safe-bottom scroll-y flex-1 pb-10">
        <SectionTitle>{t('set.sound')}</SectionTitle>
        <Row label={t('set.music')}>
          <div className="flex items-center gap-3">
            {s.musicOn && <Slider label={t('set.music')} value={s.musicVolume} onChange={(v) => s.set('musicVolume', v)} />}
            <Toggle label={t('set.music')} value={s.musicOn} onChange={(v) => s.set('musicOn', v)} />
          </div>
        </Row>
        <Row label={t('set.sfx')}>
          <div className="flex items-center gap-3">
            {s.sfxOn && <Slider label={t('set.sfx')} value={s.sfxVolume} onChange={(v) => s.set('sfxVolume', v)} />}
            <Toggle label={t('set.sfx')} value={s.sfxOn} onChange={(v) => s.set('sfxOn', v)} />
          </div>
        </Row>
        <Row label={t('set.limit')}>
          <Slider label={t('set.limit')} value={s.volumeLimit} onChange={(v) => s.set('volumeLimit', Math.max(0.1, v))} />
        </Row>

        <SectionTitle>{t('set.visual')}</SectionTitle>
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
              { value: 'low', label: t('set.low') },
              { value: 'high', label: t('set.high') },
            ]}
            onChange={(v) => s.set('effects', v)}
          />
        </Row>

        <SectionTitle>{t('set.game')}</SectionTitle>
        <Row label={t('set.hints')}>
          <Toggle label={t('set.hints')} value={s.hints} onChange={(v) => s.set('hints', v)} />
        </Row>
        <Row label={t('set.mentor')}>
          <Toggle label={t('set.mentor')} value={s.mentor} onChange={(v) => s.set('mentor', v)} />
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
        <div className="flex items-center gap-3 border-b border-white/[0.06] py-3">
          <span
            className={`h-2 w-2 rounded-full ${aiStatus === 'live' ? 'bg-volt shadow-[0_0_8px_rgba(57,213,255,1)]' : aiStatus === 'demo' ? 'bg-bone/60' : 'bg-blood/70'}`}
          />
          <span className="text-[14px] text-bone/85">
            {aiStatus === 'live' ? t('set.ai.live') : aiStatus === 'demo' ? t('set.ai.demo') : aiStatus === 'offline' ? t('set.ai.offline') : '…'}
          </span>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-mist">{t('set.privacy')}</p>

        <GhostButton className="mt-8 w-full" onPress={() => s.reset()}>
          {t('set.reset')}
        </GhostButton>
      </main>
    </div>
  );
}
