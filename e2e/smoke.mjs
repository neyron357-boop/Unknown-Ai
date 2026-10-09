// End-to-end smoke test: a scripted bot plays the whole mission in a mobile-sized Chromium.
// Requires the dev server (`npm run dev`) — it uses the dev-only hook window.__UNKNOWN_SESSION__.
// Usage: npm run e2e            (BASE_URL defaults to http://localhost:5173)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const SPEED = Number(process.env.SPEED ?? 3);
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

await page.goto(`${BASE}/?speed=${SPEED}`);
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

// Real DOM pointer events for the three tutorial gestures.
const gesture = (dx) =>
  page.evaluate((dx) => {
    const el = document.querySelector('[data-testid=arena]');
    const r = el.getBoundingClientRect();
    const ev = (type, x) =>
      el.dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'touch', clientX: r.left + x, clientY: r.top + 600, bubbles: true, cancelable: true, isPrimary: true }));
    ev('pointerdown', 195);
    if (dx) {
      ev('pointermove', 195 + dx * 0.5);
      ev('pointermove', 195 + dx);
    }
    ev('pointerup', 195 + dx);
  }, dx);
await page.evaluate(() => {
  window.__tut = [];
  window.__UNKNOWN_SESSION__.on((e) => e.type === 'tutorialResult' && window.__tut.push(e.result));
});
for (const [n, dx] of [[1, 80], [2, -80], [3, 0]]) {
  await page.waitForFunction(() => window.__UNKNOWN_SESSION__.director.getPhase() === 'tutorial', null, { timeout: 20000 });
  await gesture(dx);
  await page.waitForFunction((n) => window.__tut.length >= n, n, { timeout: 20000 });
}
check((await page.evaluate(() => window.__tut)).every((r) => r === 'ok'), 'swipe right, swipe left, tap → all recognised');

// Bot: reacts correctly mid-telegraph, predicts once the loop repeats, replays weak points.
await page.evaluate((speed) => {
  const s = window.__UNKNOWN_SESSION__;
  const correct = { slashL: 'dodgeR', slashR: 'dodgeL', crush: 'block', pierce: 'dodgeL' };
  let history = [];
  const shown = [];
  s.on((e) => {
    if (e.type === 'stage') history = [];
    if (e.type === 'telegraph') {
      history.push(e.attack);
      setTimeout(() => s.input(correct[e.attack]), (e.durationMs * 0.3) / speed);
    }
    if (e.type === 'gap' && e.predictable) {
      for (let p = 2; p <= 6; p++) {
        let ok = history.length >= 2 * p;
        for (let k = p; k < history.length && ok; k++) if (history[k] !== history[k - p]) ok = false;
        if (ok) {
          const next = history[history.length - p];
          setTimeout(() => s.input(correct[next]), (e.durationMs * 0.4) / speed);
          break;
        }
      }
    }
    if (e.type === 'ascendNode') shown.push(e.node);
    if (e.type === 'ascendRecall') shown.splice(0).forEach((n, k) => setTimeout(() => s.director.tapNode(n), 500 * (k + 1)));
  });
}, SPEED);

await page.getByText('ЭВОЛЮЦИЯ').waitFor({ timeout: 8 * 60_000 });
check(true, 'mission played to the end → EVOLUTION screen');
await page.waitForTimeout(2500);
const text = await page.locator('body').innerText();
// At high debug speed on a software-rendered headless browser a frame can span a whole telegraph,
// so a few late inputs are expected here; on real devices the bot scores 100% (see docs).
const acc = Number(/Точность\s+(\d+)%/.exec(text)?.[1] ?? -1);
check(acc >= 70, `bot accuracy recorded: ${acc}%`);
check(/ЭХО/.test(text), 'ECHO debrief shown (Gemini or demo)');
await page.getByText('Подробнее').click();
await page.getByRole('heading', { name: 'Прогресс' }).waitFor();
check((await page.locator('body').innerText()).includes('Забегов'), 'progress screen lists the saved run');
check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll e2e checks passed');
process.exit(failed ? 1 : 0);
