// End-to-end smoke test: real DOM gestures, then a scripted bot plays the whole duel
// in a mobile-sized Chromium, through upgrades, results, the ECHO debrief and the stats screen.
// Requires the dev server (`npm run dev`) — it uses the dev-only hook window.__UNKNOWN_SESSION__.
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

await page.goto(BASE);
await page.evaluate(() => {
  localStorage.clear();
  indexedDB.deleteDatabase('unknown-ascension');
});
await page.reload();
await page.getByText('Коснись, чтобы пробудиться').waitFor();
check((await page.evaluate(() => window.__UNKNOWN_AUDIO__?.state)) === 'none', 'no audio before the first gesture');
await page.mouse.click(195, 600);
await page.waitForFunction(() => !!window.__UNKNOWN_SESSION__, null, { timeout: 20000 });
check((await page.evaluate(() => window.__UNKNOWN_AUDIO__?.state)) === 'running', 'audio unlocked by the first tap');

// 1) Real pointer events on the arena → the five actions reach the director.
await page.evaluate(() => {
  const d = window.__UNKNOWN_SESSION__.director;
  window.__acts = [];
  const orig = d.input.bind(d);
  d.input = (a, t) => {
    window.__acts.push(a);
    return orig(a, t);
  };
});
const gesture = (dx, dy) =>
  page.evaluate(
    ([dx, dy]) => {
      const el = document.querySelector('[data-testid=arena]');
      const r = el.getBoundingClientRect();
      const ev = (type, x, y) =>
        el.dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true, isPrimary: true }));
      ev('pointerdown', 195, 560);
      if (dx || dy) {
        ev('pointermove', 195 + dx * 0.5, 560 + dy * 0.5);
        ev('pointermove', 195 + dx, 560 + dy);
      }
      ev('pointerup', 195 + dx, 560 + dy);
    },
    [dx, dy],
  );
for (const [dx, dy] of [[0, 0], [0, -80], [0, 80], [-80, 0], [80, 0]]) {
  await gesture(dx, dy);
  await page.waitForTimeout(250);
}
const acts = await page.evaluate(() => window.__acts.splice(0));
check(JSON.stringify(acts) === JSON.stringify(['tap', 'up', 'down', 'left', 'right']), `tap, swipe ↑ ↓ ← → recognised: ${acts.join(', ')}`);

// 2) Bot. The director is stepped in 16 ms slices and the bot answers at the exact musical
// timestamp, so the run is frame-rate independent on a software-rendered headless browser.
await page.evaluate(() => {
  const s = window.__UNKNOWN_SESSION__;
  const d = s.director;
  const R = { mid: 'tap', high: 'down', low: 'up' };
  const pending = [];
  const runes = [];
  window.__bot = { offers: 0, rounds: [] };
  const orig = d.update.bind(d);
  d.update = (dt) => {
    while (dt > 0) {
      const step = Math.min(16, dt);
      orig(step);
      dt -= step;
      const now = d.getNow();
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].at <= now) pending.splice(i, 1)[0].fn();
      }
    }
  };
  d.on((e) => {
    if (e.type === 'round') window.__bot.rounds.push(e.kind);
    if (e.type === 'windup' && !e.phantom) pending.push({ at: e.impactAt, fn: () => d.input(R[e.strikeKind], e.impactAt) });
    if (e.type === 'open') e.beats.forEach((b) => pending.push({ at: b, fn: () => d.input('tap', b) }));
    if (e.type === 'orbs') {
      const v = (o) => (o.op === '+' ? e.energy + o.n : o.op === '×' ? e.energy * o.n : e.energy - o.n);
      pending.push({ at: e.at + 600, fn: () => d.input(v(e.left) >= v(e.right) ? 'left' : 'right', d.getNow()) });
    }
    if (e.type === 'rune' && e.pass === 0) runes.push(e.node);
    if (e.type === 'recall') runes.splice(0).forEach((n, k) => pending.push({ at: d.getNow() + 400 * (k + 1), fn: () => d.tapNode(n, d.getNow()) }));
    if (e.type === 'upgradeOffer') window.__bot.offers++;
  });
});

// Upgrade cards are real buttons: pick the first one whenever they appear.
const deadline = Date.now() + 8 * 60_000;
let picked = 0;
let lastLog = Date.now();
while (Date.now() < deadline) {
  if (Date.now() - lastLog > 30_000) {
    lastLog = Date.now();
    const st = await page.evaluate(() => {
      const d = window.__UNKNOWN_SESSION__?.director;
      return d ? `${d.getPhase()} · round ${d.getRound()?.kind ?? '—'} · t=${Math.round(d.getNow() / 1000)}s` : 'no session';
    });
    console.log('    …', st);
  }
  if (await page.getByText('ЭВОЛЮЦИЯ').isVisible().catch(() => false)) break;
  const title = page.getByText('ВЫБЕРИ СИЛУ', { exact: true });
  if (await title.isVisible().catch(() => false)) {
    await title.locator('xpath=..').locator('button').first().click({ timeout: 3000 }).catch(() => {});
    picked++;
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(150);
}
await page.getByText('ЭВОЛЮЦИЯ').waitFor({ timeout: 10_000 });
const bot = await page.evaluate(() => window.__bot);
check(JSON.stringify(bot.rounds) === JSON.stringify(['takt', 'phantoms', 'overcharge', 'ascension']), `all four rounds played: ${bot.rounds.join(' → ')}`);
check(bot.offers === 3 && picked >= 1, `upgrade cards offered ${bot.offers}× (picked by tap ${picked}×)`);
check(true, 'mission played to the end → EVOLUTION screen');
await page.waitForTimeout(2500);
const text = await page.locator('body').innerText();
const acc = Number(/Точность\s+(\d+)%/.exec(text)?.[1] ?? -1);
check(acc >= 95, `bot accuracy recorded: ${acc}%`);
const grade = /ПРОБУЖДЕНИЕ\s+([SABC])\s/.exec(text)?.[1];
check(grade === 'S', `grade for a flawless bot: ${grade}`);
check(/ЭХО/.test(text), 'ECHO debrief shown (Gemini, demo or local)');
await page.getByText('Подробнее').click();
await page.getByRole('heading', { name: 'Прогресс' }).waitFor();
check((await page.locator('body').innerText()).includes('Забегов'), 'progress screen lists the saved run');
check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll e2e checks passed');
process.exit(failed ? 1 : 0);
