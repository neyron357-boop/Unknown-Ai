import { useEffect, useState } from 'react';
import { buildDebriefPayload, fetchDebrief, type MentorSource } from '@/ai/mentorClient';
import { useT, type StringKey } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Backdrop } from '../Backdrop';
import { StatTile } from '../charts';
import { IconChart, IconRestart } from '../icons';
import { GhostButton, PrimaryButton } from '../primitives';

export function ResultsScreen() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const mentorOn = useSettings((s) => s.mentor);
  const { lastRun, runs, go, startMission } = useApp();
  const [mentor, setMentor] = useState<{ text: string; source: MentorSource } | null>(null);
  const [typed, setTyped] = useState(0);

  const previous = lastRun ? runs.filter((r) => r.id !== lastRun.id && r.mode === lastRun.mode) : [];
  const prev = previous[previous.length - 1];

  useEffect(() => {
    if (!lastRun || !mentorOn) return;
    let alive = true;
    const payload = buildDebriefPayload(lastRun.result, lang, previous);
    void fetchDebrief(payload).then((m) => {
      if (alive) setMentor(m);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRun?.id, lang, mentorOn]);

  useEffect(() => {
    if (!mentor) return;
    setTyped(0);
    const id = window.setInterval(() => setTyped((n) => (n >= mentor.text.length ? n : n + 1)), 20);
    return () => window.clearInterval(id);
  }, [mentor]);

  if (!lastRun) {
    return (
      <div className="app-height relative flex items-center justify-center">
        <Backdrop />
        <GhostButton onPress={() => go('hub')}>{t('res.hub')}</GhostButton>
      </div>
    );
  }

  const r = lastRun.result;
  const acc = Math.round(r.accuracy * 100);
  const accDelta = prev ? acc - Math.round(prev.result.accuracy * 100) : null;
  const reactDelta =
    prev && r.reactionMedianMs !== null && prev.result.reactionMedianMs !== null ? r.reactionMedianMs - prev.result.reactionMedianMs : null;
  const best = r.bestDecision;
  const bestValue =
    best.kind === 'fastReaction'
      ? `${best.value} ${t('res.ms')}`
      : best.kind === 'perfectAscension'
        ? `${best.value}/${best.value}`
        : best.kind === 'persistence'
          ? '✓'
          : `×${best.value}`;

  return (
    <div className="app-height relative flex flex-col overflow-hidden">
      <Backdrop tone="volt" />
      <main className="safe-top safe-x scroll-y relative z-10 flex flex-1 flex-col pb-4">
        <div className="mt-8 text-center">
          <div className="anim-rise text-[11px] uppercase tracking-[0.42em] text-mist">05 · {t('hub.awakening')}</div>
          <h1 className="anim-rise mt-2 font-display text-[30px] font-bold tracking-[0.2em] text-bone glow-volt" style={{ animationDelay: '0.1s' }}>
            {t('res.title')}
          </h1>
        </div>

        <div className="anim-rise mt-8 grid grid-cols-2 gap-2" style={{ animationDelay: '0.25s' }}>
          <StatTile
            label={t('res.accuracy')}
            value={`${acc}%`}
            delta={accDelta !== null && accDelta !== 0 ? `${Math.abs(accDelta)}%` : undefined}
            deltaGood={accDelta !== null && accDelta > 0}
          />
          <StatTile
            label={t('res.reaction')}
            value={r.reactionMedianMs !== null ? `${r.reactionMedianMs} ${t('res.ms')}` : '—'}
            delta={reactDelta !== null && reactDelta !== 0 ? `${Math.abs(reactDelta)} ${t('res.ms')}` : undefined}
            deltaGood={reactDelta !== null && reactDelta < 0}
          />
          <StatTile label={t('res.predictions')} value={`${r.predictions.correct}/${r.predictions.attempts}`} />
          <StatTile label={t('res.best')} value={bestValue} />
        </div>
        <div className="anim-rise mt-2 border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 text-[13px] text-bone/80" style={{ animationDelay: '0.35s' }}>
          {t(`best.${best.kind}` as StringKey)}
        </div>

        {mentorOn && (
          <div className="anim-rise mt-6 min-h-[86px] border-l-2 border-volt/60 pl-4" style={{ animationDelay: '0.5s' }}>
            <div className="flex items-center gap-2 font-display text-[10px] tracking-[0.34em] text-volt">
              {t('res.mentor')}
              {mentor && <span className="font-sans text-[10px] tracking-normal text-mist">{sourceLabel(mentor.source, lang)}</span>}
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-bone/90">
              {mentor ? (
                <>
                  {mentor.text.slice(0, typed)}
                  <span className="text-transparent">{mentor.text.slice(typed)}</span>
                </>
              ) : (
                <span className="anim-pulse text-mist">···</span>
              )}
            </p>
          </div>
        )}
      </main>

      <footer className="safe-x safe-bottom relative z-10 flex flex-col gap-2 pb-3">
        <PrimaryButton onPress={() => startMission(false)}>
          <IconRestart size={18} />
          {t('res.again')}
        </PrimaryButton>
        <div className="grid grid-cols-2 gap-2">
          <GhostButton onPress={() => go('stats')}>
            <IconChart size={18} />
            {t('res.details')}
          </GhostButton>
          <GhostButton onPress={() => go('hub')}>{t('res.hub')}</GhostButton>
        </div>
      </footer>
    </div>
  );
}

function sourceLabel(source: MentorSource, lang: 'ru' | 'en'): string {
  if (source === 'gemini') return 'Gemini';
  if (source === 'demo') return lang === 'ru' ? 'демо' : 'demo';
  return lang === 'ru' ? 'локально' : 'local';
}
