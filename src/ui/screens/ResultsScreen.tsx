import { useEffect, useState } from 'react';
import { buildDebriefPayload, fetchDebrief, type MentorSource } from '@/ai/mentorClient';
import type { MissionResult } from '@/game/core/metrics';
import { useT, type StringKey } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Backdrop } from '../Backdrop';
import { StatTile } from '../charts';
import { IconChart, IconRestart } from '../icons';
import { GhostButton, PrimaryButton } from '../primitives';

const GRADE_STYLE: Record<MissionResult['grade'], string> = {
  S: 'text-[#ffd27a] [text-shadow:0_0_30px_rgba(255,210,122,0.8),0_0_80px_rgba(255,210,122,0.35)]',
  A: 'text-volt [text-shadow:0_0_30px_rgba(57,213,255,0.8),0_0_80px_rgba(57,213,255,0.3)]',
  B: 'text-bone [text-shadow:0_0_24px_rgba(255,255,255,0.5)]',
  C: 'text-mist',
};

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
    void fetchDebrief(buildDebriefPayload(lastRun.result, lang, previous)).then((m) => alive && setMentor(m));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRun?.id, lang, mentorOn]);

  useEffect(() => {
    if (!mentor) return;
    setTyped(0);
    const id = window.setInterval(() => setTyped((n) => (n >= mentor.text.length ? n : n + 1)), 18);
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
  const pct = (ok: number, n: number) => (n ? `${Math.round((ok / n) * 100)}%` : '—');
  const rounds: [StringKey, string][] = [
    ['round.takt', pct(r.byRound.takt.ok, r.byRound.takt.n)],
    ['round.phantoms', pct(r.byRound.phantoms.ok, r.byRound.phantoms.n)],
    ['round.overcharge', `${r.calc.correct}/${r.calc.choices}`],
    ['round.ascension', `${r.recall.correct}/${r.recall.taps}`],
  ];

  return (
    <div className="app-height relative flex flex-col overflow-hidden">
      <Backdrop tone="volt" />
      <main className="safe-top safe-x scroll-y relative z-10 flex flex-1 flex-col pb-4">
        <div className="mt-5 text-center">
          <div className="anim-rise text-[11px] uppercase tracking-[0.42em] text-mist">
            {t('res.title')} · {t('hub.awakening')}
          </div>
          <div className={`anim-pop mt-2 font-display text-[96px] font-extrabold leading-none ${GRADE_STYLE[r.grade]}`} style={{ animationDelay: '0.15s' }}>
            {r.grade}
          </div>
          <div className="anim-rise mt-1 text-[13px] tabular-nums tracking-[0.1em] text-bone/80" style={{ animationDelay: '0.3s' }}>
            {r.score.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')} {t('res.score')}
          </div>
        </div>

        <div className="anim-rise mt-6 grid grid-cols-2 gap-2" style={{ animationDelay: '0.35s' }}>
          <StatTile label={t('res.accuracy')} value={`${acc}%`} delta={accDelta ? `${Math.abs(accDelta)}%` : undefined} deltaGood={(accDelta ?? 0) > 0} />
          <StatTile label={t('res.reaction')} value={r.reactionMedianMs !== null ? `${r.reactionMedianMs} ${t('res.ms')}` : '—'} />
          <StatTile label={t('res.predictions')} value={`${r.predictions.correct}/${r.predictions.attempts}`} />
          <StatTile label={t('res.combo')} value={String(r.maxCombo)} />
        </div>
        <div className="anim-rise mt-2 grid grid-cols-4 gap-1.5" style={{ animationDelay: '0.45s' }}>
          {rounds.map(([k, v]) => (
            <div key={k} className="border border-white/[0.07] bg-white/[0.02] px-1.5 py-2 text-center">
              <div className="truncate text-[9px] font-semibold uppercase tracking-[0.04em] text-mist">{t(k)}</div>
              <div className="mt-1 text-[15px] font-semibold text-bone">{v}</div>
            </div>
          ))}
        </div>
        <div className="anim-rise mt-2 border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-[13px] text-bone/85" style={{ animationDelay: '0.5s' }}>
          <span className="text-mist">{t('res.best')}: </span>
          {t(`best.${r.bestDecision.kind}` as StringKey)}
          {r.bestDecision.kind === 'perfectStreak' || r.bestDecision.kind === 'comboKing' ? ` ×${r.bestDecision.value}` : ''}
        </div>

        {mentorOn && (
          <div className="anim-rise mt-5 min-h-[80px] border-l-2 border-volt/60 pl-4" style={{ animationDelay: '0.6s' }}>
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
