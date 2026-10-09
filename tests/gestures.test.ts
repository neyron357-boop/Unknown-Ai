import { describe, expect, it } from 'vitest';
import { GestureRecognizer } from '@/game/input/GestureRecognizer';
import type { Action } from '@/game/core/types';

function setup() {
  const actions: { a: Action; t: number }[] = [];
  const taps: [number, number][] = [];
  const g = new GestureRecognizer({ onAction: (a, t) => actions.push({ a, t }), onTap: (x, y) => taps.push([x, y]) });
  return { g, actions, taps };
}

describe('GestureRecognizer', () => {
  it('swipes fire mid-gesture and carry the touch-down time', () => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 1000);
    g.move(1, 202, 490, 1016);
    expect(actions).toEqual([]);
    g.move(1, 203, 470, 1032);
    expect(actions).toEqual([{ a: 'up', t: 1000 }]);
    g.up(1, 203, 400, 1060);
    expect(actions).toHaveLength(1);
  });

  it.each([
    [0, 40, 'down'],
    [-40, 2, 'left'],
    [40, -3, 'right'],
  ] as const)('dx=%d dy=%d → %s', (dx, dy, expected) => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 0);
    g.move(1, 200 + dx, 500 + dy, 20);
    expect(actions[0].a).toBe(expected);
  });

  it('quick tap → tap on release, timed at touch-down', () => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 500);
    g.up(1, 202, 501, 560);
    expect(actions).toEqual([{ a: 'tap', t: 500 }]);
  });

  it('a still finger becomes a tap after the hold delay, before release', () => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 0);
    g.tick(60);
    expect(actions).toEqual([]);
    g.tick(95);
    expect(actions).toEqual([{ a: 'tap', t: 0 }]);
    g.up(1, 200, 500, 300);
    expect(actions).toHaveLength(1);
  });

  it('a short flick released early is still a swipe', () => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 0);
    g.up(1, 200, 486, 40);
    expect(actions[0].a).toBe('up');
  });

  it('in taps mode every press is reported immediately with its position', () => {
    const { g, actions, taps } = setup();
    g.mode = 'taps';
    g.down(1, 120, 300, 0);
    g.move(1, 180, 300, 10);
    g.up(1, 180, 300, 20);
    expect(taps).toEqual([[120, 300]]);
    expect(actions).toEqual([]);
  });

  it('two fingers are independent', () => {
    const { g, actions } = setup();
    g.down(1, 100, 500, 0);
    g.down(2, 300, 500, 5);
    g.move(2, 300, 540, 20);
    g.up(1, 101, 500, 60);
    expect(actions.map((x) => x.a)).toEqual(['down', 'tap']);
  });
});
