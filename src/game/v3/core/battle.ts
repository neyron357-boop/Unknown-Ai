import type { VoiceCue } from '@/voice/lines';
import { BOSS_SIDE, bossMoveDir, buildChart, EXEC_PERFORM_AT, EXEC_SHOW_AT, type Chart, type PlannedEnemy, type PlannedSegment, type SegmentRole } from './chart';
import { computeResult, type BattleResult, type NoteRecord } from './metrics';
import { createRng } from './random';
import {
  MAX_HP,
  OPPOSITE,
  type ActId,
  type AnomalyKind,
  type BossMove,
  type CameoId,
  type Dir,
  type EnemyKind,
  type EnemySpawn,
  type HintKind,
  type Judgement,
  type KillStyle,
  type Meters,
  type ModeId,
  type NoteInfo,
  type SectionId,
  type SegmentId,
  type Side,
} from './types';

export type BattlePhase = 'idle' | SegmentRole | 'broken' | 'complete';

export type BattleEvent =
  | { type: 'section'; id: SectionId; bpm: number; at: number }
  | { type: 'beat'; n: number; bar: number; at: number; beatMs: number }
  | { type: 'segment'; id: SegmentId; act: ActId; role: SegmentRole; at: number; bars: number }
  | { type: 'spawn'; enemy: EnemySpawn }
  | { type: 'telegraph'; note: NoteInfo }
  | { type: 'hint'; kind: HintKind; noteAt: number; dir: Dir | null }
  | { type: 'judge'; note: NoteInfo; judgement: Judgement; offset: number | null; action: Dir | null }
  | { type: 'kill'; enemy: number; kind: EnemyKind; by: 'hero' | CameoId; dir: Dir; style: KillStyle; perfect: boolean; bloodlust: boolean; scored: boolean; at: number }
  | { type: 'enemyHurt'; enemy: number; step: number }
  | { type: 'shift'; enemy: number; to: Side; at: number }
  | { type: 'heroHit'; source: 'enemy' | 'boss' | 'exec'; enemy: number; damage: number; hp: number; dir: Dir }
  | { type: 'whiff'; dir: Dir; stray: boolean }
  | { type: 'meters'; meters: Meters }
  | { type: 'bloodlust'; on: boolean; until: number }
  | { type: 'reboot'; durationMs: number }
  | { type: 'cameo'; id: CameoId; phase: 'enter' | 'exit'; side: Side; role: 'assist' | 'miniboss'; at: number }
  | { type: 'boss'; phase: 'intro' | 'duel' | 'rage' | 'broken' | 'execution' | 'dead'; at: number }
  | { type: 'bossMove'; note: NoteInfo; move: BossMove; windupAt: number; repeat: boolean }
  | { type: 'execShow'; index: number; dir: Dir; at: number; total: number }
  | { type: 'execPerform'; at: number; total: number }
  | { type: 'execCut'; index: number; ok: boolean; dir: Dir | null; at: number }
  | { type: 'finisher'; at: number; flawless: boolean }
  | { type: 'anomaly'; kind: AnomalyKind; at: number; durationMs: number }
  | { type: 'voice'; cue: VoiceCue; priority: number }
  | { type: 'complete'; result: BattleResult };

export interface BattleCheckpoint {
  version: 3;
  mode: ModeId;
  seed: number;
  ease: number;
  hints: boolean;
  segment: SegmentId;
  hp: number;
  score: number;
  maxCombo: number;
  kills: number;
  assists: number;
  decaps: number;
  bloodlusts: number;
  hitsTaken: number;
  reboots: number;
  impulsive: number;
  records: NoteRecord[];
  savedAt: number;
}

export interface BattleOptions {
  mode?: ModeId;
  seed?: number;
  ease?: number;
  /** In-context hints for new enemy types (ghost swipes + ECHO). */
  hints?: boolean;
  resume?: BattleCheckpoint | null;
}

interface LiveNote {
  info: NoteInfo;
  judged: boolean;
  enemy: LiveEnemy | null;
  repeat: boolean;
  segment: SegmentId;
}

interface LiveEnemy {
  plan: PlannedEnemy;
  notes: LiveNote[];
  alive: boolean;
  side: Side;
}

interface Cue {
  at: number;
  seq: number;
  fn: () => void;
}

