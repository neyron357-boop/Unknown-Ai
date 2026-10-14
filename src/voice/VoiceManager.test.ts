/**
 * VoiceManager logic against a fake AudioContext (no browser needed).
 * Run: npm run test:voice   (vitest with scripts/voice/vitest.config.ts)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINE_BY_ID } from './lines';
import { VoiceManager, type VoiceSubtitle } from './VoiceManager';

// ------------------------------------------------------------------ fake Web Audio
class Param {
  constructor(public value = 0) {}
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number) {
    this.value = v;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
class Node {
  out: Node[] = [];
  constructor(public context: FakeContext) {}
  connect(n: Node) {
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.out = [];
  }
}
class FakeBuffer {
  private data: Float32Array[];
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c];
  }
}
class Source extends Node {
  buffer: FakeBuffer | null = null;
  playbackRate = new Param(1);
  onended: (() => void) | null = null;
  startAt: number | null = null;
  stopAt: number | null = null;
  start(t = 0) {
    this.startAt = t;
    this.context.sources.push(this);
  }
  stop(t?: number) {
    this.stopAt = t ?? this.context.currentTime;
  }
}
class FakeContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  sampleRate = 48000;
  destination = new Node(this);
  sources: Source[] = [];
  /** Optional gate to delay decoding. */
  decodeGate: Promise<void> | null = null;
  createGain() {
    return Object.assign(new Node(this), { gain: new Param(1) });
  }
  createBiquadFilter() {
    return Object.assign(new Node(this), { type: 'lowpass', frequency: new Param(), gain: new Param(), Q: new Param() });
  }
  createWaveShaper() {
    return Object.assign(new Node(this), { curve: null, oversample: 'none' });
  }
  createStereoPanner() {
    return Object.assign(new Node(this), { pan: new Param() });
  }
  createConvolver() {
    return Object.assign(new Node(this), { buffer: null });
  }
  createDynamicsCompressor() {
    return Object.assign(new Node(this), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  }
  createBufferSource() {
    return new Source(this);
  }
  createBuffer(ch: number, len: number, sr: number) {
    return new FakeBuffer(ch, len, sr);
  }
  decodeAudioData(bytes: ArrayBuffer) {
    const seconds = new DataView(bytes).getFloat32(0, true);
    const b = new FakeBuffer(1, Math.round(seconds * this.sampleRate), this.sampleRate);
    b.getChannelData(0).fill(0.3);
    return (this.decodeGate ?? Promise.resolve()).then(() => b);
  }
  advance(s: number) {
    this.currentTime += s;
    for (const src of this.sources) {
      const end = src.stopAt ?? (src.startAt ?? 0) + (src.buffer?.duration ?? 0) / src.playbackRate.value;
      if (src.onended && end <= this.currentTime) {
        const cb = src.onended;
        src.onended = null;
        cb();
      }
    }
  }
}

/** A "clip" whose first float encodes its duration (decoded by FakeContext). */
const clip = (seconds: number) => {
  const b = new ArrayBuffer(8);
  new DataView(b).setFloat32(0, seconds, true);
  return b;
};

const MANIFEST = {
  version: 1,
  generatedAt: '2026-10-09T00:00:00.000Z',
  lines: {
    n_roof: { file: 'n_roof.mp3', durMs: 3000, speaker: 'narrator', cue: 'narr.roof' },
    v_intro1: { file: 'v_intro1.mp3', durMs: 2000, speaker: 'verdict', cue: 'boss.intro' },
    v_miss1: { file: 'v_miss1.mp3', durMs: 1000, speaker: 'verdict', cue: 'boss.miss' },
    v_miss2: { file: 'v_miss2.mp3', durMs: 1000, speaker: 'verdict', cue: 'boss.miss' },
    v_miss3: { file: 'v_miss3.mp3', durMs: 1000, speaker: 'verdict', cue: 'boss.miss' },
    e_swipe: { file: 'e_swipe.mp3', durMs: 1000, speaker: 'echo', cue: 'echo.swipe' },
    g_charge1: { file: 'g_charge1.mp3', durMs: 500, speaker: 'grunt', cue: 'grunt.charge' },
    'g_charge1@Algieba': { file: 'g_charge1@Algieba.mp3', durMs: 500, speaker: 'grunt', cue: 'grunt.charge' },
    g_death1: { file: 'g_death1.mp3', durMs: 500, speaker: 'grunt', cue: 'grunt.death' },
    ch_hey: { file: 'ch_hey.mp3', durMs: 300, speaker: 'chant', cue: 'chant' },
  },
};
const DURATIONS: Record<string, number> = { n_roof: 3, v_intro1: 2, v_miss1: 1, v_miss2: 1, v_miss3: 1, e_swipe: 1, g_charge1: 0.5, 'g_charge1@Algieba': 0.5, g_death1: 0.5, ch_hey: 0.3 };

