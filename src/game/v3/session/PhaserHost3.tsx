import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { getSettings } from '@/state/settings';
import { BattleScene, type SceneSettings } from '../scene/BattleScene';
import type { Dir } from '../core/types';
import type { BattleSession } from './BattleSession';

const KEYS: Record<string, Dir> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
};

function sceneSettings(): SceneSettings {
  const s = getSettings();
  return { flashes: s.flashes, shake: s.shake, gore: s.gore, effects: s.effects, reduceMotion: s.reduceMotion };
}

/** A DOM event's time on the performance.now() clock (falls back to "now" for odd browsers). */
function eventTime(e: Event): number {
  const now = performance.now();
  const t = e.timeStamp;
  return t > 0 && t <= now + 5 && now - t < 250 ? t : now;
}

/**
 * Mounts the v3 battle. The canvas renders at devicePixelRatio (capped for battery/GPU) while
 * game coordinates stay in device pixels. Touches go straight to the slash recognizer with the
 * pointer event's own timestamp, so a slash counts when the finger moved, not when a frame ran.
 */
export function PhaserHost3({ session }: { session: BattleSession }) {
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
      backgroundColor: '#000000',
      banner: false,
      audio: { noAudio: true },
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      render: { antialias: true, powerPreference: 'high-performance', roundPixels: false },
      fps: { target: 60, forceSetTimeOut: false },
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
    });
    let started = false;
    game.scene.add('battle3', BattleScene, true, {
      director: session.director,
      tick: (dt: number) => {
        if (!started) {
          started = true;
          session.start();
        }
        session.tick(dt);
      },
      paused: () => session.isPaused(),
      settings: sceneSettings,
      hud: session.hud,
      bark: (cue: 'grunt.charge' | 'grunt.death' | 'grunt.pain') => session.bark(cue),
    });

    session.onPauseChange = (paused) => {
      if (paused) game.loop.sleep();
      else game.loop.wake();
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
      session.slashes.down(e.pointerId, p.x, p.y, eventTime(e));
    };
    const move = (e: PointerEvent) => {
      // coalesced events carry the finger's real path between frames
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const c of list.length ? list : [e]) {
        const p = local(c);
        session.slashes.move(e.pointerId, p.x, p.y, eventTime(c));
      }
    };
    const up = (e: PointerEvent) => {
      const p = local(e);
      session.slashes.up(e.pointerId, p.x, p.y, eventTime(e));
    };
    const cancel = (e: PointerEvent) => session.slashes.cancel(e.pointerId);
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const dir = KEYS[e.code];
      if (dir) {
        e.preventDefault();
        session.input(dir, eventTime(e));
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