const DAMAGE: Record<EnemyKind | 'boss' | 'exec', number> = { grunt: 8, brute: 14, dodger: 8, feinter: 10, leaper: 8, crawler: 8, gunner: 10, butcher: 16, boss: 15, exec: 10 };
/** Score per answered note (perfect ×1.5, times the combo multiplier). */
const NOTE_SCORE: Record<EnemyKind | 'boss' | 'exec', number> = { grunt: 100, brute: 125, dodger: 100, feinter: 200, leaper: 120, crawler: 120, gunner: 300, butcher: 300, boss: 150, exec: 600 };
const FEINT_SCORE = 50;
const FINISHER_SCORE = 3000;
const STRAY_LOCK_MS = 200;
const WHIFF_LOCK_MS = 140;
const FOOLED_LOCK_MS = 220;
const REBOOT_BEATS = 4;
const REBOOT_HP = 60;
const BLOODLUST_BEATS = 8;
/** Checkpoints are offered at the start of these segments. */
export const CHECKPOINT_SEGMENTS: SegmentId[] = ['roofA', 'trainA', 'bossIntro'];

/**
 * BattleDirector — deterministic conductor of a v3 run.
 *
 * Owns every rule and timing on one beat grid (constant bpm per run): enemy waves, the boss duel,
 * the execution, Bloodlust, reboots, scripted voice lines and cosmetic anomalies. Renderers only
 * listen to events and forward slashes (with the timestamp the finger moved), so whole runs can
 * be simulated in tests.
 */
export class BattleDirector {
  readonly mode: ModeId;
  readonly seed: number;
  readonly ease: number;
  readonly hints: boolean;
  readonly chart: Chart;
  readonly beatMs: number;
  private readonly listeners = new Set<(e: BattleEvent) => void>();
  private readonly rng: () => number;

  private now = 0;
  private cues: Cue[] = [];
  private seq = 0;
  private started = false;
  private phase: BattlePhase = 'idle';
  private segment: PlannedSegment;

  private live = new Map<number, LiveNote>();
  private enemies = new Map<number, LiveEnemy>();
  private noteSeq = 1;
  private lockUntil = -Infinity;
  private lastHitAt = -Infinity;
  private rebootUntil = -Infinity;
  private bloodlustUntil = -Infinity;
  private mirrors: [number, number][] = [];
  private bossToken = 0;
  private broken = false;
  private bossPhaseEnd = 0;
  private startAt = 0;

  // meters
  private hp = MAX_HP;
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private rage = 0;
  private posture: number | null = null;
  private bossHp: number | null = null;
  private kills = 0;
  private assists = 0;
  private decaps = 0;
  private bloodlusts = 0;
  private hitsTaken = 0;
  private reboots = 0;
  private impulsive = 0;
  private records: NoteRecord[] = [];
  private execCorrect = 0;
  private butcherPerfect = true;
  private perfectStreak = 0;
  private bossPerfectStreak = 0;
  private voiceLast = new Map<string, number>();
  private actVoice = new Set<string>();
  private result: BattleResult | null = null;
  private resume: BattleCheckpoint | null;

  constructor(opts: BattleOptions = {}) {
    const r = opts.resume ?? null;
    this.mode = r?.mode ?? opts.mode ?? 'spark';
    this.seed = r?.seed ?? opts.seed ?? Date.now() % 2147483647;
    this.ease = r?.ease ?? opts.ease ?? 1;
    this.hints = r?.hints ?? opts.hints ?? true;
    this.chart = buildChart(this.seed, this.mode, this.ease);
    this.beatMs = this.chart.beatMs;
    this.rng = createRng(this.seed ^ 0x5eed);
    this.segment = this.chart.segments[0];
    this.resume = r;
  }

  // ------------------------------------------------------------------ public API

