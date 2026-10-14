import { useEffect, useState } from 'react';
import type { RunSummary } from '@/cognitive/adaptation';
import { logChoice } from '@/cognitive/storage';
import type { Grade } from '@/game/v3/core/metrics';
import type { ActId, ModeId } from '@/game/v3/core/types';
import { useT, type StringKey } from '@/i18n/strings';
import { episodeProfile, useApp } from '@/state/app';
import { useSettings, type Lang } from '@/state/settings';
import { LINE_BY_ID } from '@/voice/lines';
import { Backdrop } from '../Backdrop';
import { IconBlade, IconChart, IconGear, IconPlay } from '../icons';
import { IconButton, PrimaryButton, SourceTag, press } from '../primitives';

const MODES: { id: ModeId; bpm: number }[] = [
  { id: 'spark', bpm: 128 },
  { id: 'flow', bpm: 120 },
  { id: 'calm', bpm: 100 },
];

const ACTS: { id: ActId; n: string }[] = [
  { id: 'roof', n: 'I' },
  { id: 'fall', n: 'II' },
  { id: 'train', n: 'III' },
  { id: 'temple', n: 'IV' },
];

/** Checkpoint segment → act index / label key. */
const CHECKPOINT_ACT: Record<string, number> = { roofA: 0, trainA: 2, bossIntro: 3 };
const CHECKPOINT_LABEL: Record<string, StringKey> = { roofA: 'cp.roofA', trainA: 'cp.trainA', bossIntro: 'cp.bossIntro' };

const GRADE_ORDER: Grade[] = ['C', 'B', 'A', 'S'];

/** ECHO's bank line for the next fight when there is no personalised episode (mirrors the server's demo pick). */
const ECHO_FOR_ENEMY: Record<string, string> = {
  grunt: 'e_swipe',
  brute: 'e_brute',
  dodger: 'e_dodger',
  feinter: 'e_feint',
  leaper: 'e_leaper',
  crawler: 'e_crawler',
  gunner: 'e_gunner',
};

function bankWhisper(runs: RunSummary[], lang: Lang): string {
  let id = 'e_swipe';
  if (runs.length) {
    const p = episodeProfile(runs);
    id = p.weakestEnemy
      ? ECHO_FOR_ENEMY[p.weakestEnemy]
      : p.timingBias === 'early' || p.timingBias === 'late'
        ? 'e_beat'
        : p.execAccuracy !== null && p.execAccuracy < 0.6
          ? 'e_exec'
          : 'e_duel';
  }
  const line = LINE_BY_ID[id] ?? LINE_BY_ID.e_swipe;
  return lang === 'ru' ? line.ru : line.en;
}

/** Which (fights, language) the store's episode was generated for; one request per change. */
let episodeKey = '';
let episodeInFlight: Promise<void> | null = null;

