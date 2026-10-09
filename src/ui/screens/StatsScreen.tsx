import { useState } from 'react';
import { computeAdaptation, computeProfileStats } from '@/cognitive/adaptation';
import type { AttackType } from '@/game/core/types';
import { useT, type StringKey } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings } from '@/state/settings';
import { RatioBar, Sparkline, StatTile } from '../charts';
import { GhostButton, ScreenHeader, SectionTitle } from '../primitives';

const TYPES: AttackType[] = ['slashL', 'slashR', 'crush', 'pierce'];

export function StatsScreen() {
  const t = useT();
  const { runs, lastRun, go, back, wipe } = useApp();
  const mode = useSettings((s) => s.mode);
  const [confirm, setConfirm] = useState(false);
  const [wiped, setWiped] = useState(false);

  const stats = computeProfileStats(runs);
  const adaptation = computeAdaptation(runs, mode);
  const r = lastRun?.result;

  return (
    <div className="app-height relative flex flex-col bg-ink">
      <ScreenHeader title={t('stats.title')} onBack={() => go(back === 'results' ? 'results' : 'hub')} backLabel={t('nav.back')} />
      <main className="safe-x safe-bottom scroll-y flex-1 pb-10">
        {runs.length === 0 ? (
          <p className="mt-16 text-center text-[14px] text-mist">{wiped ? t('stats.wiped') : t('stats.empty')}</p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <StatTile label={t('stats.runs')} value={String(stats.runs)} />
              <StatTile label={t('stats.minutes')} value={String(stats.totalMinutes)} />
              <StatTile label={t('stats.bestAcc')} value={`${Math.round(stats.bestAccuracy * 100)}%`} />
              <StatTile label={t('stats.bestReact')} value={stats.bestReactionMs !== null ? `${stats.bestReactionMs} ${t('res.ms')}` : '—'} />
              <StatTile
                label={t('stats.precision')}
                value={stats.predictionPrecision !== null ? `${Math.round(stats.predictionPrecision * 100)}%` : '—'}
              />
              <StatTile label={t('stats.reads')} value={String(stats.totalReads)} />
            </div>

            {stats.accuracySeries.length >= 2 && (
              <div className="mt-6 flex flex-col gap-6">
                <Sparkline label={t('stats.accTrend')} values={stats.accuracySeries.slice(-20)} format={(v) => `${Math.round(v * 100)}%`} />
                {stats.reactionSeries.length >= 2 && (
                  <Sparkline label={t('stats.reactTrend')} values={stats.reactionSeries.slice(-20)} format={(v) => `${Math.round(v)} ${t('res.ms')}`} invert />
                )}
              </div>
            )}

            <SectionTitle>{t('stats.adapt')}</SectionTitle>
            <div className="flex items-baseline justify-between border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
              <span className="text-[13px] text-bone/85">{t(`stats.adapt.${adaptation.reason}` as StringKey)}</span>
              <span className="text-[13px] font-semibold text-bone">
                {t(`mode.${mode}` as StringKey)} · ×{adaptation.telegraphScale.toFixed(2)}
              </span>
            </div>

            {r && (
              <>
                <SectionTitle>{t('stats.lastRun')} · {t('stats.byStage')}</SectionTitle>
                <RatioBar label={t('stage.contact')} ok={r.byStage.contact.ok} n={r.byStage.contact.n} />
                <RatioBar label={t('stage.pattern')} ok={r.byStage.pattern.ok} n={r.byStage.pattern.n} />
                <RatioBar label={t('stage.ascension')} ok={r.byStage.ascension.ok} n={r.byStage.ascension.n} />

                <SectionTitle>{t('stats.byType')}</SectionTitle>
                {TYPES.filter((k) => r.byType[k].n > 0).map((k) => (
                  <RatioBar key={k} label={t(`type.${k}` as StringKey)} ok={r.byType[k].ok} n={r.byType[k].n} />
                ))}

                <SectionTitle>{t('stats.memory')}</SectionTitle>
                <RatioBar label={t('stats.memory')} ok={r.ascension.correct} n={r.ascension.taps} />

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <StatTile label={t('stats.impulsive')} value={String(r.impulsive)} />
                  <StatTile label={t('stats.reboots')} value={String(r.reboots)} />
                  <StatTile label={t('stats.assists')} value={String(r.assists)} />
                </div>
              </>
            )}
          </>
        )}

        <p className="mt-8 text-[12px] leading-relaxed text-mist">{t('stats.note')}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-mist">{t('set.privacy')}</p>

        {(runs.length > 0 || useApp.getState().checkpoint) && (
          <div className="mt-6">
            {confirm ? (
              <div className="grid grid-cols-2 gap-2">
                <GhostButton
                  className="border-blood/50 text-blood"
                  onPress={() => {
                    void wipe().then(() => {
                      setConfirm(false);
                      setWiped(true);
                    });
                  }}
                >
                  {t('stats.wipeConfirm')}
                </GhostButton>
                <GhostButton onPress={() => setConfirm(false)}>{t('nav.back')}</GhostButton>
              </div>
            ) : (
              <GhostButton className="w-full" onPress={() => setConfirm(true)}>
                {t('stats.wipe')}
              </GhostButton>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
