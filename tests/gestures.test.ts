import { describe, expect, it } from 'vitest';
import { GestureRecognizer } from '@/game/input/GestureRecognizer';
import type { Action } from '@/game/core/types';

function setup() {
  const actions: Action[] = [];
  const taps: [number, number][] = [];
  const g = new GestureRecognizer({ onAction: (a) => actions.push(a), onTap: (x, y) => taps.push([x, y]) });
  return { g, actions, taps };
}

describe('GestureRecognizer', () => {
  it('fires a dodge mid-swipe without waiting for release', () => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 0);
    g.move(1, 210, 502, 16);
    expect(actions).toEqual([]);
    g.move(1, 232, 505, 32);
    expect(actions).toEqual(['dodgeR']);
    g.move(1, 300, 505, 48);
    g.up(1, 300, 505, 60);
    expect(actions).toEqual(['dodgeR']);
  });

  it('left swipe → dodgeL', () => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 0);
    g.move(1, 170, 498, 20);
    expect(actions).toEqual(['dodgeL']);
  });

  it('quick tap → block on release', () => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 0);
    g.up(1, 203, 501, 70);
    expect(actions).toEqual(['block']);
  });

  it('steady hold → block before release', () => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 0);
    g.tick(120);
    expect(actions).toEqual([]);
    g.tick(180);
    expect(actions).toEqual(['block']);
    g.up(1, 200, 500, 400);
    expect(actions).toEqual(['block']);
  });

  it('a swipe that starts slowly is still a swipe, not a hold', () => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 0);
    g.move(1, 212, 500, 150);
    g.tick(200);
    g.move(1, 230, 501, 210);
    expect(actions).toEqual(['dodgeR']);
  });

  it('vertical drags are not commands', () => {
    const { g, actions } = setup();
    g.down(1, 200, 500, 0);
    g.move(1, 202, 450, 30);
    g.tick(400);
    g.up(1, 202, 420, 450);
    expect(actions).toEqual([]);
  });

  it('in taps mode every press is a positional tap', () => {
    const { g, actions, taps } = setup();
    g.mode = 'taps';
    g.down(1, 120, 300, 0);
    g.move(1, 180, 300, 10);
    g.up(1, 180, 300, 20);
    expect(taps).toEqual([[120, 300]]);
    expect(actions).toEqual([]);
  });

  it('supports two fingers independently', () => {
    const { g, actions } = setup();
    g.down(1, 100, 500, 0);
    g.down(2, 300, 500, 5);
    g.move(2, 260, 500, 20);
    g.up(1, 101, 500, 60);
    expect(actions).toEqual(['dodgeL', 'block']);
  });
});
