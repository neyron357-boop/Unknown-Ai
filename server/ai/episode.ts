import { z } from 'zod';
import { LINE_BY_ID } from '../../src/voice/lines';
import { EPISODE_LIMITS, type EpisodeLines, type EpisodeProfile, type EpisodeResponse } from '../../shared/episode';
import { GeminiError } from './gemini';
import { generateUrl } from './geminiAudio';
import { sanitizeLine } from './mentor';

/**
 * Personalised pre-fight lines. VERDICT mocks the player's *actual* weaknesses (taken from a
 * numeric/enum profile — no free text from the client reaches the model); ECHO gives one cold,
 * concrete hint. Gemini writes JSON against a response schema; output is validated and sanitised.
 */

export const DEFAULT_EPISODE_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];

const count = z.number().int().min(0).max(1_000_000);
export const episodeProfileSchema = z.object({
  lang: z.enum(['ru', 'en']),
  mode: z.enum(['spark', 'flow', 'calm']),
  runs: count.default(0),
  lastGrade: z.enum(['S', 'A', 'B', 'C']).nullable().default(null),
  weakestEnemy: z.enum(['grunt', 'brute', 'dodger', 'feinter', 'leaper', 'crawler', 'gunner']).nullable().default(null),
  timingBias: z.enum(['early', 'late', 'centered']).nullable().default(null),
  fooledByFeints: count.default(0),
  execAccuracy: z.number().min(0).max(1).nullable().default(null),
  bestCombo: count.default(0),
});

// Compile-time guarantee that the validated shape matches the shared client type.
type Assert<T extends true> = T;
type Parsed = z.infer<typeof episodeProfileSchema>;
export type _EpisodeSchemaMatchesShared = Assert<Parsed extends EpisodeProfile ? (EpisodeProfile extends Parsed ? true : false) : false>;

export interface EpisodeModel {
  readonly models: readonly string[];
  /** Throws when every model fails; the route then answers with the demo episode. */
  generate(profile: EpisodeProfile, signal?: AbortSignal): Promise<EpisodeLines>;
}

const ENEMY = {
  ru: {
    grunt: 'рядовые бойцы (обычные удары)',
    brute: 'громилы в броне (нужно два удара)',
    dodger: 'увёртливые (меняют сторону перед ударом)',
    feinter: 'финтёры (ложные замахи — белые глаза)',
    leaper: 'прыгуны (атака сверху)',
    crawler: 'ползуны (атака снизу)',
    gunner: 'стрелки (пулю надо отбить в сторону стрелка)',
  },
  en: {
    grunt: 'grunts (plain strikes)',
    brute: 'armored brutes (two cuts needed)',
    dodger: 'dodgers (switch sides before the hit)',
    feinter: 'feinters (fake swings — white eyes)',
    leaper: 'leapers (attack from above)',
    crawler: 'crawlers (attack from below)',
    gunner: 'gunners (deflect the bullet back toward the shooter)',
  },
} as const;
const TIMING = {
  ru: { early: 'режет РАНЬШЕ бита', late: 'режет ПОЗЖЕ бита', centered: 'попадает точно в бит' },
  en: { early: 'cuts BEFORE the beat', late: 'cuts AFTER the beat', centered: 'cuts right on the beat' },
} as const;
const MODE = {
  ru: { spark: 'ИСКРА (быстро и ярко)', flow: 'ПОТОК', calm: 'ТИШИНА (медленный бит)' },
  en: { spark: 'SPARK (fast and bright)', flow: 'FLOW', calm: 'CALM (slower beat)' },
} as const;

const SYSTEM_RU = `Ты — сценарист тёмного кинематографичного экшена 18+ «UNKNOWN: ASCENSION»: дуэль на мечах в ритме музыки, ночной город, кровавая луна.
Пиши реплики двух персонажей:
- ВЕРДИКТ — босс, демонический палач. Медленный низкий бас, холодное презрение. Издевается над КОНКРЕТНЫМИ слабостями игрока из фактов (например: «Ты всегда режешь раньше бита»).
- ЭХО — холодный голос в голове героя. Коротко и точно, без эмоций: один конкретный совет против главной слабости.
Правила:
- Только русский язык. Короткие рубленые фразы, как в трейлере. Без эмодзи, markdown, кавычек, ремарок в скобках и имён персонажей.
- Жёстко и по-взрослому: угроза, кровь, смерть, презрение — можно. Нельзя: мат, оскорбления по национальности, полу, ориентации, внешности, здоровью; реальные люди, бренды, политика; диагнозы и медицинские утверждения; призывы к реальному насилию или самоповреждению.
- Используй только факты из запроса. Не выдумывай числа.
- Лимиты: title ≤ 40 символов (название эпизода, без слова «Эпизод»); bossIntro ≤ 140; ровно три bossTaunts, каждая ≤ 70; bossWhisper ≤ 120 (шёпот прямо игроку по ту сторону экрана); echoIntro ≤ 140.`;

