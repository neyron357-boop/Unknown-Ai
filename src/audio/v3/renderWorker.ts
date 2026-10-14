/**
 * Web Worker that renders procedural one-shots (kit, SFX, impulse responses)
 * off the main thread, so warming the sound bank never janks the game.
 * Loaded lazily by the engine via `import('./renderWorker?worker&inline')`.
 */
import { IR_HALL, IR_PLATE, IR_ROOM, makeIR } from './fx';
import { renderKit, type KitId } from './kit';
import { renderSfx } from './sfxlib';
import type { Sfx } from './types';

export type RenderJob =
  | { id: number; kind: 'kit'; name: KitId; sr: number; seed: number }
  | { id: number; kind: 'sfx'; name: Sfx; variant: number; sr: number; seed: number }
  | { id: number; kind: 'ir'; name: 'hall' | 'plate' | 'room'; sr: number; seed: number };

export interface RenderReply {
  id: number;
  chs: Float32Array[];
}

const IRS = { hall: IR_HALL, plate: IR_PLATE, room: IR_ROOM } as const;

const scope = self as unknown as { onmessage: ((e: MessageEvent<RenderJob>) => void) | null; postMessage: (msg: RenderReply, transfer: Transferable[]) => void };

scope.onmessage = (e: MessageEvent<RenderJob>) => {
  const job = e.data;
  let chs: Float32Array[];
  try {
    if (job.kind === 'kit') chs = renderKit(job.name, job.sr, job.seed);
    else if (job.kind === 'sfx') chs = renderSfx(job.name, job.sr, job.seed, job.variant);
    else chs = makeIR(job.sr, { ...IRS[job.name], seed: job.seed });
  } catch {
    chs = [];
  }
  scope.postMessage({ id: job.id, chs }, chs.map((c) => c.buffer));
};
