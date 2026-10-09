import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { getSettings } from '@/state/settings';
import type { MissionSession } from './MissionSession';
import { DuelScene } from './scene/DuelScene';
import type { Action } from './core/types';

const KEYS: Record<string, Action> = {
  Space: 'tap',
  KeyJ: 'tap',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

/**
 * Mounts the Phaser game. Canvas renders at devicePixelRatio (capped for
 * battery/GPU) while game coordinates stay in device pixels. Input is read
 * from DOM pointer events and fed to the gesture recognizer.
 */
export function PhaserHost({ session }: { session: MissionSession }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const settings = getSettings();
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, settings.effects === 'high' ? 2 : 1.5));
    const rect = el.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: el,
      width: Math.round(w * dpr),
      height: Math.round(h * dpr),
      backgroundColor: '#050507',
      banner: false,
      audio: { noAudio: true },
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      render: { antialias: true, powerPreference: 'high-performance', roundPixels: false },
      fps: { target: 60, forceSetTimeOut: false },
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
    });
    game.scene.add('duel', DuelScene, true, { session, dpr });

    session.onPauseChange = (paused) => {
      if (paused) game.scene.pause('duel');
      else game.scene.resume('duel');
    };

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      game.scale.resize(Math.round(r.width * dpr), Math.round(r.height * dpr));
      game.scale.setZoom(1 / dpr);
    });
    ro.observe(el);

    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const p = local(e);
      session.gestures.down(e.pointerId, p.x, p.y, performance.now());
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      session.gestures.move(e.pointerId, p.x, p.y, performance.now());
    };
    const up = (e: PointerEvent) => {
      const p = local(e);
      session.gestures.up(e.pointerId, p.x, p.y, performance.now());
    };
    const cancel = (e: PointerEvent) => session.gestures.cancel(e.pointerId);
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const action = KEYS[e.code];
      if (action) {
        e.preventDefault();
        session.input(action, performance.now());
      } else if (/^Digit[1-6]$/.test(e.code) && !session.isPaused()) {
        // Desktop: digits pick runes directly.
        session.director.tapNode(Number(e.code.slice(5)) - 1);
      }
    };
    el.addEventListener('pointerdown', down, { passive: false });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    // iOS: block the long-press magnifier / callout on the canvas.
    const noCtx = (e: Event) => e.preventDefault();
    el.addEventListener('contextmenu', noCtx);

    return () => {
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('contextmenu', noCtx);
      window.removeEventListener('keydown', key);
      session.onPauseChange = null;
      game.destroy(true);
    };
  }, [session]);

  return <div ref={ref} className="absolute inset-0 touch-none" data-testid="arena" />;
}