const SYSTEM_EN = `You write for UNKNOWN: ASCENSION, a dark cinematic 18+ action game: a sword duel fought to the beat, a night city, a blood moon.
Write lines for two characters:
- VERDICT — the boss, a demonic executioner. Slow, low bass voice, cold contempt. He mocks the player's SPECIFIC weaknesses from the facts (e.g. "You always cut before the beat").
- ECHO — a cold voice inside the hero's head. Short, precise, emotionless: one concrete tip against the main weakness.
Rules:
- English only. Short, clipped, trailer-style sentences. No emoji, markdown, quotes, stage directions in brackets or character names.
- Brutal and adult: threats, blood, death and contempt are fine. Not allowed: profanity, slurs about nationality, gender, orientation, looks or health; real people, brands, politics; diagnoses or medical claims; calls for real-world violence or self-harm.
- Use only the facts given. Never invent numbers.
- Limits: title ≤ 40 chars (episode name, without the word "Episode"); bossIntro ≤ 140; exactly three bossTaunts, each ≤ 70; bossWhisper ≤ 120 (whispered straight at the player behind the screen); echoIntro ≤ 140.`;

export function buildEpisodePrompt(p: EpisodeProfile): { system: string; prompt: string } {
  const ru = p.lang === 'ru';
  const na = ru ? 'нет данных' : 'no data';
  const facts = ru
    ? [
        `- завершённых забегов (включая смерти): ${p.runs}`,
        `- последняя оценка: ${p.lastGrade ?? na}`,
        `- режим: ${MODE.ru[p.mode]}`,
        `- главная слабость — враги: ${p.weakestEnemy ? ENEMY.ru[p.weakestEnemy] : na}`,
        `- тайминг: ${p.timingBias ? TIMING.ru[p.timingBias] : na}`,
        `- раз поддался на финт: ${p.fooledByFeints}`,
        `- точность казни: ${p.execAccuracy === null ? na : `${Math.round(p.execAccuracy * 100)}%`}`,
        `- лучшее комбо: ${p.bestCombo}`,
      ]
    : [
        `- runs finished (deaths included): ${p.runs}`,
        `- last grade: ${p.lastGrade ?? na}`,
        `- mode: ${MODE.en[p.mode]}`,
        `- main weakness — enemies: ${p.weakestEnemy ? ENEMY.en[p.weakestEnemy] : na}`,
        `- timing: ${p.timingBias ? TIMING.en[p.timingBias] : na}`,
        `- times fooled by a feint: ${p.fooledByFeints}`,
        `- execution accuracy: ${p.execAccuracy === null ? na : `${Math.round(p.execAccuracy * 100)}%`}`,
        `- best combo: ${p.bestCombo}`,
      ];
  const ask = ru
    ? 'Факты об игроке перед боем с ВЕРДИКТОМ:\n'
    : 'Facts about the player before the fight with VERDICT:\n';
  const tail = ru
    ? '\nВерни JSON: title, bossIntro, bossTaunts (ровно 3), bossWhisper, echoIntro.'
    : '\nReturn JSON: title, bossIntro, bossTaunts (exactly 3), bossWhisper, echoIntro.';
  return { system: ru ? SYSTEM_RU : SYSTEM_EN, prompt: ask + facts.join('\n') + tail };
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    bossIntro: { type: 'STRING' },
    bossTaunts: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 3, maxItems: 3 },
    bossWhisper: { type: 'STRING' },
    echoIntro: { type: 'STRING' },
  },
  required: ['title', 'bossIntro', 'bossTaunts', 'bossWhisper', 'echoIntro'],
  propertyOrdering: ['title', 'bossIntro', 'bossTaunts', 'bossWhisper', 'echoIntro'],
};

const rawEpisodeSchema = z.object({
  title: z.string(),
  bossIntro: z.string(),
  bossTaunts: z.array(z.string()).min(1).max(6),
  bossWhisper: z.string(),
  echoIntro: z.string(),
});

const BANNED = /(^|[^\p{L}])(х[уy][йяеёию]|пизд|[её]б[аеиуоыё]|бля|сука|fuck|cunt|nigg|fag)/iu;

/** Speakable plain text: no stage directions, names, markdown or quotes; length-capped. */
export function cleanSpeakable(s: string, max: number): string {
  const out = sanitizeLine(
    s
      .replace(/\([^)]*\)|\[[^\]]*\]|\*[^*]*\*/g, ' ')
      .replace(/^\s*(ВЕРДИКТ|ЭХО|VERDICT|ECHO)\s*[:—-]\s*/i, '')
      .replace(/[\u0000-\u001f\u007f]/g, ' '),
    max,
  );
  return out.length > max ? out.slice(0, max - 1).trimEnd() + '…' : out;
}

