import { useMemo, useState } from 'react';
import { computeAdaptation, computeProfileStats } from '@/cognitive/adaptation';
import type { ModeId } from '@/game/v3/core/types';
import { plural, useT, type StringKey } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Backdrop } from '../Backdrop';
import { MeterRow, Sparkline, StatTile } from '../charts';
import { DangerConfirm, ScreenHeader, SectionTitle } from '../primitives';

const MODES: { id: ModeId; bpm: number }[] = [
  { id: 'spark', bpm: 128 },
  { id: 'flow', bpm: 120 },
  { id: 'calm', bpm: 100 },
];
/** One adaptation step (see src/cognitive/adaptation.ts). */
const STEP = 0.05;
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export function StatsScreen() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const { runs, go, back, wipe, checkpoint } = useApp();
  const [wiped, setWiped] = useState(false);
  const stats = useMemo(() => computeProfileStats(runs), [runs]);
  const ms = t('res.ms');

  return (
    <div className="app-height relative flex flex-col bg-ink">
      <Backdrop tone="plain" />
      <ScreenHeader title={t('stats.title')} onBack={() => go(back === 'results' ? 'results' : 'hub')} backLabel={t('nav.back')} />
      <main className="safe-x safe-bottom scroll-y relative z-10 flex-1 pb-10">
        {runs.length === 0 ? (
          <p className="mt-16 text-center font-cut text-[14px] uppercase tracking-[0.12em] text-bone/70">{wiped ? t('stats.wiped') : t('stats.empty')}</p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <StatTile label={t('stats.runs')} value={String(stats.runs)} />
              <StatTile label={t('stats.minutes')} value={stats.totalMinutes.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')} />
              <StatTile label={t('stats.bestGrade')} value={stats.bestGrade ?? '—'} accent />
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <StatTile label={t('stats.bestScore')} value={stats.bestScore.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')} />
              <StatTile label={t('stats.bestAcc')} value={pct(stats.bestAccuracy)} />
              <StatTile label={t('stats.bestTiming')} value={stats.bestTimingMs !== null ? `±${stats.bestTimingMs} ${ms}` : '—'} />
              <StatTile label={t('stats.kills')} value={stats.totalKills.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')} sub={`${stats.totalDecaps} ${t('stats.decaps')}`} />
            </div>

            <SectionTitle>{t('stats.skills')}</SectionTitle>
            <MeterRow label={t('stats.inhibition')} hint={t('stats.inhibition.d')} value={stats.inhibition} />
            <MeterRow label={t('stats.patternMemory')} hint={t('stats.patternMemory.d')} value={stats.patternMemory} />
            <MeterRow label={t('stats.execAccuracy')} hint={t('stats.execAccuracy.d')} value={stats.execAccuracy} />

            {stats.accuracySeries.length >= 2 && (
              <>
                <SectionTitle>{t('stats.trends')}</SectionTitle>
                <div className="flex flex-col gap-6">
                  <Sparkline label={t('stats.accTrend')} values={stats.accuracySeries.slice(-20)} format={(v) => `${Math.round(v * 100)}%`} />
                  {stats.timingSeries.length >= 2 && (
                    <Sparkline label={t('stats.timingTrend')} values={stats.timingSeries.slice(-20)} format={(v) => `±${Math.round(v)} ${ms}`} invert />
                  )}
                </div>
              </>
            )}

            <SectionTitle>{t('stats.modes')}</SectionTitle>
            <ul className="flex flex-col gap-1.5">
              {MODES.map(({ id, bpm }) => {
                const a = computeAdaptation(runs, id);
                const steps = Math.round((a.ease - 1) / STEP);
                const level =
                  steps === 0
                    ? t('stats.level.base')
                    : `${t(steps > 0 ? 'stats.level.easier' : 'stats.level.harder')} ${Math.abs(steps)} ${plural(lang, Math.abs(steps), 'unit.step')}`;
                const fights = runs.filter((r) => r.mode === id).length;
                const mastered = stats.masteredModes.includes(id);
                return (
                  <li key={id} className="border border-white/[0.07] bg-black/35 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="font-cut text-[14px] tracking-[0.12em] text-bone">{t(`mode.${id}` as StringKey)}</span>
                        <span className="text-[11px] text-mist">{bpm} BPM</span>
                      </div>
                      {mastered && (
                        <span className="inline-flex items-center gap-1 border border-blood/50 px-1.5 py-[1px] text-[10px] uppercase tracking-[0.08em] text-bone/85">
                          <span aria-hidden className="text-blood">◆</span>
                          {t('stats.mastered')}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[12px] text-mist">
                      {fights} {plural(lang, fights, 'unit.fight')} · {t('stats.picked')} {stats.chosenModes[id]}×
                    </div>
                    <div className="mt-1.5 text-[13px] leading-snug text-bone/85">
                      <span className="text-mist">{t('stats.next')}:</span> {level}
                      <span className="block text-[12px] text-mist">{t(`stats.adapt.${a.reason}` as StringKey)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <p className="mt-8 text-[12px] leading-relaxed text-mist">{t('stats.note')}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-mist">{t('set.privacy')}</p>

        {(runs.length > 0 || checkpoint) && (
          <div className="mt-6">
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
