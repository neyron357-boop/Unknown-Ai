#!/usr/bin/env node
// Renders v3 music plans / SFX sequences offline in headless Chromium (through the
// audio lab page) and writes WAV + MP3 + loudness stats to .cache/audio/.
//
//   npm run audio:lab                                   # in another terminal (port 5174)
//   node scripts/audio/render.mjs mandelao drift        # presets (see PRESETS below)
//   node scripts/audio/render.mjs --all --spectro       # everything + spectrogram PNGs
//   options: --bpm 130  --seed 123  --no-chops  --chants dir/  --base http://localhost:5174
import { chromium } from 'playwright';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(REPO, '.cache/audio');
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);
const BASE = opt('--base', 'http://localhost:5174');
const BPM = Number(opt('--bpm', '130'));
const SEED = opt('--seed') ? Number(opt('--seed')) : undefined;
const CHANTS = opt('--chants');

const PRESETS = {
  mandelao: { plan: [ { id: 'intro', bars: 2, hype: 1 }, { id: 'roof', bars: 4, hype: 2 }, { id: 'roofBuild', bars: 2, hype: 3 }, { id: 'roofDrop', bars: 6, hype: 4 } ] },
  mandelaoDrop: { plan: [ { id: 'roofBuild', bars: 2, hype: 3 }, { id: 'roofDrop', bars: 12, hype: 4 } ] },
  drift: { plan: [ { id: 'train', bars: 4, hype: 2 }, { id: 'trainDrop', bars: 8, hype: 3 } ] },
  hyper: { plan: [ { id: 'boss', bars: 4, hype: 2 }, { id: 'bossRage', bars: 8, hype: 4 } ] },
  slowed: { plan: [ { id: 'bossIntro', bars: 4, hype: 1 }, { id: 'execution', bars: 4, hype: 2 } ] },
  cameo: { plan: [ { id: 'cameo', bars: 8, hype: 3 } ] },
  menu: { plan: [ { id: 'menu', bars: 8, hype: 0 } ], bpm: 100 },
  outro: { plan: [ { id: 'outro', bars: 8, hype: 1 } ], bpm: 100 },
  transitions: { plan: [ { id: 'roof', bars: 2, hype: 2 }, { id: 'fall', bars: 4 }, { id: 'train', bars: 2, hype: 2 }, { id: 'finale', bars: 5 } ] },
  busiest: { plan: [ { id: 'bossRage', bars: 16, hype: 4 } ], perf: true },
  sfxA: { sfx: ['swing', 'swingHeavy', 'whiff', 'slashFlesh', 'slashCrit', 'bloodSplash', 'bloodGush', 'boneCrack', 'decap', 'bodyFall', 'parry', 'parryPerfect', 'armorBreak'] },
  sfxB: { sfx: ['heroHit', 'heroHitHeavy', 'gunshot', 'bulletDeflect', 'chainsaw', 'dash', 'blink', 'land', 'glassCrack', 'glitch', 'thunder', 'impact'] },
  sfxC: { sfx: ['slowmoIn', 'slowmoOut', 'riser', 'subDrop', 'ui', 'uiConfirm', 'combo', 'bloodlust', 'execCut', 'execFail', 'heartbeat', 'collapse', 'trainHorn', 'tapeStop'] },
};

let names = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--bpm', '--seed', '--base', '--chants', '--solo'].includes(args[i - 1])));
if (flag('--all')) names = Object.keys(PRESETS);
if (!names.length) {
  console.log('usage: node scripts/audio/render.mjs <preset...>|--all   presets:', Object.keys(PRESETS).join(' '));
  process.exit(1);
}