let ctx: FakeContext;
let subs: VoiceSubtitle[];
let ducks: [number, number][];
const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup(manifest: unknown = MANIFEST) {
  ctx = new FakeContext();
  subs = [];
  ducks = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const name = decodeURIComponent(String(url).split('/').pop()!);
      if (name === 'manifest.json') return manifest ? new Response(JSON.stringify(manifest)) : new Response('', { status: 404 });
      const id = name.replace(/\.mp3$/, '');
      return id in DURATIONS ? new Response(clip(DURATIONS[id])) : new Response('', { status: 404 });
    }),
  );
  return new VoiceManager({
    getContext: () => ctx as unknown as AudioContext,
    baseUrl: '/voice/',
    onSubtitle: (s) => subs.push(s),
    duck: (a, ms) => ducks.push([a, ms]),
    cacheName: null,
  });
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe('VoiceManager', () => {
  it('is a silent no-op without a manifest', async () => {
    const vm = setup(null);
    await vm.load();
    expect(vm.has('boss.miss')).toBe(false);
    expect(vm.play('boss.miss')).toBeNull();
    expect(await vm.getChantBuffers()).toEqual({});
  });

  it('decodes the priority set in the background and plays with the speaker rate, ducking and subtitles', async () => {
    const vm = setup();
    await vm.load();
    await flush();
    const h = vm.play('boss.intro');
    expect(h).toEqual({ id: 'v_intro1', durMs: Math.round((2 / 0.86) * 1000) });
    const src = ctx.sources.at(-1)!;
    expect(src.playbackRate.value).toBeCloseTo(0.86);
    expect(ducks).toEqual([[0.55, h!.durMs]]);
    expect(subs[0]).toMatchObject({ ru: LINE_BY_ID.v_intro1.ru, en: LINE_BY_ID.v_intro1.en, speaker: 'verdict', id: 'v_intro1' });
  });

  it('cycles through every line of a cue before repeating', async () => {
    const vm = setup();
    await vm.load();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const h = vm.play('boss.miss', { interrupt: true });
      if (!h) {
        await flush();
        ctx.advance(0.01);
        i--;
        continue;
      }
      seen.push(h.id);
      await flush();
      ctx.advance(2);
    }
    expect(new Set(seen.slice(0, 3)).size).toBe(3);
    expect(new Set(seen.slice(3, 6)).size).toBe(3);
    expect(seen[3]).not.toBe(seen[2]);
  });

  it('never overlaps priority ≥ 2 lines: waits ≤ 1.2 s, else drops; interrupt fades the old one', async () => {
    const vm = setup();
    await vm.load();
    await flush();
    const narr = vm.play('narr.roof')!; // 3 s / 0.9 ≈ 3.33 s
    expect(narr).not.toBeNull();
    expect(vm.play('echo.swipe')).toBeNull(); // would wait ~3.2 s → dropped
    ctx.advance(2.5);
    const queued = vm.play('echo.swipe');
    expect(queued).not.toBeNull();
    const echoSrc = ctx.sources.at(-1)!;
    expect(echoSrc.startAt!).toBeGreaterThan(3.33);
    expect(vm.busyMs()).toBeGreaterThan(1000);

    const forced = vm.play('boss.intro', { interrupt: true });
    expect(forced).not.toBeNull();
    const narrSrc = ctx.sources[0];
    expect(narrSrc.stopAt).toBeCloseTo(2.5 + 0.1, 2); // 80 ms fade + 20 ms
    expect(echoSrc.stopAt).not.toBeNull(); // the queued one is cancelled too
  });

  it('allows at most two overlapping grunts and drops them under a priority-3 line', async () => {
    const vm = setup();
    await vm.load();
    // Lazy decode: first request reserves a slot and plays once decoded.
    expect(vm.play('grunt.charge')).not.toBeNull();
    await flush();
    expect(vm.play('grunt.charge')).not.toBeNull();
    await flush();
    expect(vm.play('grunt.death')).toBeNull(); // third overlapping grunt
    ctx.advance(1.2);
    await flush();
    expect(vm.play('narr.roof')).not.toBeNull();
    expect(vm.play('grunt.death')).toBeNull();
    expect(ducks).toHaveLength(1); // grunts never duck the music
    expect(subs.filter((s) => s.speaker === 'grunt').map((s) => s.ru)).toEqual(expect.arrayContaining([LINE_BY_ID.g_charge1.ru]));
  });

  it('skips a lazily decoded line that would start more than ~300 ms late', async () => {
    const vm = setup();
    await vm.load();
    await flush();
    let open: () => void = () => {};
    ctx.decodeGate = new Promise<void>((r) => (open = r));
    const before = ctx.sources.length;
    expect(vm.play('boss.miss')).not.toBeNull(); // tentative
    ctx.advance(0.5);
    open();
    await flush();
    expect(ctx.sources.length).toBe(before);
    expect(subs.find((s) => s.speaker === 'verdict' && s.id.startsWith('v_miss'))).toBeUndefined();
    // Now decoded and cached: plays immediately next time.
    ctx.decodeGate = null;
    await flush();
  });

  it('plays dynamic lines with the given text and matches their level', async () => {
    const vm = setup();
    await vm.load();
    const h = await vm.playDynamic('verdict', clip(1.5), { ru: 'Ты всегда режешь раньше бита.', en: 'You always cut before the beat.' });
    expect(h?.id).toMatch(/^dyn:/);
    expect(subs.at(-1)).toMatchObject({ ru: 'Ты всегда режешь раньше бита.', speaker: 'verdict' });
  });

  it('returns chant buffers, honours setEnabled/stopAll and skips when the context is not running', async () => {
    const vm = setup();
    await vm.load();
    const chants = await vm.getChantBuffers();
    expect(Object.keys(chants)).toEqual(['ch_hey']);
    vm.setEnabled(false);
    expect(vm.play('boss.intro')).toBeNull();
    vm.setEnabled(true);
    ctx.state = 'suspended';
    expect(vm.play('boss.intro')).toBeNull();
    ctx.state = 'running';
    await flush();
    expect(vm.play('boss.intro')).not.toBeNull();
    vm.stopAll();
    expect(ctx.sources.at(-1)!.stopAt).not.toBeNull();
    expect(vm.busyMs()).toBe(0);
  });

  it('plays variants as part of the cue rotation', async () => {
    const vm = setup();
    await vm.load();
    const ids = new Set<string>();
    for (let i = 0; i < 2; i++) {
      ids.add(vm.play('grunt.charge')!.id);
      await flush();
      ctx.advance(1);
    }
    expect(ids).toEqual(new Set(['g_charge1', 'g_charge1@Algieba']));
  });
});
