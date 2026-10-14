import { useEffect, useMemo, useState } from 'react';
import { buildDebriefPayload, fetchDebrief, localDebrief, type MentorSource } from '@/ai/mentorClient';
import { onSubtitle, voice } from '@/audio/bus';
import type { RunSummary } from '@/cognitive/adaptation';
import type { BattleResult, BestMoment, Grade } from '@/game/v3/core/metrics';
import type { EnemyKind } from '@/game/v3/core/types';
import { plural, useT, type StringKey } from '@/i18n/strings';
import { useApp } from '@/state/app';
import { useSettings, type Lang } from '@/state/settings';
import type { VoiceCue } from '@/voice/lines';
import { shownBest } from '../../../shared/debrief';
import { Backdrop } from '../Backdrop';
import { RatioBar, StatTile } from '../charts';
import { IconChart, IconMenu, IconRestart } from '../icons';
import { GhostButton, PrimaryButton, SourceTag } from '../primitives';

const GRADE_STYLE: Record<Grade, string> = {
  S: 'text-blood [text-shadow:0_0_26px_rgba(255,42,68,0.95),0_0_90px_rgba(255,42,68,0.5)]',
  A: 'text-bone [text-shadow:0_0_26px_rgba(255,42,68,0.7),0_0_80px_rgba(255,42,68,0.3)]',
  B: 'text-bone/90 [text-shadow:0_0_22px_rgba(255,255,255,0.25)]',
  C: 'text-mist [text-shadow:0_0_18px_rgba(139,143,168,0.35)]',
};

const KINDS: (EnemyKind | 'boss')[] = ['grunt', 'brute', 'dodger', 'feinter', 'leaper', 'crawler', 'gunner', 'butcher', 'boss'];

interface Debrief {
  text: string;
  source: MentorSource;
}

/** Per-run memory, so coming back from Progress neither re-asks Gemini nor replays the voice. */
const debriefs = new Map<string, Debrief>();
const voiced = new Set<string>();
const spokenLines = new Map<string, { ru: string; en: string }>();

export function ResultsScreen() {
  const t = useT();
  const { lastRun, go } = useApp();
  if (!lastRun) {
    return (
      <div className="app-height relative flex flex-col items-center justify-center gap-6">
        <Backdrop tone="dim" />
        <p className="relative z-10 text-[14px] text-mist">{t('res.empty')}</p>
        <GhostButton className="relative z-10" onPress={() => go('hub')}>
          {t('res.menu')}
        </GhostButton>
      </div>
    );
  }
  return <Debriefing run={lastRun} />;
}