function loudness(wav) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  return parseLoud(`${r.stdout ?? ''}${r.stderr ?? ''}`);
}
function parseLoud(text) {
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const I = summary.match(/I:\s+(-?[\d.]+) LUFS/);
  const LRA = summary.match(/LRA:\s+(-?[\d.]+) LU/);
  const peak = summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
  return { lufs: I ? Number(I[1]) : null, lra: LRA ? Number(LRA[1]) : null, truePeakDb: peak ? Number(peak[1]) : null };
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${BASE}/lab.html`);
await page.waitForFunction(() => window.lab?.ready, null, { timeout: 30000 });

if (CHANTS) {
  const dir = resolve(CHANTS);
  const map = {};
  for (const f of readdirSync(dir)) if (/\.(wav|mp3|ogg)$/.test(f)) map[basename(f, extname(f))] = readFileSync(join(dir, f)).toString('base64');
  const ids = await page.evaluate((m) => window.lab.loadChants(m), map);
  console.log('chants loaded:', ids.join(', '));
}

if (flag('--timing')) {
  const t = await page.evaluate(() => window.lab.timeRenderers());
  console.log(JSON.stringify(t, null, 1));
}

if (flag('--stems')) {
  // dry (no glue/clip/limiter) solo renders → integrated LUFS per stem: a numeric mix-balance check
  console.log('preset          drums    808    mel     fx    (dry LUFS)');
  for (const name of names) {
    const p = PRESETS[name];
    if (!p?.plan) continue;
    const row = [];
    for (const stem of ['drums', 'bass', 'mel', 'fx']) {
      const res = await page.evaluate(([plan, bpm, seed, solo]) => window.lab.renderPlan(plan, bpm, seed, false, solo, true), [p.plan, p.bpm ?? BPM, SEED, [stem]]);
      const wav = join(OUT, `_stem.wav`);
      writeFileSync(wav, Buffer.from(res.wav, 'base64'));
      row.push(loudness(wav).lufs);
    }
    console.log(`${name.padEnd(14)} ${row.map((v) => String(v).padStart(6)).join(' ')}`);
  }
  await browser.close();
  process.exit(0);
}

for (const name of names) {
  const p = PRESETS[name];
  if (!p) {
    console.log(`unknown preset ${name}`);
    continue;
  }
  let res;
  if (p.sfx) {
    res = await page.evaluate(([list, seed]) => window.lab.renderSfxList(list, 0.6, seed), [p.sfx, SEED]);
  } else {
    const bpm = p.bpm ?? BPM;
    const solo = opt('--solo') ? opt('--solo').split(',') : undefined;
    res = await page.evaluate(([plan, bpm, seed, noChops, solo, dry]) => window.lab.renderPlan(plan, bpm, seed, noChops, solo, dry), [p.plan, bpm, SEED, flag('--no-chops'), solo, flag('--dry')]);
  }
  const suffix = (flag('--no-chops') ? '-nochops' : CHANTS ? '-chants' : '') + (opt('--solo') ? `-solo-${opt('--solo').replace(/,/g, '+')}` : '') + (flag('--dry') ? '-dry' : '');
  const wav = join(OUT, `${name}${suffix}.wav`);
  writeFileSync(wav, Buffer.from(res.wav, 'base64'));
  const mp3 = wav.replace(/\.wav$/, '.mp3');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3]);
  if (flag('--spectro')) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-lavfi', 'showspectrumpic=s=1400x500:legend=1:scale=log:color=intensity', wav.replace(/\.wav$/, '.png')]);
  }
  const loud = loudness(wav);
  const rtf = res.renderMs / 1000 / res.seconds;
  console.log(
    `${name.padEnd(13)} ${res.seconds.toFixed(1)}s  render ${res.renderMs.toFixed(0)}ms  RTF ${rtf.toFixed(3)} (${(1 / rtf).toFixed(1)}x)  ` +
      `peak ${res.peak.toFixed(3)} clipped ${res.clipped}  rms ${res.rmsDb.toFixed(1)}dB  LUFS ${loud.lufs}  TP ${loud.truePeakDb}dB  LRA ${loud.lra}`,
  );
  if (res.stats) console.log('   stats', JSON.stringify(res.stats));
  if (res.cues) console.log('   cues', res.cues.map((c) => `${c.name}@${c.at}s`).join(', '));
}
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
await browser.close();
