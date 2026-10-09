import { useState } from 'react';
import { computeAdaptation, computeProfileStats } from '@/cognitive/adaptation';
import type { AttackKind } from '@/game/core/types';
import { useT, type StringKey } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings } from '@/state/settings';
import { RatioBar, Sparkline, StatTile } from '../charts';
import { GhostButton, ScreenHeader, SectionTitle } from '../primitives';

const KINDS: AttackKind[] = ['mid', 'high', 'low'];
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export function StatsScreen() {
  const t = useT();
  const { runs, lastRun, go, back, wipe, checkpoint } = useApp();
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
            <div className="mt-2 grid grid-cols-3 gap-2">
              <StatTile label={t('stats.runs')} value={String(stats.runs)} />
              <StatTile label={t('stats.minutes')} value={String(stats.totalMinutes)} />
              <StatTile label={t('stats.bestGrade')} value={stats.bestGrade ?? '—'} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <StatTile label={t('stats.bestAcc')} value={pct(stats.bestAccuracy)} />
              <StatTile label={t('stats.bestReact')} value={stats.bestReactionMs !== null ? `${stats.bestReactionMs} ${t('res.ms')}` : '—'} />
              <StatTile label={t('stats.precision')} value={pct(stats.blindPrecision)} />
              <StatTile label={t('stats.inhibition')} value={pct(stats.inhibition)} />
              <StatTile label={t('stats.calc')} value={pct(stats.calcAccuracy)} />
              <StatTile label={t('stats.recall')} value={pct(stats.recallAccuracy)} />
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
            <div className="flex items-baseline justify-between gap-3 border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
              <span className="text-[13px] text-bone/85">{t(`stats.adapt.${adaptation.reason}` as StringKey)}</span>
              <span className="shrink-0 text-[13px] font-semibold text-bone">
                {t(`mode.${mode}` as StringKey)} · ×{adaptation.ease.toFixed(2)}
              </span>
            </div>

            {r && (
              <>
                <SectionTitle>
                  {t('stats.lastRun')} · {t('stats.byRound')}
                </SectionTitle>
                <RatioBar label={t('round.takt')} ok={r.byRound.takt.ok} n={r.byRound.takt.n} />
                <RatioBar label={t('round.phantoms')} ok={r.byRound.phantoms.ok} n={r.byRound.phantoms.n} />
                <RatioBar label={t('round.overcharge')} ok={r.calc.correct} n={r.calc.choices} />
                <RatioBar label={t('round.ascension')} ok={r.recall.correct + r.byRound.ascension.ok} n={r.recall.taps + r.byRound.ascension.n} />

                <SectionTitle>{t('stats.byKind')}</SectionTitle>
                {KINDS.filter((k) => r.byKind[k].n > 0).map((k) => (
                  <RatioBar key={k} label={t(`kind.${k}` as StringKey)} ok={r.byKind[k].ok} n={r.byKind[k].n} />
                ))}

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <StatTile label={t('stats.timing')} value={r.timingMs !== null ? `±${r.timingMs}` : '—'} />
                  <StatTile label={t('stats.impulsive')} value={String(r.impulsive)} />
                  <StatTile label={t('stats.reboots')} value={String(r.reboots)} />
                </div>
              </>
            )}
          </>
        )}

        <p className="mt-8 text-[12px] leading-relaxed text-mist">{t('stats.note')}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-mist">{t('set.privacy')}</p>

        {(runs.length > 0 || checkpoint) && (
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