function Debriefing({ run }: { run: RunSummary }) {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const mentorOn = useSettings((s) => s.mentor);
  const subtitles = useSettings((s) => s.subtitles);
  const runs = useApp((s) => s.runs);
  const go = useApp((s) => s.go);
  const startMission = useApp((s) => s.startMission);
  const r = run.result;

  /** Earlier fights of the same mode (the newest one gives the deltas). */
  const previous = useMemo(() => runs.filter((x) => x.id !== run.id && x.mode === run.mode && x.finishedAt <= run.finishedAt), [runs, run]);
  const prev = previous.reduce<RunSummary | null>((m, x) => (!m || x.finishedAt > m.finishedAt ? x : m), null);

  // ECHO's spoken verdict for the grade, once per run, ~600 ms in.
  const [spoken, setSpoken] = useState(() => spokenLines.get(run.id) ?? null);
  useEffect(() => {
    if (voiced.has(run.id)) return;
    voiced.add(run.id);
    let id: string | null = null;
    const off = onSubtitle((s) => {
      if (!id || s.id !== id) return;
      const line = { ru: s.ru, en: s.en };
      spokenLines.set(run.id, line);
      setSpoken(line);
    });
    id = voice.play(`echo.result.${r.grade}` as VoiceCue, { delayMs: 600 })?.id ?? null;
    const stop = window.setTimeout(off, 10_000);
    return () => {
      window.clearTimeout(stop);
      off();
    };
  }, [run.id, r.grade]);

  const acc = Math.round(r.accuracy * 100);
  const accDelta = prev ? acc - Math.round(prev.result.accuracy * 100) : null;
  const bias = r.timing.biasMs;
  const timingSub = bias === null ? undefined : Math.abs(bias) < 10 ? t('res.onBeat') : `${Math.abs(bias)} ${t('res.ms')} ${bias < 0 ? t('res.early') : t('res.late')}`;
  const frac = (ok: number, n: number) => (n ? `${ok}/${n}` : '—');
  const best = shownBest(r.best.kind, r.accuracy);
  const weakest = r.weakestKind;
  const rows = KINDS.filter((k) => r.byKind[k].n > 0);

  return (
    <div className="app-height relative flex flex-col overflow-hidden">
      <Backdrop tone="dim" />
      <main className="safe-top safe-x scroll-y relative z-10 flex flex-1 flex-col pb-4">
        <div className="mt-4 text-center">
          <div className="anim-rise font-cut text-[11px] uppercase tracking-[0.38em] text-mist">
            {t('hub.mission')} · {t(`mode.${run.mode}` as StringKey)}
          </div>
          <div className="relative mx-auto mt-1 w-fit">
            <div aria-hidden className={`anim-stamp font-blood text-[118px] leading-[1.02] ${GRADE_STYLE[r.grade]}`} style={{ animationDelay: '0.15s' }}>
              {r.grade}
            </div>
            <span className="sr-only">
              {t('res.rank')} {r.grade}
            </span>
          </div>
          <div className="anim-rise text-[17px] font-semibold text-bone" style={{ animationDelay: '0.3s' }}>
            {r.score.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')} <span className="text-[13px] font-normal text-mist">{plural(lang, r.score, 'unit.point')}</span>
          </div>
          {subtitles && spoken && <p className="anim-whisper mx-auto mt-2 max-w-[19rem] text-[13px] italic text-bone/70">— {lang === 'ru' ? spoken.ru : spoken.en}</p>}
        </div>

        <EchoDebrief run={run} previous={previous} lang={lang} mentorOn={mentorOn} />

        <div className="anim-rise mt-5 grid grid-cols-3 gap-1.5" style={{ animationDelay: '0.45s' }}>
          <StatTile
            label={t('res.accuracy')}
            value={`${acc}%`}
            delta={accDelta ? `${Math.abs(accDelta)}% ${t('res.vsPrev')}` : undefined}
            deltaGood={(accDelta ?? 0) > 0}
            accent
          />
          <StatTile label={t('res.timing')} value={r.timing.meanAbsMs !== null ? `±${r.timing.meanAbsMs}` : '—'} sub={timingSub ?? t('res.ms')} />
          <StatTile label={t('res.kills')} value={String(r.kills)} sub={`${r.decaps} ${t('res.decaps')}`} />
          <StatTile label={t('res.combo')} value={String(r.maxCombo)} />
          <StatTile label={t('res.perfect')} value={String(r.longestPerfect)} />
          <StatTile label={t('res.feints')} value={frac(r.feints.ignored, r.feints.total)} sub={t('res.feintsSub')} />
          <StatTile label={t('res.patterns')} value={frac(r.patterns.repeatOk, r.patterns.repeats)} sub={t('res.patternsSub')} />
          <StatTile label={t('res.exec')} value={frac(r.exec.correct, r.exec.cuts)} sub={t('res.execSub')} />
          <StatTile label={t('res.hits')} value={String(r.hitsTaken)} sub={`${r.reboots} ${plural(lang, r.reboots, 'unit.reboot')}`} />
        </div>

        <div className="anim-rise mt-2 flex items-baseline gap-2 border border-white/[0.07] bg-black/35 px-3 py-2.5 text-[13px]" style={{ animationDelay: '0.5s' }}>
          <span className="shrink-0 text-mist">{t('res.best')}</span>
          <span className="font-semibold text-bone">{bestLine(best, r, t)}</span>
        </div>

        {rows.length > 0 && (
          <section className="anim-rise mt-5" style={{ animationDelay: '0.55s' }}>
            <h2 className="mb-1 flex items-center gap-2.5 font-cut text-[11px] uppercase tracking-[0.3em] text-mist">
              <span aria-hidden className="h-px w-4 bg-blood/80" />
              {t('res.byEnemy')}
            </h2>
            {rows.map((k) => (
              <div key={k}>
                <RatioBar
                  label={t(`enemy.${k}` as StringKey)}
                  ok={r.byKind[k].ok}
                  n={r.byKind[k].n}
                  highlight={k === weakest}
                  note={k === weakest ? <WeakTag label={t('res.weakest')} /> : undefined}
                />
                {k === weakest && <p className="-mt-1 mb-1 text-[12px] text-bone/70">→ {t(`tip.${k}` as StringKey)}</p>}
              </div>
            ))}
          </section>
        )}
      </main>

      <footer className="safe-x safe-bottom relative z-10 flex flex-col gap-2 border-t border-white/[0.06] bg-black/80 pb-2 pt-3">
        <PrimaryButton onPress={() => startMission(false)}>
          <IconRestart size={18} />
          {t('res.again')}
        </PrimaryButton>
        <div className="grid grid-cols-2 gap-2">
          <GhostButton onPress={() => go('stats')}>
            <IconChart size={18} />
            {t('res.progress')}
          </GhostButton>
          <GhostButton onPress={() => go('hub')}>
            <IconMenu size={18} />
            {t('res.menu')}
          </GhostButton>
        </div>
      </footer>
    </div>
  );
}

function bestLine(best: BestMoment, r: BattleResult, t: (k: StringKey) => string): string {
  const name = t(`best.${best}` as StringKey);
  switch (best) {
    case 'perfectStreak':
      return `${name} ×${r.longestPerfect}`;
    case 'comboKing':
      return `${name} ×${r.maxCombo}`;
    case 'bloodlust':
      return `${name} ×${r.bloodlusts}`;
    case 'flawlessExec':
      return `${name} · ${r.exec.correct}/${r.exec.cuts}`;
    case 'patternRead':
      return `${name} · ${r.patterns.repeatOk}/${r.patterns.repeats}`;
    case 'ironWill':
      return `${name} · ${r.feints.ignored}/${r.feints.total}`;
    default:
      return name;
  }
}

function WeakTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 border border-blood/50 px-1.5 py-[1px] align-middle text-[10px] uppercase tracking-[0.08em] text-bone/85">
      <span aria-hidden className="text-[9px] text-blood">▼</span>
      {label}
    </span>
  );
}

