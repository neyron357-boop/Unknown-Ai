# Voice system

Characters speak Russian lines (RU/EN subtitles) with deep, brutal voices: generated
offline with Gemini TTS, shipped as small static MP3s, played in the client through cheap
per-character Web Audio FX. Personalised lines (VERDICT mocking *your* weaknesses) come from
two server endpoints. The Gemini key lives only in `.env` and is only used by Node.

| Piece | File |
| --- | --- |
| Line bank (source of truth: ids, cues, speakers, voices, delivery directions) | `src/voice/lines.ts` |
| Generator (TTS → split → QA → ffmpeg → `public/voice/`) | `scripts/voice/generate.ts` (+ `gemini.ts`, `audio.ts`, `qa.ts`) |
| Static bank | `public/voice/<id>.mp3` + `public/voice/manifest.json` |
| Player (priorities, FX, ducking, subtitles) | `src/voice/VoiceManager.ts` |
| Client helpers for dynamic lines | `src/voice/dynamic.ts` |
| Server: TTS / episode / routes | `server/ai/tts.ts`, `server/ai/episode.ts`, `server/ai/voice.ts`, `server/app.ts` |
| Shared types | `shared/episode.ts` |

## Generating the bank

```bash
npm run voice:gen                                # everything missing, priority order
npm run voice:gen -- --only v_miss2,e_feint      # just these
npm run voice:gen -- --only v_miss2 --retake     # fresh take from the API (costs 1 request)
npm run voice:gen -- --force                     # re-run ffmpeg on cached audio (free)
npm run voice:gen -- --variants                  # + alt-voice grunts (g_charge1@Algieba …)
npm run voice:gen -- --qa-only | --no-qa | --dry-run | --batch 1 | --max-requests 5 | --debug
```

Order when quota is tight: narrator → VERDICT → ECHO hints → ECHO barks → cameos → grunts →
chants → ECHO results → variants.

**One request per batch.** Lines of the same speaker go into one TTS request (≤ 6 lines), using
Gemini's structured prompt (`# AUDIO PROFILE` / `### DIRECTOR'S NOTES` / `#### TRANSCRIPT`)
with "two seconds of silence between lines". Lines with their own `style` get per-line delivery
notes in the director's notes. Then:

1. **Silence split**: pauses ≥ 1 s must give exactly *n* segments with plausible lengths;
   the clips are transcribed (QA) right away.
2. **ASR alignment** when (1) fails (slow, menacing voices pause everywhere): the take is cut at
   every pause ≥ 0.28 s, all chunks are transcribed in one text request, and a DP groups
   chunks into lines, skipping junk. The model sometimes improvises an English monologue or
   repeats the whole batch; alignment ignores that.
3. Lines that still don't match get one request each.

Never use a bare `"<long English direction>: <line>"` prompt: with descriptive styles the model
reads the direction aloud (14–20 s clips for one word). `ttsPrompt()` / `ttsBatchPrompt()` in
`server/ai/geminiAudio.ts` produce the safe format; the server uses the same one.

**Post-processing** (`audio.ts`): trim silence (keep 30 ms), loudness-normalise (two-pass
`loudnorm` to −16 LUFS / TP −1.5 dB; RMS gain + limiter for clips under 0.9 s), mono 24 kHz
MP3 56 kbps (`libmp3lame`; AAC `.m4a` if missing).

**QA** (`qa.ts`): clips are transcribed blind by a text model (8 per request, JSON array) and
compared after normalising case, punctuation, `ё`, stutters and elongations. Similarity < 0.8 →
one fresh take; < 0.5 after that → rejected (moved to `.cache/voice/rejected/`, not in the
manifest). Screams, laughs and chants (`noSubtitle`) are exempt. The model also describes each
voice; the run prints that for VERDICT and the narrator.

**Caching & quota.** Every successful API response is cached under `.cache/voice/resp/`,
keyed by `sha256(model, voice, prompt[, take])`. Lookups check every model in the list, so
re-runs never pay twice. On a 429 the error body names the quota:
- per-day → the model is parked until the time the API advises (persisted in
  `.cache/voice/quota.json`) and the next model is used;
- per-minute → wait the advised delay (≤ 65 s); learned RPM limits pace later calls.