export function HubScreen() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const mode = useSettings((s) => s.mode);
  const mentor = useSettings((s) => s.mentor);
  const setSetting = useSettings((s) => s.set);
  const { checkpoint, runs, episode, go, startMission, discardCheckpoint } = useApp();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void useApp.getState().refreshAi();
  }, []);

  // Personalised lines for the next fight (Gemini via the server) — only with AI lines on.
  useEffect(() => {
    if (!mentor) return;
    const state = useApp.getState();
    const key = `${state.runs.length}:${lang}`;
    if (state.episode && episodeKey === key && !episodeInFlight) return;
    let alive = true;
    if (!episodeInFlight) {
      episodeKey = key;
      episodeInFlight = state.loadEpisode().finally(() => {
        episodeInFlight = null;
      });
    }
    setLoading(true);
    void episodeInFlight.finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [mentor, lang]);

  const pickMode = (m: ModeId) => {
    if (m === mode) return;
    setSetting('mode', m);
    setSetting('modeChosen', true);
    void logChoice({ at: Date.now(), kind: 'modeSelected', mode: m }).catch(() => undefined);
  };

  const canResume = !!checkpoint && checkpoint.mode === mode;
  const resumeAct = canResume ? (CHECKPOINT_ACT[checkpoint.segment] ?? -1) : -1;
  const resumeLabel = canResume ? t(CHECKPOINT_LABEL[checkpoint.segment] ?? 'cp.other') : '';
  const bestGrade = runs.reduce<Grade | null>((m, r) => (!m || GRADE_ORDER.indexOf(r.result.grade) > GRADE_ORDER.indexOf(m) ? r.result.grade : m), null);

  // The episode is used by the fight only while AI lines are on — show what the player will get.
  const ep = mentor ? episode : null;
  const fromGemini = ep?.source === 'gemini';
  const whisper = ep?.echoIntro || bankWhisper(runs, lang);
  const epTitle = fromGemini && ep?.title && ep.title.toLowerCase() !== t('hub.mission').toLowerCase() ? ep.title : null;
  const waiting = mentor && loading && !ep;

  return (
    <div className="app-height relative flex flex-col overflow-hidden">
      <Backdrop tone="hub" />
      <header className="safe-top safe-x relative z-10 flex items-center justify-between">
        <div className="font-cut text-[13px] tracking-[0.34em] text-bone/90">UNKNOWN</div>
        <div className="-mr-2 flex">
          <IconButton label={t('nav.stats')} onPress={() => go('stats')}>
            <IconChart />
          </IconButton>
          <IconButton label={t('nav.settings')} onPress={() => go('settings')}>
            <IconGear />
          </IconButton>
        </div>
      </header>

      <main className="safe-x relative z-10 flex flex-1 flex-col justify-end">
        {/* mission */}
        <section aria-labelledby="hub-mission">
          <div className="anim-rise font-cut text-[11px] uppercase tracking-[0.42em] text-blood">{t('hub.episode')}</div>
          <h1 id="hub-mission" className="anim-slash mt-1 font-blood text-[46px] uppercase leading-[0.95] text-bone glow-ash" style={{ animationDelay: '0.1s' }}>
            {t('hub.mission')}
          </h1>
          <div className="anim-rise mt-2 flex flex-wrap items-baseline gap-x-2 text-[12px] tracking-[0.08em] text-mist" style={{ animationDelay: '0.2s' }}>
            <span>{t('hub.duration')}</span>
            <span aria-hidden>·</span>
            <span>{t('hub.acts')}</span>
            {bestGrade && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {t('hub.best')} <span className="font-cut text-[14px] text-bone">{bestGrade}</span>
                </span>
              </>
            )}
          </div>
          <ol className="anim-rise mt-4 grid grid-cols-4 border-t border-white/10" style={{ animationDelay: '0.25s' }}>
            {ACTS.map((a, i) => (
              <li key={a.id} className={`relative pt-2 pr-1 ${i === resumeAct ? 'text-bone' : 'text-bone/60'}`}>
                <span aria-hidden className={`absolute -top-px left-0 h-[2px] ${i === resumeAct ? 'w-full bg-blood' : 'w-5 bg-blood/70'}`} />
                <span className="block font-cut text-[11px] tracking-[0.12em] text-blood/90">{a.n}</span>
                <span className="block truncate text-[12px] uppercase tracking-[0.06em]">{t(`act.${a.id}` as StringKey)}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* ECHO — the cold whisper before the fight */}
        <section aria-live="polite" className="anim-rise mt-5 border-l-2 border-blood/70 pl-3.5" style={{ animationDelay: '0.35s' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="font-glitch text-[13px] tracking-[0.3em] text-blood">{t('hub.echo')}</span>
              {epTitle && <span className="truncate font-cut text-[11px] uppercase tracking-[0.14em] text-bone/70">« {epTitle} »</span>}
            </div>
            {!waiting && <SourceTag live={fromGemini}>{fromGemini ? t('hub.source.gemini') : t('hub.source.bank')}</SourceTag>}
          </div>
          <p key={whisper} className={`mt-1.5 min-h-[42px] text-[15px] italic leading-snug text-bone/85 ${waiting ? '' : 'anim-whisper'}`}>
            {waiting ? <span className="anim-pulse not-italic text-mist">···</span> : whisper}
          </p>
        </section>

        {/* mode */}
        <div role="radiogroup" aria-label={t('hub.mode')} className="anim-rise mt-5 grid grid-cols-3 gap-2" style={{ animationDelay: '0.45s' }}>
          {MODES.map(({ id, bpm }) => {
            const on = id === mode;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={press(() => pickMode(id))}
                className={`cut-corners-sm focus-inset flex min-h-[88px] flex-col items-start border px-2.5 py-2 text-left transition active:scale-[0.97] ${
                  on ? 'border-blood/70 bg-blood/[0.14] shadow-[inset_0_0_28px_rgba(255,42,68,0.18)]' : 'border-white/10 bg-black/45'
                }`}
              >
                <span className={`font-cut text-[13px] tracking-[0.12em] ${on ? 'text-bone' : 'text-bone/65'}`}>{t(`mode.${id}` as StringKey)}</span>
                <span className={`mt-1 text-[12px] font-semibold ${on ? 'text-blood' : 'text-bone/55'}`}>{bpm} BPM</span>
                <span className="mt-0.5 text-[11px] leading-tight text-mist">{t(`mode.${id}.d` as StringKey)}</span>
              </button>
            );
          })}
        </div>
        {checkpoint && !canResume && (
          <p className="mt-2 text-[11px] text-mist">
            {t('hub.savedIn')} {t(`mode.${checkpoint.mode}` as StringKey)}
          </p>
        )}
      </main>

      <footer className="safe-x safe-bottom relative z-10 pb-2 pt-4">
        <p className="mb-3 text-center text-[12px] tracking-[0.04em] text-bone/70">{t('hub.hint')}</p>
        {canResume ? (
          <>
            <PrimaryButton onPress={() => startMission(true)}>
              <IconPlay size={16} />
              {t('hub.continue')}
              <span className="text-[12px] tracking-[0.14em] text-bone/80">· {resumeLabel}</span>
            </PrimaryButton>
            <button
              type="button"
              onClick={press(() => {
                void discardCheckpoint();
                startMission(false);
              })}
              className="focus-bone mx-auto mt-1 block h-11 px-4 text-[13px] text-mist underline decoration-white/20 underline-offset-4"
            >
              {t('hub.restart')}
            </button>
          </>
        ) : (
          <PrimaryButton onPress={() => startMission(false)}>
            <IconBlade size={20} />
            {t('hub.play')}
          </PrimaryButton>
        )}
      </footer>
    </div>
  );
}