/** ECHO's debrief: Gemini when AI lines are on (always with a local fallback), typed out. */
function EchoDebrief({ run, previous, lang, mentorOn }: { run: RunSummary; previous: RunSummary[]; lang: Lang; mentorOn: boolean }) {
  const t = useT();
  const key = `${run.id}:${lang}:${mentorOn ? 'ai' : 'local'}`;
  const [state, setState] = useState<{ key: string; debrief: Debrief; fresh: boolean } | null>(() => {
    const cached = debriefs.get(key);
    return cached ? { key, debrief: cached, fresh: false } : null;
  });

  useEffect(() => {
    const cached = debriefs.get(key);
    if (cached) {
      setState((s) => (s?.key === key ? s : { key, debrief: cached, fresh: false }));
      return;
    }
    const payload = buildDebriefPayload(run.result, lang, previous);
    if (!mentorOn) {
      const d = localDebrief(payload);
      debriefs.set(key, d);
      setState({ key, debrief: d, fresh: true });
      return;
    }
    let alive = true;
    setState(null);
    void fetchDebrief(payload).then((d) => {
      debriefs.set(key, d);
      if (alive) setState({ key, debrief: d, fresh: true });
    });
    return () => {
      alive = false;
    };
    // `previous` is derived from the store and stable for a run; the key covers run, language and mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const d = state?.debrief ?? null;
  return (
    <section aria-live="polite" className="anim-rise mt-5 border-l-2 border-blood pl-3.5" style={{ animationDelay: '0.4s' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-glitch text-[13px] tracking-[0.3em] text-blood">{t('res.echo')}</span>
        {d && <SourceTag live={d.source === 'gemini'}>{t(`res.source.${d.source}` as StringKey)}</SourceTag>}
      </div>
      <p className="mt-1.5 min-h-[44px] text-[15px] leading-snug text-bone/90">
        {d ? <Typed key={state!.key} text={d.text} animate={state!.fresh} /> : <span className="anim-pulse text-mist">···</span>}
      </p>
    </section>
  );
}

/** Types the line out (instantly under "reduce motion"); the full text is in the DOM for screen readers. */
function Typed({ text, animate }: { text: string; animate: boolean }) {
  const reduceMotion = useSettings((s) => s.reduceMotion);
  const [n, setN] = useState(animate && !reduceMotion ? 0 : text.length);
  useEffect(() => {
    if (n >= text.length) return;
    const id = window.setTimeout(() => setN((v) => Math.min(text.length, v + 1)), 22);
    return () => window.clearTimeout(id);
  }, [n, text]);
  return (
    <>
      <span>{text.slice(0, n)}</span>
      {n < text.length && <span aria-hidden className="anim-caret text-blood">▌</span>}
      <span className="text-transparent">{text.slice(n)}</span>
    </>
  );
}