A `SAFETY` refusal gets one try on the next model, then the batch is split in halves.
State: `.cache/voice/state.json` (per-line model, take, QA transcript); `.cache/voice/last-run.json`.

Models: `GEMINI_TTS_MODELS` (default `gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts,
gemini-3.1-flash-tts-preview, gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts`),
`GEMINI_QA_MODELS` (default `gemini-3.5-flash, gemini-3.8-flash, gemini-3.5-flash-lite,
gemini-flash-lite-latest`).

### Free-tier limits observed (2026-10-09)

| Model | Per day | Per minute |
| --- | --- | --- |
| gemini-3.8-flash-tts | 10 | — |
| gemini-3.8-flash-lite-tts | 10 | 3 |
| gemini-3.1-flash-tts-preview | 10 | 3 (also refuses some violent batches: `SAFETY`) |
| gemini-2.5-flash-preview-tts | ≥ 10 | — |
| gemini-3.5-flash (text/QA) | 20 | — |

Per-day quotas reset at **00:00 UTC**, judging by the API's advised retry delays (not PT
midnight). With batching the whole 82-line bank costs about 25 TTS requests plus about 20
text requests.

## Playback — `VoiceManager`

```ts
import { VoiceManager } from '@/voice/VoiceManager';

const voice = new VoiceManager({
  getContext: () => engine.context,              // AudioContext | null (created on first gesture)
  output: () => engine.voiceInput ?? null,       // optional; defaults to ctx.destination
  onSubtitle: (s) => hud.subtitle(s),            // { ru, en, speaker, durMs, id }
  duck: (amount, ms) => engine.duckMusic(amount, ms), // music gain × (1 − amount) for ms
});
void voice.load();                 // manifest now, decodes narrator / boss.intro / ECHO hints in background
voice.play('boss.miss');           // random, cycles through all lines before repeating → { id, durMs } | null
voice.play('narr.boss', { interrupt: true });
voice.playLine('v_whisper3', { delayMs: 400 });
voice.has('grunt.death');
voice.setVolume(0.8); voice.setEnabled(false); voice.stopAll(); voice.busyMs();
const chops = await voice.getChantBuffers();      // { ch_hey: AudioBuffer, … } for the music engine
```

Rules:
- Priority: narrator / verdict / cameos 3, echo 2, grunt 1, chant 0 (`opts.priority` overrides).
- Lines with priority ≥ 2 never overlap: a new line waits up to 1.2 s for the current one,
  otherwise it is dropped. With `interrupt`, the old line fades out in 80 ms instead.
- Grunts may overlap each other (max 2) and are dropped while a priority-3 line plays.
- Priority ≥ 2 lines call `duck(0.55, durMs)`; subtitles come from `LINE_BY_ID`
  (`noSubtitle` lines are skipped).
- A line that is not decoded yet plays only if decoding finishes within about 300 ms of its
  planned start. `play()` returns a tentative handle in that case. Every clip is prefetched in
  the background, so this is rare.
- Missing manifest or files: everything is a silent no-op. `play()` returns `null` while the
  context isn't `running`.
- Offline: clips are mirrored in Cache Storage (`unknown-voice-<generatedAt>`). For an
  offline-first install, also precache them in the PWA: add `mp3,json` to
  `workbox.globPatterns` in `vite.config.ts`, or add a `CacheFirst` runtime route for `/voice/`.
- The single-file build resolves `./voice/…` relative to the page (`BASE_URL` is `./`), so host
  `public/voice/` next to the HTML.

FX (per playback, native nodes; the reverb impulse is generated once per context;
`VOICE_FX` is exported for tuning):

| Speaker | Rate | EQ | Saturation | Reverb | Pan |
| --- | --- | --- | --- | --- | --- |
| verdict | 0.86 | HP 38 Hz, low shelf +9 dB @ 140, +2 dB @ 2.6 kHz | 0.35 | hall 0.35 | — |
| narrator | 0.9 | HP 38, low shelf +7 dB @ 140, +1.5 dB @ 3 kHz | — | hall 0.25 | — |
| echo | 1.0 | HP 180 Hz, high shelf +3 dB @ 5 kHz | — | room 0.15 | alternates ±0.2 |
| cleaner | 0.92 | low shelf +6 dB @ 150 | — | room 0.06 | — |
| butcher | 0.97 | — | 0.5 | room 0.1 | — |
| ronin | 0.9 | low shelf +7 dB @ 140 | — | hall 0.2 | — |
| fox | 0.97 | — | — | room 0.05 | — |
| grunt | random 0.85–1.05 | — | 0.25 | room 0.08 | random ±0.5 |
| chant | 1.0 | dry | — | — | — |