  on(listener: (e: BattleEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    let from = 0;
    if (this.resume) {
      const seg = this.chart.segments.find((s) => s.id === this.resume!.segment) ?? this.chart.segments[0];
      this.restore(this.resume);
      from = seg.startBeat;
      this.resume = null;
      // one bar of pre-roll in the resumed section
      this.now = this.beatTime(from - 4);
      this.startAt = this.now;
      this.emit({ type: 'section', id: seg.section, bpm: this.chart.tuning.bpm, at: this.now });
    }
    this.emitMeters();
    this.scheduleAll(from);
  }

  update(dt: number): void {
    if (!this.started || this.phase === 'complete') return;
    this.advanceTo(this.now + Math.max(0, dt));
  }

  /**
   * A slash. `at` is when the finger actually moved (director ms) — it may be slightly in the
   * past (gesture classified late) or the future (between frames).
   */
  input(dir: Dir, at = this.now): void {
    if (!this.started || this.phase === 'complete') return;
    const t = Math.max(this.now - 300, Math.min(at, this.now + 60));
    if (t > this.now) this.advanceTo(t);
    this.slash(dir, t);
  }

  getNow(): number {
    return this.now;
  }

  getPhase(): BattlePhase {
    return this.phase;
  }

  getSegment(): PlannedSegment {
    return this.segment;
  }

  getMeters(): Meters {
    return {
      hp: this.hp,
      score: Math.round(this.score),
      combo: this.combo,
      mult: this.mult(),
      rage: this.rage,
      bloodlust: this.isBloodlust(this.now),
      posture: this.posture,
      bossHp: this.bossHp,
      kills: this.kills,
    };
  }

  /** Whether left/right are currently flipped (mirror anomaly). */
  isMirrored(t = this.now): boolean {
    return this.mirrors.some(([a, b]) => t >= a && t < b);
  }

  getResult(): BattleResult | null {
    return this.result;
  }

  /** Valid only right after a checkpoint segment starts. */
  getCheckpoint(): BattleCheckpoint | null {
    if (!CHECKPOINT_SEGMENTS.includes(this.segment.id) || this.phase === 'complete') return null;
    if (this.now - this.beatTime(this.segment.startBeat) > this.beatMs * 2) return null;
    return {
      version: 3,
      mode: this.mode,
      seed: this.seed,
      ease: this.ease,
      hints: this.hints,
      segment: this.segment.id,
      hp: this.hp,
      score: this.score,
      maxCombo: this.maxCombo,
      kills: this.kills,
      assists: this.assists,
      decaps: this.decaps,
      bloodlusts: this.bloodlusts,
      hitsTaken: this.hitsTaken,
      reboots: this.reboots,
      impulsive: this.impulsive,
      records: [...this.records],
      savedAt: Date.now(),
    };
  }

  beatTime(beat: number): number {
    return beat * this.beatMs;
  }

  // ------------------------------------------------------------------ scheduling

  private emit(e: BattleEvent): void {
    for (const l of this.listeners) l(e);
  }

  private at(time: number, fn: () => void): void {
    const cue: Cue = { at: time, seq: this.seq++, fn };
    let lo = 0;
    let hi = this.cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const c = this.cues[mid];
      if (c.at < cue.at || (c.at === cue.at && c.seq < cue.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.cues.splice(lo, 0, cue);
  }

  private advanceTo(target: number): void {
    while (this.cues.length && this.cues[0].at <= target) {
      const cue = this.cues.shift()!;
      this.now = Math.max(this.now, cue.at);
      cue.fn();
      if (this.phase === 'complete') return;
    }
    this.now = Math.max(this.now, target);
  }

  private scheduleAll(fromBeat: number): void {
    const c = this.chart;
    const fromMs = this.beatTime(fromBeat);
    const preroll = this.beatTime(fromBeat - 4);

    // global beat clock
    const firstBeat = Math.max(0, Math.ceil(this.now / this.beatMs - 1e-6));
    const tick = (n: number) => {
      this.emit({ type: 'beat', n, bar: ((n % 4) + 4) % 4, at: this.beatTime(n), beatMs: this.beatMs });
      this.at(this.beatTime(n + 1), () => tick(n + 1));
    };
    this.at(this.beatTime(firstBeat), () => tick(firstBeat));

    for (const seg of c.segments) {
      if (seg.startBeat < fromBeat || seg.role === 'exec' || seg.role === 'finale') continue;
      this.at(this.beatTime(seg.startBeat), () => this.enterSegment(seg));
    }
    for (const e of c.enemies) {
      if (this.beatTime(e.spawnBeat) < preroll - 1) continue;
      if (e.notes[0].beat < fromBeat) continue;
      this.at(this.beatTime(e.spawnBeat), () => this.spawn(e, null));
    }
    for (const h of c.hints) {
      if (!this.hints || h.beat < fromBeat) continue;
      if (h.kind === 'duel' || h.kind === 'exec') continue; // emitted by their phases
      const enemy = c.enemies.find((e) => e.teach && e.notes[0].beat === h.beat);
      this.at(this.beatTime(h.beat - 3), () => this.emit({ type: 'hint', kind: h.kind, noteAt: this.beatTime(h.beat), dir: enemy ? enemy.notes[0].dir : null }));
    }
    for (const v of c.voice) {
      if (v.beat < fromBeat - 4) continue;
      if (!this.hints && v.cue.startsWith('echo.') && v.cue !== 'echo.duel') continue;
      this.at(this.beatTime(v.beat), () => this.say(v.cue, v.priority ?? 3, true));
    }
    for (const a of c.anomalies) {
      if (a.beat < fromBeat) continue;
      const seg = c.segments.find((s) => s.startBeat <= a.beat && a.beat < s.startBeat + s.bars * 4);
      if (seg && (seg.role === 'exec' || seg.role === 'finale')) continue; // dynamic, see startFinale
      const at = this.beatTime(a.beat);
      const dur = a.beats * this.beatMs;
      if (a.kind === 'mirror') this.mirrors.push([at, at + dur]);
      this.at(at, () => this.emit({ type: 'anomaly', kind: a.kind, at, durationMs: dur }));
    }
    for (const cam of c.cameos) {
      if (cam.exitBeat < fromBeat) continue;
      const enterAt = this.beatTime(cam.enterBeat);
      const exitAt = this.beatTime(cam.exitBeat);
      if (cam.enterBeat >= fromBeat) this.at(enterAt, () => this.emit({ type: 'cameo', id: cam.id, phase: 'enter', side: cam.side, role: cam.role, at: enterAt }));
      this.at(exitAt, () => this.emit({ type: 'cameo', id: cam.id, phase: 'exit', side: cam.side, role: cam.role, at: exitAt }));
    }
    void fromMs;
  }

  private enterSegment(seg: PlannedSegment): void {
    this.segment = seg;
    this.phase = seg.role;
    const at = this.beatTime(seg.startBeat);
    if (this.actVoiceAct !== seg.act) {
      this.actVoiceAct = seg.act;
      this.actVoice.clear();
    }
    this.emit({ type: 'section', id: seg.section, bpm: this.chart.tuning.bpm, at });
    this.emit({ type: 'segment', id: seg.id, act: seg.act, role: seg.role, at, bars: seg.bars });
    if (seg.role === 'bossIntro') {
      this.posture = 0;
      this.bossHp = 1;
      this.emit({ type: 'boss', phase: 'intro', at });
      this.emitMeters();
    } else if (seg.role === 'duel') {
      this.emit({ type: 'boss', phase: 'duel', at });
      if (this.hints) {
        const first = this.chart.strings.find((s) => s.phase === 'duel');
        if (first) this.emit({ type: 'hint', kind: 'duel', noteAt: this.beatTime(first.moves[0].beat), dir: null });
      }
      this.scheduleStrings('duel');
    } else if (seg.role === 'rage') {
      this.emit({ type: 'boss', phase: 'rage', at });
      this.say('boss.rage', 3);
      this.at(at + this.beatMs * 2, () => this.say('boss.roar', 1));
      this.scheduleStrings('rage');
      const token = this.bossToken;
      for (const e of this.chart.summons) this.at(this.beatTime(e.spawnBeat), () => token === this.bossToken && !this.broken && this.spawn(e, null));
      this.bossPhaseEnd = at + seg.bars * 4 * this.beatMs;
      this.at(this.bossPhaseEnd, () => {
        if (!this.broken) this.breakBoss(true);
      });
    }
  }

  private actVoiceAct: ActId | null = null;

  // ------------------------------------------------------------------ enemies & notes

  private makeNote(enemyId: number, at: number, dir: Dir, feint: boolean, kind: NoteInfo['kind'], final: boolean, step: number, assist: CameoId | null, move?: BossMove): NoteInfo {
    return { id: this.noteSeq++, enemy: enemyId, at, dir, feint, kind, final, step, assist, move };
  }

  private spawn(plan: PlannedEnemy, sideOverride: Side | null): void {
    const finalIdx = plan.notes.length - 1;
    const enemy: LiveEnemy = { plan, notes: [], alive: true, side: sideOverride ?? plan.side };
    const infos = plan.notes.map((n, i) => this.makeNote(plan.id, this.beatTime(n.beat), n.dir, n.feint, plan.kind, i === finalIdx, i, plan.assist));
    for (const info of infos) {
      const ln: LiveNote = { info, judged: false, enemy, repeat: false, segment: plan.segment };
      enemy.notes.push(ln);
      this.live.set(info.id, ln);
      // telegraph one beat ahead (eyes flash / weapon glint)
      this.at(Math.max(this.now, info.at - this.beatMs), () => {
        if (!ln.judged && enemy.alive) this.emit({ type: 'telegraph', note: info });
      });
      if (info.assist) this.at(info.at, () => this.assistResolve(ln));
      else this.at(info.at + this.chart.tuning.lateMs + 1, () => this.deadline(ln));
    }
    this.enemies.set(plan.id, enemy);
    this.emit({
      type: 'spawn',
      enemy: { id: plan.id, kind: plan.kind, side: enemy.side, spawnAt: this.beatTime(plan.spawnBeat), notes: infos, variant: plan.variant, assist: plan.assist, act: plan.act },
    });
    if (plan.kind === 'brute' && !plan.teach && this.rng() < 0.35) this.say('brute.charge', 1);
    if (plan.kind === 'gunner') this.at(Math.max(this.now, infos[0].at - this.beatMs * 0.6), () => enemy.alive && this.say('gunner.fire', 1));
  }

  private scheduleStrings(phase: 'duel' | 'rage'): void {
    const token = this.bossToken;
    const tele = this.chart.tuning.bossTelegraph * this.beatMs;
    for (const s of this.chart.strings.filter((x) => x.phase === phase)) {
      s.moves.forEach((m, i) => {
        const at = this.beatTime(m.beat);
        const windupAt = at - tele;
        this.at(Math.max(this.now, windupAt), () => {
          if (token !== this.bossToken || this.broken) return;
          const info = this.makeNote(-1, at, bossMoveDir(m.move), m.move === 'feint', 'boss', false, i, null, m.move);
          const ln: LiveNote = { info, judged: false, enemy: null, repeat: s.repeatOf !== null, segment: phase === 'duel' ? 'duel' : 'rage' };
          this.live.set(info.id, ln);
          this.emit({ type: 'bossMove', note: info, move: m.move, windupAt, repeat: s.repeatOf !== null });
          this.at(at + this.chart.tuning.lateMs + 1, () => this.deadline(ln));
        });
      });
    }
  }

  private assistResolve(ln: LiveNote): void {
    if (ln.judged) return;
    ln.judged = true;
    this.live.delete(ln.info.id);
    const e = ln.enemy;
    if (!e || !e.alive) return;
    if (ln.info.final) {
      e.alive = false;
      this.assists++;
      const style: KillStyle = ln.info.assist === 'cleaner' ? 'shot' : ln.info.assist === 'fox' ? 'decap' : 'bisect';
      if (style === 'decap') this.decaps++;
      this.emit({ type: 'kill', enemy: e.plan.id, kind: e.plan.kind, by: ln.info.assist!, dir: ln.info.dir, style, perfect: true, bloodlust: false, scored: false, at: ln.info.at });
    } else {
      this.emit({ type: 'enemyHurt', enemy: e.plan.id, step: ln.info.step });
    }
  }

  // ------------------------------------------------------------------ slashes

  private slash(dir0: Dir, t: number): void {
    const dir = this.isMirrored(t) && (dir0 === 'left' || dir0 === 'right') ? OPPOSITE[dir0] : dir0;
    if (t < this.lockUntil) return;
    const { earlyMs, lateMs } = this.chart.tuning;
    let real: LiveNote | null = null;
    let feint: LiveNote | null = null;
    for (const ln of this.live.values()) {
      if (ln.judged || ln.info.assist || ln.info.dir !== dir) continue;
      const off = t - ln.info.at;
      if (off < -earlyMs || off > lateMs) continue;
      if (ln.info.feint) {
        if (!feint || Math.abs(off) < Math.abs(t - feint.info.at)) feint = ln;
      } else if (!real || Math.abs(off) < Math.abs(t - real.info.at)) real = ln;
    }
    if (real) this.hit(real, t, dir);
    else if (feint) this.fooled(feint, t, dir);
    else this.whiff(dir, t);
  }

  private hit(ln: LiveNote, t: number, action: Dir): void {
    const info = ln.info;
    const offset = Math.round(t - info.at);
    const judgement: Judgement = Math.abs(offset) <= this.chart.tuning.perfectMs ? 'perfect' : 'good';
    ln.judged = true;
    this.live.delete(info.id);
    this.lastHitAt = t;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const bl = this.isBloodlust(t);
    if (!bl) this.rage = Math.min(1, this.rage + (judgement === 'perfect' ? 0.07 : 0.035));
    this.score += NOTE_SCORE[info.kind] * (judgement === 'perfect' ? 1.5 : 1) * this.mult(t);
    this.record(ln, judgement, offset);
    this.emit({ type: 'judge', note: info, judgement, offset, action });
    this.perfectStreak = judgement === 'perfect' ? this.perfectStreak + 1 : 0;

    if (info.kind === 'boss') {
      const cap = this.phase === 'duel' ? 0.5 : 1;
      this.posture = Math.min(cap, (this.posture ?? 0) + (judgement === 'perfect' ? 0.1 : 0.06) * (bl ? 1.5 : 1));
      this.bossHp = Math.max(0.12, (this.bossHp ?? 1) - (judgement === 'perfect' ? 0.03 : 0.018));
      this.bossPerfectStreak = judgement === 'perfect' ? this.bossPerfectStreak + 1 : 0;
      if (this.bossPerfectStreak >= 3) {
        this.bossPerfectStreak = 0;
        this.sayLimited('boss.perfect', 3, 8);
      }
      if (this.phase === 'rage' && (this.posture ?? 0) >= 1 && !this.broken) this.breakBoss(false);
    } else if (info.kind === 'exec') {
      this.execCorrect++;
      this.emit({ type: 'execCut', index: info.step, ok: true, dir: action, at: t });
    } else if (ln.enemy) {
      const e = ln.enemy;
      if (e.plan.kind === 'butcher' && judgement !== 'perfect') this.butcherPerfect = false;
      if (info.final) this.killEnemy(e, info, judgement === 'perfect', t, true);
      else this.afterStep(e, info, t);
    }
    if (this.perfectStreak === 8 && !this.isBossPhase()) this.sayLimited('echo.praise', 2, 16);
    if (this.combo === 30) this.sayOncePerAct('echo.combo', 2);
    this.checkBloodlust(t);
    this.emitMeters();
  }

  private afterStep(e: LiveEnemy, info: NoteInfo, t: number): void {
    if (e.plan.kind === 'dodger') {
      e.side = e.side === 'left' ? 'right' : 'left';
      this.emit({ type: 'shift', enemy: e.plan.id, to: e.side, at: t });
    } else {
      this.emit({ type: 'enemyHurt', enemy: e.plan.id, step: info.step });
      if (e.plan.kind === 'butcher') this.sayLimited('butcher.hit', 3, 3);
    }
  }

  private killEnemy(e: LiveEnemy, info: NoteInfo, perfect: boolean, t: number, scored: boolean): void {
    if (!e.alive) return;
    e.alive = false;
    const bl = this.isBloodlust(t);
    const style = scored ? this.killStyle(e.plan.kind, perfect, bl) : 'shove';
    if (scored) this.kills++;
    if (style === 'decap') this.decaps++;
    // any notes of this enemy still pending are void
    for (const ln of e.notes) {
      if (!ln.judged) {
        ln.judged = true;
        this.live.delete(ln.info.id);
      }
    }
    this.emit({ type: 'kill', enemy: e.plan.id, kind: e.plan.kind, by: 'hero', dir: info.dir, style, perfect, bloodlust: bl, scored, at: t });
    if (e.plan.kind === 'butcher') this.say('butcher.death', 3);
  }

  private killStyle(kind: EnemyKind, perfect: boolean, bloodlust: boolean): KillStyle {
    if (bloodlust) return 'burst';
    const pick = <T,>(xs: T[]) => xs[Math.floor(this.rng() * xs.length)];
    switch (kind) {
      case 'grunt':
        return perfect ? pick<KillStyle>(['decap', 'bisect', 'cleave', 'bisect']) : 'cleave';
      case 'brute':
        return 'bisect';
      case 'dodger':
        return 'decap';
      case 'feinter':
        return perfect ? 'bisect' : 'cleave';
      case 'leaper':
        return 'impale';
      case 'crawler':
        return pick<KillStyle>(['decap', 'cleave']);
      case 'gunner':
        return 'shot';
      case 'butcher':
        return 'burst';
    }
  }

  private fooled(ln: LiveNote, t: number, action: Dir): void {
    ln.judged = true;
    this.live.delete(ln.info.id);
    this.combo = 0;
    this.perfectStreak = 0;
    this.lockUntil = t + FOOLED_LOCK_MS;
    this.record(ln, 'fooled', Math.round(t - ln.info.at));
    this.emit({ type: 'judge', note: ln.info, judgement: 'fooled', offset: Math.round(t - ln.info.at), action });
    if (ln.info.kind === 'boss') {
      this.posture = Math.max(0, (this.posture ?? 0) - 0.05);
      this.sayLimited('boss.laugh', 3, 8);
    }
    this.emitMeters();
  }

  private whiff(dir: Dir, t: number): void {
    const { earlyMs } = this.chart.tuning;
    let stray = false;
    for (const ln of this.live.values()) {
      if (ln.judged || ln.info.assist || ln.info.feint || ln.info.dir !== dir) continue;
      const lead = ln.info.at - t;
      if (lead > earlyMs && lead < earlyMs + 260) stray = true;
    }
    this.lockUntil = t + (stray ? STRAY_LOCK_MS : WHIFF_LOCK_MS);
    if (stray) this.impulsive++;
    if (t - this.lastHitAt > 120) {
      this.combo = 0;
      this.perfectStreak = 0;
    }
    this.emit({ type: 'whiff', dir, stray });
    this.emitMeters();
  }

  private deadline(ln: LiveNote): void {
    if (ln.judged) return;
    ln.judged = true;
    this.live.delete(ln.info.id);
    const info = ln.info;
    if (info.feint) {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += FEINT_SCORE * this.mult();
      this.record(ln, 'ignored', null);
      this.emit({ type: 'judge', note: info, judgement: 'ignored', offset: null, action: null });
      if (info.kind === 'boss') this.posture = Math.min(this.phase === 'duel' ? 0.5 : 1, (this.posture ?? 0) + 0.04);
      this.emitMeters();
      return;
    }
    // a real threat lands
    this.combo = 0;
    this.perfectStreak = 0;
    this.bossPerfectStreak = 0;
    this.rage = Math.max(0, this.rage - 0.25);
    this.record(ln, 'miss', null);
    this.emit({ type: 'judge', note: info, judgement: 'miss', offset: null, action: null });
    if (info.kind === 'exec') this.emit({ type: 'execCut', index: info.step, ok: false, dir: null, at: info.at });
    if (info.kind === 'butcher') this.butcherPerfect = false;
    this.damage(info, info.kind === 'boss' ? 'boss' : info.kind === 'exec' ? 'exec' : 'enemy');
    if (info.kind === 'boss') this.sayLimited('boss.miss', 3, 8);
    const e = ln.enemy;
    if (e && e.alive) {
      if (info.final) this.killEnemy(e, info, false, this.now, false);
      else if (e.plan.kind === 'dodger') this.afterStep(e, info, this.now);
    }
    this.emitMeters();
  }

  private damage(info: NoteInfo, source: 'enemy' | 'boss' | 'exec'): void {
    if (this.now < this.rebootUntil) return;
    const dmg = DAMAGE[info.kind];
    this.hp = Math.max(0, this.hp - dmg);
    this.hitsTaken++;
    this.emit({ type: 'heroHit', source, enemy: info.enemy, damage: dmg, hp: this.hp, dir: info.dir });
    if (this.hp > 0 && this.hp < 35) this.sayOncePerAct('echo.lowhp', 2);
    if (this.hp <= 0) this.reboot();
  }

  private reboot(): void {
    this.reboots++;
    const dur = REBOOT_BEATS * this.beatMs;
    this.rebootUntil = this.now + dur;
    this.emit({ type: 'reboot', durationMs: dur });
    this.say(this.hints ? 'echo.reboot' : 'narr.reboot', 3);
    this.at(this.rebootUntil, () => {
      this.hp = REBOOT_HP;
      this.emitMeters();
    });
  }

  // ------------------------------------------------------------------ bloodlust

  private isBloodlust(t = this.now): boolean {
    return t < this.bloodlustUntil;
  }

  private mult(t = this.now): number {
    return (1 + Math.min(3, Math.floor(this.combo / 8))) * (this.isBloodlust(t) ? 2 : 1);
  }

  private checkBloodlust(t: number): void {
    if (this.rage < 1 || this.isBloodlust(t) || this.isBossFinalStage()) return;
    this.rage = 0;
    const startBeat = Math.ceil(t / this.beatMs + 1e-6);
    const start = this.beatTime(startBeat);
    const until = start + BLOODLUST_BEATS * this.beatMs;
    this.bloodlusts++;
    this.bloodlustUntil = until;
    this.at(start, () => {
      this.emit({ type: 'bloodlust', on: true, until });
      this.sayOncePerAct('narr.bloodlust', 3);
      this.emitMeters();
    });
    this.at(until, () => {
      this.emit({ type: 'bloodlust', on: false, until });
      this.emitMeters();
    });
  }

  private isBossPhase(): boolean {
    return this.phase === 'duel' || this.phase === 'rage' || this.phase === 'broken' || this.phase === 'exec';
  }

  private isBossFinalStage(): boolean {
    return this.phase === 'broken' || this.phase === 'exec' || this.phase === 'finale';
  }

  // ------------------------------------------------------------------ boss endgame

  private breakBoss(forced: boolean): void {
    if (this.broken) return;
    this.broken = true;
    this.bossToken++;
    const breakAt = forced ? this.now : this.beatTime(Math.ceil(this.now / this.beatMs / 4 - 1e-6) * 4);
    this.at(breakAt, () => {
      this.phase = 'broken';
      this.posture = 1;
      // the boss's scream blows every remaining thug apart
      for (const e of this.enemies.values()) {
        if (!e.alive) continue;
        e.alive = false;
        for (const ln of e.notes) {
          if (!ln.judged) {
            ln.judged = true;
            this.live.delete(ln.info.id);
          }
        }
        this.emit({ type: 'kill', enemy: e.plan.id, kind: e.plan.kind, by: 'hero', dir: 'up', style: 'burst', perfect: false, bloodlust: false, scored: false, at: breakAt });
      }
      for (const ln of [...this.live.values()]) if (ln.info.kind === 'boss') this.live.delete(ln.info.id);
      this.emit({ type: 'boss', phase: 'broken', at: breakAt });
      this.say('boss.broken', 3);
      this.emitMeters();
      this.at(breakAt + 4 * this.beatMs, () => this.startExec(breakAt + 4 * this.beatMs));
    });
  }

  private startExec(t0: number): void {
    const seg = this.chart.segments.find((s) => s.role === 'exec')!;
    const shifted: PlannedSegment = { ...seg, startBeat: Math.round(t0 / this.beatMs) };
    this.segment = shifted;
    this.phase = 'exec';
    this.emit({ type: 'section', id: 'execution', bpm: this.chart.tuning.bpm, at: t0 });
    this.emit({ type: 'segment', id: 'exec', act: 'temple', role: 'exec', at: t0, bars: seg.bars });
    this.emit({ type: 'boss', phase: 'execution', at: t0 });
    if (this.hints) this.emit({ type: 'hint', kind: 'exec', noteAt: t0 + EXEC_PERFORM_AT * this.beatMs, dir: null });
    this.say(this.hints ? 'echo.exec' : 'boss.exec', this.hints ? 2 : 3);
    const cuts = this.chart.exec;
    cuts.forEach((dir, i) => {
      const at = t0 + (EXEC_SHOW_AT + i) * this.beatMs;
      this.at(at, () => this.emit({ type: 'execShow', index: i, dir, at, total: cuts.length }));
    });
    if (this.hints) this.at(t0 + (cuts.length + 1) * this.beatMs, () => this.say('boss.exec', 3));
    const performAt = t0 + EXEC_PERFORM_AT * this.beatMs;
    this.at(performAt - this.beatMs, () => this.emit({ type: 'execPerform', at: performAt, total: cuts.length }));
    cuts.forEach((dir, i) => {
      const at = performAt + i * this.beatMs;
      this.at(Math.max(t0, at - this.beatMs), () => {
        const info = this.makeNote(-1, at, dir, false, 'exec', i === cuts.length - 1, i, null);
        const ln: LiveNote = { info, judged: false, enemy: null, repeat: false, segment: 'exec' };
        this.live.set(info.id, ln);
        this.at(at + this.chart.tuning.lateMs + 1, () => this.deadline(ln));
      });
    });
    const finaleAt = t0 + seg.bars * 4 * this.beatMs;
    this.at(finaleAt, () => this.startFinale(finaleAt));
  }

  private startFinale(t: number): void {
    const seg = this.chart.segments.find((s) => s.role === 'finale')!;
    this.segment = { ...seg, startBeat: Math.round(t / this.beatMs) };
    this.phase = 'finale';
    const flawless = this.execCorrect === this.chart.exec.length;
    this.score += FINISHER_SCORE * (flawless ? 2 : 1);
    this.bossHp = 0;
    this.decaps++;
    this.emit({ type: 'section', id: 'finale', bpm: this.chart.tuning.bpm, at: t });
    this.emit({ type: 'segment', id: 'finale', act: 'temple', role: 'finale', at: t, bars: seg.bars });
    this.emit({ type: 'finisher', at: t, flawless });
    this.emit({ type: 'boss', phase: 'dead', at: t });
    this.emit({ type: 'anomaly', kind: 'bloodRain', at: t, durationMs: seg.bars * 4 * this.beatMs });
    this.emitMeters();
    this.at(t + this.beatMs * 1.5, () => this.say('boss.death', 3));
    this.at(t + this.beatMs * 5, () => this.say('narr.victory', 3));
    this.at(t + seg.bars * 4 * this.beatMs, () => this.complete());
  }

  private complete(): void {
    this.phase = 'complete';
    this.result = computeResult({
      mode: this.mode,
      seed: this.seed,
      durationMs: this.now - this.startAt,
      score: this.score,
      records: this.records,
      maxCombo: this.maxCombo,
      kills: this.kills,
      assists: this.assists,
      decaps: this.decaps,
      bloodlusts: this.bloodlusts,
      hitsTaken: this.hitsTaken,
      reboots: this.reboots,
      impulsive: this.impulsive,
      execCuts: this.chart.exec.length,
      execCorrect: this.execCorrect,
      butcherPerfect: this.butcherPerfect && this.records.some((r) => r.kind === 'butcher'),
    });
    this.emit({ type: 'complete', result: this.result });
  }

  // ------------------------------------------------------------------ voice & meters

  private say(cue: VoiceCue, priority: number, scripted = false): void {
    void scripted;
    this.voiceLast.set(cue, this.now);
    this.emit({ type: 'voice', cue, priority });
  }

  /** At most once per `beats`. */
  private sayLimited(cue: VoiceCue, priority: number, beats: number): void {
    const last = this.voiceLast.get(cue) ?? -Infinity;
    if (this.now - last < beats * this.beatMs) return;
    this.say(cue, priority);
  }

  private sayOncePerAct(cue: VoiceCue, priority: number): void {
    if (this.actVoice.has(cue)) return;
    this.actVoice.add(cue);
    this.say(cue, priority);
  }

  private record(ln: LiveNote, judgement: Judgement, offset: number | null): void {
    this.records.push({ kind: ln.info.kind, judgement, offset, feint: ln.info.feint, dir: ln.info.dir, at: ln.info.at, segment: ln.segment, repeat: ln.repeat });
  }

  private emitMeters(): void {
    this.emit({ type: 'meters', meters: this.getMeters() });
  }

  private restore(cp: BattleCheckpoint): void {
    this.hp = cp.hp;
    this.score = cp.score;
    this.maxCombo = cp.maxCombo;
    this.kills = cp.kills;
    this.assists = cp.assists;
    this.decaps = cp.decaps;
    this.bloodlusts = cp.bloodlusts;
    this.hitsTaken = cp.hitsTaken;
    this.reboots = cp.reboots;
    this.impulsive = cp.impulsive;
    this.records = [...cp.records];
  }
}

export { BOSS_SIDE };
