// End-to-end smoke test of v3 in a mobile-sized Chromium: the 18+ gate, the first tap that unlocks
// audio, real touch swipes reaching the director, then a bot that plays the whole fight (waves,
// cameo, boss duel, execution) on the beat, the results screen with ECHO's debrief and the
// progress screen. Gemini endpoints are mocked, so no quota is spent.
// Requires the dev server (`npm run dev`) — it uses the dev-only hooks window.__SESSION__ etc.
// Usage: npm run e2e            (BASE_URL defaults to http://localhost:5173)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
let failed = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✓' : '  ✗', msg);
  if (!cond) failed++;
};

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const aiCalls = [];
await page.route('**/api/ai/**', (route) => {
  const url = route.request().url();
  aiCalls.push(url.slice(url.indexOf('/api/')));
  if (url.endsWith('/status')) return route.fulfill({ json: { mode: 'demo', voice: 'demo', episode: 'demo' } });
  if (url.endsWith('/mentor')) return route.fulfill({ json: { text: 'Чистая работа. Дальше — быстрее.', source: 'demo' } });
  return route.fulfill({ status: 503, json: { error: 'demo' } });
});

await page.goto(BASE);
await page.evaluate(() => {
  localStorage.clear();
  indexedDB.deleteDatabase('unknown-ascension');
});
await page.reload();

// 1) 18+ gate → title → straight into the first fight (two taps)
await page.getByRole('button', { name: 'Мне есть 18 — в бой' }).waitFor();
check((await page.evaluate(() => window.__UNKNOWN_AUDIO__?.state)) === 'none', 'no audio before the first gesture');
await page.getByRole('button', { name: 'Мне есть 18 — в бой' }).click();
await page.getByRole('button', { name: 'Коснись — луна ждёт' }).waitFor();
await page.waitForTimeout(800);
await page.mouse.click(195, 600);
await page.waitForFunction(() => !!window.__SESSION__, null, { timeout: 20000 });
check((await page.evaluate(() => window.__UNKNOWN_AUDIO__?.state)) === 'running', 'audio unlocked by the first taps');
check(true, '18+ gate → title → fight in two taps');

// 2) Real touch swipes on the arena → slashes reach the director
await page.evaluate(() => {
  const d = window.__SESSION__.director;
  window.__dirs = [];
  const orig = d.input.bind(d);
  d.input = (dir, t) => {
    window.__dirs.push(dir);
    return orig(dir, t);
  };
});
const swipe = (dx, dy) =>
  page.evaluate(
    ([dx, dy]) => {
      const el = document.querySelector('[data-testid=arena]');
      const r = el.getBoundingClientRect();
      const ev = (type, x, y) =>
        el.dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true, isPrimary: true }));
      ev('pointerdown', 195, 560);
      ev('pointermove', 195 + dx * 0.5, 560 + dy * 0.5);
      ev('pointermove', 195 + dx, 560 + dy);
      ev('pointerup', 195 + dx, 560 + dy);
    },
    [dx, dy],
  );
for (const [dx, dy] of [[-90, 0], [90, 0], [0, -90], [0, 90]]) {
  await swipe(dx, dy);
  await page.waitForTimeout(200);
}
const dirs = await page.evaluate(() => window.__dirs.splice(0));
check(JSON.stringify(dirs) === JSON.stringify(['left', 'right', 'up', 'down']), `swipes ← → ↑ ↓ recognised: ${dirs.join(', ')}`);

// 3) Bot: the director is stepped in 16 ms slices and every real note is answered at its exact
// beat (in the direction the player sees), so the run is frame-rate independent on a
// software-rendered headless browser. Feints are left alone; the execution is repeated.
await page.evaluate(() => {
  const d = window.__SESSION__.director;
  const OPP = { left: 'right', right: 'left', up: 'up', down: 'down' };
  const pending = [];
  const exec = [];
  window.__bot = { segments: [], kills: 0, boss: [] };
  const answer = (at, dir) => pending.push({ at, fn: () => d.input(d.isMirrored(at) && (dir === 'left' || dir === 'right') ? OPP[dir] : dir, at) });
  const orig = d.update.bind(d);
  d.update = (dt) => {
    while (dt > 0) {
      const step = Math.min(16, dt);
      orig(step);
      dt -= step;
      const now = d.getNow();
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= now) pending.splice(i, 1)[0].fn();
    }
  };
  d.on((e) => {
    if (e.type === 'segment') window.__bot.segments.push(e.id);
    if (e.type === 'kill' && e.by === 'hero') window.__bot.kills++;
    if (e.type === 'boss') window.__bot.boss.push(e.phase);
    if (e.type === 'spawn') for (const n of e.enemy.notes) if (!n.feint && !n.assist) answer(n.at, n.dir);
    if (e.type === 'bossMove' && !e.note.feint) answer(e.note.at, e.note.dir);
    if (e.type === 'execShow') exec[e.index] = e.dir;
    if (e.type === 'execPerform') exec.forEach((dir, i) => answer(e.at + i * d.beatMs, dir));
  });
});

const deadline = Date.now() + 10 * 60_000;
let lastLog = Date.now();
while (Date.now() < deadline) {
  if (await page.getByRole('button', { name: /Ещё раз/ }).isVisible().catch(() => false)) break;
  if (Date.now() - lastLog > 30_000) {
    lastLog = Date.now();
    const st = await page.evaluate(() => {
      const d = window.__SESSION__?.director;
      return d ? `${d.getPhase()} · ${d.getSegment().id} · t=${Math.round(d.getNow() / 1000)}s` : 'no session';
    });
    console.log('    …', st);
  }
  await page.waitForTimeout(500);
}
await page.getByRole('button', { name: /Ещё раз/ }).waitFor({ timeout: 10_000 });
const bot = await page.evaluate(() => window.__bot);
const acts = ['roofA', 'fall', 'trainA', 'cameo', 'bossIntro', 'duel', 'rage', 'exec', 'finale'];
check(acts.every((a) => bot.segments.includes(a)), `whole mission played: ${bot.segments.join(' → ')}`);
check(bot.kills >= 40, `enemies cut down by the hero: ${bot.kills}`);
check(bot.boss.includes('dead'), `boss killed (${bot.boss.join(', ')})`);
await page.waitForTimeout(2500);
const text = await page.locator('body').innerText();
const acc = Number(/Точность\s+(\d+)%/.exec(text)?.[1] ?? -1);
check(acc >= 95, `bot accuracy recorded: ${acc}%`);
const run = await page.evaluate(() => window.__APP__.getState().lastRun);
check(run?.result.grade === 'S', `grade for a flawless bot: ${run?.result.grade}`);
check(/ЭХО/.test(text) && text.includes('Чистая работа'), 'ECHO debrief shown');
await page.getByRole('button', { name: /Прогресс/ }).click();
await page.getByRole('heading', { name: 'Прогресс' }).waitFor();
check((await page.locator('body').innerText()).includes('Боёв'), 'progress screen lists the saved run');
check(aiCalls.some((c) => c.endsWith('/mentor')), `AI endpoints called with numbers only (mocked): ${[...new Set(aiCalls)].join(', ')}`);
check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll e2e checks passed');
process.exit(failed ? 1 : 0);