Saturation is parallel (`tanh` WaveShaper, 2× oversampling). The voice bus ends in a gentle
limiter (−6 dB, ratio 12) and then the volume control.

Ear-proxy check: an ffmpeg render of the chain, described by `gemini-3.8-flash`.
- VERDICT: raw "low, dry, gritty, menacing" (scary 6/10) becomes "very low, pitch-shifted demonic growl,
  cavernous sub-bass and reverb; monstrous, terrifying" (9/10).
- Narrator at 0.9 / +7 dB: "very low, deep pitch-shifted growl, ominous cinematic trailer
  narration" (7/10). The spec's 0.94 / +6 dB only read as "low" (5/10).
- ECHO: "whispered female inner voice, stereo-widened and filtered; eerie, intimate".

All processed clips stayed intelligible (exact transcripts).

Tests: `npm run test:voice` (fake AudioContext; `src/voice/VoiceManager.test.ts`).

## Dynamic lines (server)

| Route | Body | Answer |
| --- | --- | --- |
| `POST /api/ai/episode` | `{ lang, mode, runs, lastGrade, weakestEnemy, timingBias, fooledByFeints, execAccuracy, bestCombo }` (numbers / enums only) | `{ title, bossIntro, bossTaunts[3], bossWhisper, echoIntro, source: 'gemini'\|'demo'\|'fallback', bankIds? }` |
| `POST /api/ai/voice` | `{ speaker, text ≤ 140 }` | `audio/wav` (24 kHz mono) |

- Episode: `gemini-3.5-flash` writes JSON against a response schema, falling back to
  `gemini-3.5-flash-lite`. Output is validated and sanitised: length caps, stage directions and
  quotes stripped, profanity replaced. The demo / fallback episode is assembled from the static
  bank and carries `bankIds`, so the client can play the pre-voiced clips. Rate limit is the
  same as the mentor (12/min/IP); a 429 still carries demo lines plus `retryAfter`.
  Timeout 7 s.
- Voice: same voice and direction as the static bank; disk cache `.cache/voice-dyn/` keyed by
  hash; identical concurrent requests share one upstream call. Limits: 6/min/IP (cache hits are
  free), `VOICE_DAILY_LIMIT` per server. Errors: 503 `{error:'demo'}` without a key,
  429 `{error:'rate_limited'|'quota'|'daily_limit', retryAfter}`, 504 `{error:'timeout'}` after
  11 s (the call continues in the background and is cached, so retry), 502 `{error:'upstream'}`.
  TTS models fall back on a per-day (and per-minute) 429.
- `GET /api/ai/status` → `{ mode, model, voice: 'live'|'demo', episode: 'live'|'demo' }`.
- Env: `GEMINI_API_KEY`, `GEMINI_TTS_MODELS`, `GEMINI_EPISODE_MODELS`, `VOICE_RATE_LIMIT_PER_MIN`,
  `VOICE_DAILY_LIMIT`, `VOICE_CACHE_DIR` (see `.env.example`).

Client (`src/voice/dynamic.ts`): `fetchEpisode(profile)` (8 s) and `fetchVoice(speaker, text)`
(12 s) resolve to `null` in the single-file build, without a server, in demo mode or after a
failure (they then back off instead of waiting again). `playEpisodeLine(voice, episode, field,
{ index, audio })` plays the bank clip, the fetched dynamic audio, or a generic cue.
A TTS call takes about 8 s and the free tier allows about 10 per model per day. Fetch only
the one or two lines that matter (intro, whisper) during the pre-fight intro; taunts can stay
text plus bank barks.

In local dev behind a proxy, Node's `fetch` may need `NODE_USE_ENV_PROXY=1`.