/** Validates + sanitises model output; unusable fields are filled from the demo episode. */
export function sanitizeEpisode(raw: unknown, fallback: EpisodeLines): { lines: EpisodeLines; complete: boolean } | null {
  const parsed = rawEpisodeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  let complete = true;
  const field = (v: string, max: number, fb: string) => {
    const c = cleanSpeakable(v, max);
    if (c.length < 2 || BANNED.test(c)) {
      complete = false;
      return fb;
    }
    return c;
  };
  const taunts = r.bossTaunts.map((t, i) => field(t, EPISODE_LIMITS.taunt, fallback.bossTaunts[i % fallback.bossTaunts.length])).slice(0, 3);
  while (taunts.length < 3) {
    complete = false;
    taunts.push(fallback.bossTaunts[taunts.length]);
  }
  const lines: EpisodeLines = {
    title: field(r.title.replace(/^(эпизод|episode)\s*[^:.]*[:.]\s*/i, ''), EPISODE_LIMITS.title, fallback.title),
    bossIntro: field(r.bossIntro, EPISODE_LIMITS.line, fallback.bossIntro),
    bossTaunts: taunts,
    bossWhisper: field(r.bossWhisper, EPISODE_LIMITS.line, fallback.bossWhisper),
    echoIntro: field(r.echoIntro, EPISODE_LIMITS.line, fallback.echoIntro),
  };
  return { lines, complete };
}

// ---------------------------------------------------------------- demo (static bank)

const ECHO_FOR_ENEMY: Record<NonNullable<EpisodeProfile['weakestEnemy']>, string> = {
  grunt: 'e_swipe',
  brute: 'e_brute',
  dodger: 'e_dodger',
  feinter: 'e_feint',
  leaper: 'e_leaper',
  crawler: 'e_crawler',
  gunner: 'e_gunner',
};

/**
 * Deterministic episode built from the pre-voiced bank (src/voice/lines.ts): used without a key,
 * on model failure and when rate-limited. `bankIds` lets the client play the static audio.
 */
export function demoEpisode(p: EpisodeProfile): EpisodeLines & { bankIds: NonNullable<EpisodeResponse['bankIds']> } {
  const say = (id: string) => (p.lang === 'ru' ? LINE_BY_ID[id].ru : LINE_BY_ID[id].en);
  const intro = p.runs % 2 === 0 ? 'v_intro1' : 'v_intro2';
  const taunts: string[] = [];
  if (p.timingBias === 'late') taunts.push('v_miss1');
  else if (p.timingBias === 'early' || p.fooledByFeints > 2) taunts.push('v_miss4');
  taunts.push('v_miss2');
  if (p.lastGrade === 'S' || p.lastGrade === 'A') taunts.push('v_perfect2');
  for (const id of ['v_miss3', 'v_perfect1', 'v_miss1', 'v_miss4']) if (taunts.length < 3 && !taunts.includes(id)) taunts.push(id);
  const whisper = p.runs >= 3 ? 'v_whisper3' : p.runs % 2 === 0 ? 'v_whisper1' : 'v_whisper2';
  const echo = p.weakestEnemy
    ? ECHO_FOR_ENEMY[p.weakestEnemy]
    : p.timingBias === 'early' || p.timingBias === 'late'
      ? 'e_beat'
      : p.execAccuracy !== null && p.execAccuracy < 0.6
        ? 'e_exec'
        : 'e_duel';
  // "Эпизод первый. Кровавая луна." → "Кровавая луна"
  const title = say('n_episode').split('. ').slice(1).join('. ').replace(/[.!]+$/, '') || say('n_episode');
  const bossTaunts = taunts.slice(0, 3);
  return {
    title,
    bossIntro: say(intro),
    bossTaunts: bossTaunts.map(say),
    bossWhisper: say(whisper),
    echoIntro: say(echo),
    bankIds: { bossIntro: intro, bossTaunts, bossWhisper: whisper, echoIntro: echo },
  };
}

// ---------------------------------------------------------------- Gemini

function responseText(json: unknown): string {
  const parts = (json as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
}

export function createEpisodeModel(apiKey: string, models: string[] = DEFAULT_EPISODE_MODELS, fetchImpl: typeof fetch = fetch): EpisodeModel {
  if (!models.length) throw new Error('createEpisodeModel: no models');
  return {
    models,
    async generate(profile, signal) {
      const { system, prompt } = buildEpisodePrompt(profile);
      const fallback = demoEpisode(profile);
      let lastError: Error = new GeminiError('No episode model available');
      for (const model of models) {
        signal?.throwIfAborted();
        try {
          const res = await fetchImpl(generateUrl(model), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 1,
                topP: 0.95,
                maxOutputTokens: 2048,
                responseMimeType: 'application/json',
                responseSchema: RESPONSE_SCHEMA,
              },
            }),
            signal,
          });
          if (!res.ok) {
            // Never echo upstream bodies; any error (429 quota, 5xx, 404) → next model.
            lastError = new GeminiError(`Gemini HTTP ${res.status} (${model})`, res.status);
            continue;
          }
          const text = responseText(await res.json());
          const out = sanitizeEpisode(JSON.parse(text), fallback);
          if (!out) {
            lastError = new GeminiError(`Invalid episode JSON (${model})`);
            continue;
          }
          return out.lines;
        } catch (err) {
          if (signal?.aborted) throw err;
          lastError = err instanceof GeminiError ? err : new GeminiError(`Episode generation failed (${model}): ${(err as Error).name}`);
        }
      }
      throw lastError;
    },
  };
}
