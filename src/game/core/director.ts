import { summarizeRun, type MissionResult } from './metrics';
import {
  buildTuning,
  makeOrbPair,
  offerUpgrades,
  planDefense,
  planPhantoms,
  planRunes,
  planTakt,
  ROUND_ORDER,
  roundRng,
  type PlannedAttack,
  type PlannedLoop,
  type Tuning,
} from './plan';
import {
  applyOp,
  isSuccess,
  RESPONSE,
  type Action,
  type AttackKind,
  type AttackRecord,
  type Judgement,
  type ModeId,
  type OrbOp,
  type OrbRecord,
  type RecallRecord,
  type RoundKind,
  type StrikeRecord,
  type UpgradeId,
} from './types';

export type SectionId = 'intro' | RoundKind | 'halftime' | 'finale' | 'breakdown' | 'outro';

export type EchoLineId =
  | 'intro'
  | 'takt'
  | 'taktFaster'
  | 'taktBlind'
  | 'phantoms'
  | 'phantomSubtle'
  | 'overcharge'
  | 'ascension'
  | 'ascend'
  | 'finisher'
  | 'reboot'
  | 'combo';

export interface Meters {
  integrity: number;
  combo: number;
  hype: number;
  score: number;
  enemyHp: number;
  energy: number;
}

export type DirectorEvent =
  | { type: 'section'; id: SectionId; bpm: number; at: number }
  | { type: 'beat'; n: number; bar: number; at: number; beatMs: number }
  | { type: 'intro'; durationMs: number }
  | { type: 'round'; index: number; kind: RoundKind; total: number }
  | { type: 'loop'; round: RoundKind; loop: number; loops: number }
  | { type: 'figures'; real: number; tell: 'strong' | 'subtle' }
  | {
      type: 'windup';
      id: number;
      /** null while the kind is hidden (late reveal / blind). */
      kind: AttackKind | null;
      /**
       * The true kind, for animating the strike itself at the impact instant only.
       * Renderers must never show it earlier — that would break the hidden rule.
       */
      strikeKind: AttackKind;
      source: number;
      phantom: boolean;
      at: number;
      impactAt: number;
      hint: boolean;
      clash: boolean;
    }
  | { type: 'reveal'; id: number; kind: AttackKind; at: number }
  | { type: 'judge'; record: AttackRecord; id: number; clash: boolean; shielded: boolean }
  | { type: 'stray'; action: Action }
  | { type: 'whiff'; action: Action }
  | { type: 'meters'; meters: Meters }
  | { type: 'open'; beats: number[]; endAt: number }
  | { type: 'openEnd' }
  | { type: 'strike'; n: number; onBeat: boolean; damage: number; finisher: boolean }
  | { type: 'orbs'; id: number; left: OrbOp; right: OrbOp; energy: number; at: number; deadline: number }
  | { type: 'orbPick'; id: number; side: 'left' | 'right' | null; correct: boolean; better: 'left' | 'right'; energy: number }
  | { type: 'clashResult'; success: boolean; perfect: boolean; energy: number; damage: number }
  | { type: 'ascend'; durationMs: number }
  | { type: 'rune'; node: number; order: number; pass: number }
  | { type: 'recall'; points: number; perTapMs: number }
  | { type: 'recallTap'; node: number | null; expected: number; correct: boolean; order: number }
  | { type: 'finisher'; durationMs: number; flawless: boolean }
  | { type: 'enemyBroken' }
  | { type: 'upgradeOffer'; cards: UpgradeId[] }
  | { type: 'upgradePicked'; id: UpgradeId; auto: boolean }
  | { type: 'reboot'; durationMs: number }
  | { type: 'echo'; line: EchoLineId }
  | { type: 'roundEnd'; kind: RoundKind }
  | { type: 'complete'; result: MissionResult };

export type DirectorPhase = 'idle' | 'intro' | 'round' | 'upgrade' | 'ascend' | 'recall' | 'finisher' | 'complete';

export interface Checkpoint {
  version: 2;
  mode: ModeId;
  seed: number;
  ease: number;
  hints: boolean;
  round: number;
  upgrades: UpgradeId[];
  now: number;
  meters: Meters;
  maxCombo: number;
  reboots: number;
  hitsTaken: number;
  stray: number;
  attacks: AttackRecord[];
  strikes: StrikeRecord[];
  orbs: OrbRecord[];
  recall: RecallRecord | null;
  savedAt: number;
}

export interface DirectorOptions {
  mode?: ModeId;
  seed?: number;
  /** >1 easier (slower, wider windows), <1 harder. From the Cognitive Engine. */
  ease?: number;
  hints?: boolean;
  resume?: Checkpoint;
  /** Auto-pick an upgrade after this long (ms) so an idle run still completes. */
  upgradeTimeoutMs?: number;
}

interface Cue {
  at: number;
  seq: number;
  fn: () => void;
}

interface LiveAttack {
  id: number;
  plan: PlannedAttack;
  loop: number;
  round: RoundKind;
  windupAt: number;
  impactAt: number;
  revealAt: number | null;
  open: number;
  close: number;
  resolved: boolean;
  clash: boolean;
}

const HYPE_STEPS = [0, 4, 10, 18, 28];
const BASE_SCORE: Partial<Record<Judgement, number>> = { perfect: 100, good: 60, ignored: 60 };
const STRAY_LOCK_MS = 220;
const GRACE_MS = 90;
const MAX_HP = 1000;
const OPEN_BEATS = 3;

/**
 * DuelDirector — deterministic conductor of the mission AWAKENING.
 *
 * All rules and timings live here, on a musical beat grid. Renderers (Phaser,
 * HUD, audio) only listen to events and forward player intents. Time moves
 * only through `update(dt)` / timestamped inputs, so whole runs are simulable.
 */
export class DuelDirector {
  readonly mode: ModeId;
  readonly seed: number;
  readonly ease: number;
  readonly tuning: Tuning;
  private readonly hints: boolean;
  private readonly upgradeTimeoutMs: number;
  private readonly listeners = new Set<(e: DirectorEvent) => void>();

  private now = 0;
  private cues: Cue[] = [];
  private seq = 0;
  private started = false;
  private phase: DirectorPhase = 'idle';

  // music grid
  private sectionAt = 0;
  private beatMs = 500;
  private sectionToken = 0;

  // round
  private roundIndex = -1;
  private roundKind: RoundKind = 'takt';
  private secondWindUsed = false;

  // combat
  private attackSeq = 0;
  private live: LiveAttack[] = [];
  private lockUntil = -Infinity;
  private strikeBeats: number[] = [];
  private strikesUsed = new Set<number>();
  private strikeN = 0;
  private rebootUntil = -Infinity;

  // overcharge
  private orbRng: () => number = () => 0;
  private orb: { id: number; left: OrbOp; right: OrbOp; at: number; deadline: number; done: boolean } | null = null;

  // ascension
  private runes: number[] = [];
  private recall: RecallRecord | null = null;
  private recallToken = 0;
  private halfBeatMs = 1000;

  // meters & records
  private meters: Meters = { integrity: 100, combo: 0, hype: 0, score: 0, enemyHp: MAX_HP, energy: 0 };
  private maxCombo = 0;
  private reboots = 0;
  private hitsTaken = 0;
  private stray = 0;
  private comboEchoDone = false;
  private upgrades: UpgradeId[] = [];
  private offer: UpgradeId[] | null = null;
  private offerToken = 0;
  private readonly attacks: AttackRecord[] = [];
  private readonly strikes: StrikeRecord[] = [];
  private readonly orbs: OrbRecord[] = [];
  private result: MissionResult | null = null;
  private resumeFrom: Checkpoint | null;

  constructor(opts: DirectorOptions = {}) {
    const r = opts.resume ?? null;
    this.mode = r?.mode ?? opts.mode ?? 'spark';
    this.seed = r?.seed ?? opts.seed ?? Date.now() % 2147483647;
    this.ease = r?.ease ?? opts.ease ?? 1;
    this.hints = r?.hints ?? opts.hints ?? true;
    this.tuning = buildTuning(this.mode, this.ease);
    this.upgradeTimeoutMs = opts.upgradeTimeoutMs ?? 15000;
    this.resumeFrom = r;
  }

  // ------------------------------------------------------------------ public API

  on(listener: (e: DirectorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.resumeFrom) {
      this.restore(this.resumeFrom);
      this.resumeFrom = null;
      return;
    }
    this.emitMeters();
    const bpm = this.tuning.bpm.takt;
    this.startSection('intro', bpm, 0);
    this.phase = 'intro';
    const introBeats = 8;
    this.emit({ type: 'intro', durationMs: introBeats * this.beatMs });
    this.emit({ type: 'echo', line: 'intro' });
    this.at(introBeats * this.beatMs, () => this.startRound(0));
  }

  update(dt: number): void {
    if (!this.started || this.phase === 'complete') return;
    this.advanceTo(this.now + Math.max(0, dt));
  }

  /**
   * Player intent. `at` is the moment the finger touched the screen (director ms);
   * it may be slightly in the past (gesture classified late) or future (between frames).
   */
  input(action: Action, at = this.now): void {
    if (!this.started || this.phase === 'complete') return;
    const t = Math.max(this.now - 300, Math.min(at, this.now + 60));
    if (t > this.now) this.advanceTo(t);
    this.handleAction(action, t);
  }

  /** Recall phase: the player tapped a rune of the codex (null = empty space). */
  tapNode(node: number | null, at = this.now): void {
    if (this.phase !== 'recall' || !this.recall) return;
    const t = Math.max(this.now - 300, Math.min(at, this.now + 60));
    if (t > this.now) this.advanceTo(t);
    this.recallTapAt(node, t);
  }

  chooseUpgrade(id: UpgradeId): void {
    if (this.phase !== 'upgrade' || !this.offer || !this.offer.includes(id)) return;
    this.pickUpgrade(id, false);
  }

  getNow(): number {
    return this.now;
  }

  getPhase(): DirectorPhase {
    return this.phase;
  }

  getRound(): { index: number; kind: RoundKind } {
    return { index: this.roundIndex, kind: this.roundKind };
  }

  getMeters(): Meters {
    return { ...this.meters };
  }

  getUpgrades(): UpgradeId[] {
    return [...this.upgrades];
  }

  getOffer(): UpgradeId[] | null {
    return this.offer ? [...this.offer] : null;
  }

  isOrbActive(): boolean {
    return !!this.orb && !this.orb.done;
  }

  getResult(): MissionResult | null {
    return this.result;
  }

  /** Beat grid of the current music section (for renderers that draw rhythm). */
  getGrid(): { at: number; beatMs: number } {
    return { at: this.sectionAt, beatMs: this.beatMs };
  }

  /** Available right after a round starts (and only then). */
  getCheckpoint(): Checkpoint | null {
    if (this.phase !== 'round' || this.roundIndex < 0 || this.checkpointRound !== this.roundIndex) return null;
    return {
      version: 2,
      mode: this.mode,
      seed: this.seed,
      ease: this.ease,
      hints: this.hints,
      round: this.roundIndex,
      upgrades: [...this.upgrades],
      now: this.roundStartNow,
      meters: { ...this.roundStartMeters },
      maxCombo: this.roundStartMaxCombo,
      reboots: this.reboots,
      hitsTaken: this.hitsTaken,
      stray: this.stray,
      attacks: this.attacks.map((a) => ({ ...a })),
      strikes: this.strikes.map((s) => ({ ...s })),
      orbs: this.orbs.map((o) => ({ ...o })),
      recall: null,
      savedAt: Date.now(),
    };
  }

  // ------------------------------------------------------------------ scheduling

  private emit(e: DirectorEvent): void {
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
      if (this.isComplete()) return;
    }
    this.now = Math.max(this.now, target);
  }

  private isComplete(): boolean {
    return this.phase === 'complete';
  }

  private startSection(id: SectionId, bpm: number, at: number): void {
    this.sectionAt = at;
    this.beatMs = 60000 / bpm;
    const token = ++this.sectionToken;
    this.emit({ type: 'section', id, bpm, at });
    const beatMs = this.beatMs;
    const tick = (n: number) => {
      if (token !== this.sectionToken) return;
      this.emit({ type: 'beat', n, bar: n % 4, at: at + n * beatMs, beatMs });
      this.at(at + (n + 1) * beatMs, () => tick(n + 1));
    };
    this.at(at, () => tick(0));
  }

  /** Time of beat `b` in the current section. */
  private beat(b: number): number {
    return this.sectionAt + b * this.beatMs;
  }

  // ------------------------------------------------------------------ rounds

  private roundStartNow = 0;
  private roundStartMeters: Meters = { ...this.meters };
  private roundStartMaxCombo = 0;
  private checkpointRound = -1;

  private startRound(index: number): void {
    this.roundIndex = index;
    this.roundKind = ROUND_ORDER[index];
    this.phase = 'round';
    this.secondWindUsed = false;
    this.roundStartNow = this.now;
    this.roundStartMeters = { ...this.meters };
    this.roundStartMaxCombo = this.maxCombo;
    this.checkpointRound = index;
    this.startSection(this.roundKind, this.tuning.bpm[this.roundKind], this.now);
    this.emit({ type: 'round', index, kind: this.roundKind, total: ROUND_ORDER.length });
    this.emit({ type: 'echo', line: this.roundKind });
    const body = 4; // one bar for the directive card
    switch (this.roundKind) {
      case 'takt': {
        const loops = planTakt(this.seed, this.tuning).map((l) => this.applyHints(l));
        this.runLoops('takt', loops, body, () => this.endRound());
        break;
      }
      case 'phantoms': {
        const loops = planPhantoms(this.seed, this.tuning, this.upgrades.includes('phantomSight')).map((l) => this.applyHints(l));
        this.runLoops('phantoms', loops, body, () => this.endRound());
        break;
      }
      case 'overcharge':
        this.runOvercharge(body);
        break;
      case 'ascension':
        this.runAscension(body);
        break;
    }
  }

  private applyHints(loop: PlannedLoop): PlannedLoop {
    if (this.hints) return loop;
    return { ...loop, attacks: loop.attacks.map((a) => ({ ...a, hint: false })) };
  }

  private endRound(): void {
    this.emit({ type: 'roundEnd', kind: this.roundKind });
    this.checkpointRound = -1;
    if (this.roundIndex >= ROUND_ORDER.length - 1) return;
    const next = ROUND_ORDER[this.roundIndex + 1];
    this.offer = offerUpgrades(this.seed, this.roundIndex, next, this.upgrades);
    this.phase = 'upgrade';
    this.startSection('breakdown', this.tuning.bpm[this.roundKind], this.now);
    this.emit({ type: 'upgradeOffer', cards: [...this.offer] });
    const token = ++this.offerToken;
    this.at(this.now + this.upgradeTimeoutMs, () => {
      if (token === this.offerToken && this.phase === 'upgrade' && this.offer) this.pickUpgrade(this.offer[0], true);
    });
  }

  private pickUpgrade(id: UpgradeId, auto: boolean): void {
    this.offerToken++;
    this.upgrades.push(id);
    this.offer = null;
    this.emit({ type: 'upgradePicked', id, auto });
    // Start the next round on the next downbeat of the breakdown groove.
    const barMs = this.beatMs * 4;
    const sinceBar = (this.now - this.sectionAt) % barMs;
    const nextBar = this.now - sinceBar + barMs;
    const startAt = nextBar - this.now < this.beatMs ? nextBar + barMs : nextBar;
    this.phase = 'round';
    this.at(startAt, () => this.startRound(this.roundIndex + 1));
  }

  // ------------------------------------------------------------------ attack loops

  /** Loop layout: windups every 2 beats, impacts on even beats, then a 3-beat strike window. */
  private runLoops(round: RoundKind, loops: PlannedLoop[], firstBeat: number, done: () => void): void {
    let b = firstBeat;
    loops.forEach((loop, li) => {
      const loopStart = b;
      this.at(this.beat(loopStart), () => {
        this.emit({ type: 'loop', round, loop: li, loops: loops.length });
        if (loop.real !== undefined) this.emit({ type: 'figures', real: loop.real, tell: loop.tell ?? 'strong' });
        if (round === 'takt' && li === 2) this.emit({ type: 'echo', line: 'taktFaster' });
        if (round === 'takt' && li === 3) this.emit({ type: 'echo', line: 'taktBlind' });
        if (round === 'phantoms' && loop.tell === 'subtle') this.emit({ type: 'echo', line: 'phantomSubtle' });
      });
      loop.attacks.forEach((a, j) => this.scheduleAttack(a, li, loopStart + 2 * j, loopStart + 2 * j + 2, false));
      const lastImpact = loopStart + 2 * loop.attacks.length;
      this.scheduleOpen(lastImpact, round);
      b = lastImpact + OPEN_BEATS + 1;
    });
    this.at(this.beat(b), done);
  }

  private scheduleAttack(plan: PlannedAttack, loop: number, windupBeat: number, impactBeat: number, clash: boolean): void {
    const windupAt = this.beat(windupBeat);
    const impactAt = this.beat(impactBeat);
    this.at(windupAt, () => this.beginAttack(plan, loop, windupAt, impactAt, clash));
  }

  private beginAttack(plan: PlannedAttack, loop: number, windupAt: number, impactAt: number, clash: boolean): void {
    const foresight = this.upgrades.includes('foresight');
    const revealLead = plan.reveal === 'late' ? (foresight ? 1.5 : 1) * this.beatMs : 0;
    const revealAt = plan.reveal === 'early' ? windupAt : plan.reveal === 'late' ? impactAt - revealLead : null;
    const atk: LiveAttack = {
      id: ++this.attackSeq,
      plan,
      loop,
      round: this.roundKind,
      windupAt,
      impactAt,
      revealAt,
      open: impactAt - this.tuning.earlyMs,
      close: impactAt + this.tuning.lateMs,
      resolved: false,
      clash,
    };
    this.live.push(atk);
    this.emit({
      type: 'windup',
      id: atk.id,
      kind: plan.reveal === 'early' ? plan.kind : null,
      strikeKind: plan.kind,
      source: plan.source,
      phantom: plan.phantom,
      at: windupAt,
      impactAt,
      hint: plan.hint && plan.reveal === 'early',
      clash,
    });
    if (plan.reveal === 'late' && revealAt !== null) {
      this.at(revealAt, () => {
        if (!atk.resolved) this.emit({ type: 'reveal', id: atk.id, kind: plan.kind, at: revealAt });
      });
    }
    this.at(atk.close + GRACE_MS, () => {
      if (!atk.resolved) this.judge(atk, plan.phantom ? 'ignored' : 'miss', null, null);
    });
  }

  private scheduleOpen(lastImpactBeat: number, round: RoundKind): void {
    const beats = Array.from({ length: OPEN_BEATS }, (_, k) => this.beat(lastImpactBeat + 1 + k));
    const endAt = beats[beats.length - 1] + 200;
    this.at(this.beat(lastImpactBeat) + this.tuning.lateMs + GRACE_MS + 1, () => {
      this.strikeBeats = beats;
      this.strikesUsed = new Set();
      this.strikeN = 0;
      this.emit({ type: 'enemyBroken' });
      this.emit({ type: 'open', beats, endAt });
    });
    this.at(endAt, () => {
      this.strikeBeats = [];
      this.emit({ type: 'openEnd' });
    });
    void round;
  }

  // ------------------------------------------------------------------ input handling

  private handleAction(action: Action, t: number): void {
    if (this.phase === 'upgrade' || this.phase === 'recall' || this.phase === 'intro' || this.phase === 'finisher') {
      if (action === 'tap' || action === 'up' || action === 'down') this.emit({ type: 'whiff', action });
      return;
    }
    if (this.orb && !this.orb.done && (action === 'left' || action === 'right')) {
      this.pickOrb(action, t);
      return;
    }
    // 1) an attack window
    const atk = this.live
      .filter((a) => !a.resolved && t >= a.open && t <= a.close)
      .sort((a, b) => Math.abs(a.impactAt - t) - Math.abs(b.impactAt - t))[0];
    if (atk) {
      if (t < this.lockUntil) {
        this.emit({ type: 'stray', action });
        return;
      }
      if (atk.plan.phantom) {
        this.judge(atk, 'fooled', action, t);
        return;
      }
      if (action === RESPONSE[atk.plan.kind]) {
        const perfectMs = this.tuning.perfectMs + (this.upgrades.includes('coldMind') ? 25 : 0);
        this.judge(atk, Math.abs(t - atk.impactAt) <= perfectMs ? 'perfect' : 'good', action, t);
      } else {
        this.judge(atk, 'wrong', action, t);
      }
      return;
    }
    // 2) a strike beat of the open phase
    if (action === 'tap' && this.strikeBeats.length) {
      let best = -1;
      let bestD = Infinity;
      this.strikeBeats.forEach((bt, i) => {
        const d = Math.abs(t - bt);
        if (d < bestD && !this.strikesUsed.has(i)) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0 && bestD <= this.beatMs * 0.5) {
        this.strike(best, t - this.strikeBeats[best]);
        return;
      }
    }
    // 3) an input while an attack is winding up: impatience
    const winding = this.live.some((a) => !a.resolved && t >= a.windupAt && t < a.open);
    if (winding) {
      this.lockUntil = t + STRAY_LOCK_MS;
      this.stray++;
      this.emit({ type: 'stray', action });
      return;
    }
    this.emit({ type: 'whiff', action });
  }

  private judge(atk: LiveAttack, j: Judgement, action: Action | null, t: number | null): void {
    atk.resolved = true;
    this.live = this.live.filter((a) => a !== atk && !(a.resolved && a.close < this.now - 1000));
    const record: AttackRecord = {
      i: this.attacks.length,
      round: atk.round,
      loop: atk.loop,
      kind: atk.plan.kind,
      phantom: atk.plan.phantom,
      reveal: atk.plan.reveal,
      impactMs: Math.round(atk.impactAt),
      action,
      offsetMs: t === null ? null : Math.round(t - atk.impactAt),
      reactionMs: t !== null && atk.revealAt !== null && isSuccess(j) ? Math.round(t - atk.revealAt) : null,
      judgement: j,
    };
    this.attacks.push(record);
    let shielded = false;
    if (isSuccess(j)) {
      this.addCombo(1);
      this.addScore(BASE_SCORE[j] ?? 0);
      if (j === 'perfect' && this.upgrades.includes('resonance')) this.damageEnemy(30);
    } else if (j === 'fooled') {
      this.breakCombo();
    } else {
      // miss / wrong — a real hit, unless rebooting or protected
      this.breakCombo();
      if (this.now < this.rebootUntil) {
        shielded = true;
      } else if (this.upgrades.includes('secondWind') && !this.secondWindUsed) {
        this.secondWindUsed = true;
        shielded = true;
      } else {
        this.hitsTaken++;
        this.meters.integrity = Math.max(0, this.meters.integrity - 15);
        if (this.meters.integrity <= 0) this.beginReboot();
      }
    }
    this.emit({ type: 'judge', record, id: atk.id, clash: atk.clash, shielded });
    if (atk.clash) this.resolveClash(j);
    this.emitMeters();
  }

  private strike(beatIndex: number, offset: number): void {
    this.strikesUsed.add(beatIndex);
    this.strikeN++;
    const onBeat = Math.abs(offset) <= 90;
    let dmg = onBeat ? 40 : 15;
    if (onBeat && this.upgrades.includes('bloodRhythm')) dmg = Math.round(dmg * 1.5);
    this.damageEnemy(dmg);
    if (onBeat) {
      this.addCombo(this.upgrades.includes('bloodRhythm') ? 2 : 1);
      this.addScore(40);
    } else {
      this.addScore(15);
    }
    this.strikes.push({ round: this.roundKind, onBeat, offsetMs: Math.round(offset), damage: dmg });
    this.emit({ type: 'strike', n: this.strikeN, onBeat, damage: dmg, finisher: this.strikeN === OPEN_BEATS });
    this.emitMeters();
  }

  // ------------------------------------------------------------------ overcharge (mental arithmetic)

  private runOvercharge(firstBeat: number): void {
    this.orbRng = roundRng(this.seed, 2);
    this.meters.energy = 3 + Math.floor(this.orbRng() * 3) + (this.upgrades.includes('overclock') ? 3 : 0);
    this.emitMeters();
    const pairs = this.tuning.orbPairs;
    for (let k = 0; k < pairs; k++) {
      const spawnBeat = firstBeat + 4 * k;
      this.at(this.beat(spawnBeat), () => this.spawnOrbs(k, this.beat(spawnBeat + 4) - 150));
    }
    // The charged clash: 4-beat windup, parry on the beat.
    const clashWindup = firstBeat + 4 * pairs;
    this.scheduleAttack({ kind: 'mid', phantom: false, source: 0, reveal: 'early', hint: true }, 0, clashWindup, clashWindup + 4, true);
    this.scheduleOpen(clashWindup + 4, 'overcharge');
    this.at(this.beat(clashWindup + 4 + OPEN_BEATS + 1), () => this.endRound());
  }

  private spawnOrbs(id: number, deadline: number): void {
    const { left, right } = makeOrbPair(this.orbRng, this.meters.energy, id);
    this.orb = { id, left, right, at: this.now, deadline, done: false };
    this.emit({ type: 'orbs', id, left, right, energy: this.meters.energy, at: this.now, deadline });
    this.at(deadline, () => {
      if (this.orb && this.orb.id === id && !this.orb.done) this.resolveOrb(null, null);
    });
  }

  private pickOrb(side: 'left' | 'right', t: number): void {
    this.resolveOrb(side, t);
  }

  private resolveOrb(side: 'left' | 'right' | null, t: number | null): void {
    const o = this.orb;
    if (!o || o.done) return;
    o.done = true;
    const before = this.meters.energy;
    const vl = applyOp(before, o.left);
    const vr = applyOp(before, o.right);
    const better: 'left' | 'right' = vl >= vr ? 'left' : 'right';
    const correct = side === better;
    if (side) this.meters.energy = side === 'left' ? vl : vr;
    this.orbs.push({ i: o.id, energyBefore: before, left: o.left, right: o.right, chosen: side, correct, decisionMs: t === null ? null : Math.round(t - o.at) });
    if (correct) {
      this.addCombo(1);
      this.addScore(100);
    } else {
      this.breakCombo();
    }
    this.emit({ type: 'orbPick', id: o.id, side, correct, better, energy: this.meters.energy });
    this.emitMeters();
  }

  private resolveClash(j: Judgement): void {
    const success = j === 'perfect' || j === 'good';
    const energy = this.meters.energy;
    const damage = Math.round(energy * (success ? (j === 'perfect' ? 12 : 9) : 4));
    this.damageEnemy(damage);
    if (success) this.addScore(j === 'perfect' ? 200 : 120);
    this.emit({ type: 'clashResult', success, perfect: j === 'perfect', energy, damage });
  }

  // ------------------------------------------------------------------ ascension (visual memory)

  private runAscension(firstBeat: number): void {
    const defense = planDefense(this.seed, this.tuning);
    this.runes = planRunes(this.seed, this.tuning);
    this.runLoopsNoOpen(defense, firstBeat, (afterBeat) => {
      this.at(this.beat(afterBeat), () => this.beginAscend());
    });
  }

  /** A single defense loop without a strike window — the Ascension takes its place. */
  private runLoopsNoOpen(loop: PlannedLoop, firstBeat: number, done: (afterBeat: number) => void): void {
    this.at(this.beat(firstBeat), () => this.emit({ type: 'loop', round: this.roundKind, loop: 0, loops: 1 }));
    loop.attacks.forEach((a, j) => this.scheduleAttack(a, 0, firstBeat + 2 * j, firstBeat + 2 * j + 2, false));
    done(firstBeat + 2 * loop.attacks.length + 1);
  }

  private beginAscend(): void {
    this.phase = 'ascend';
    const bpm = this.tuning.bpm.ascension / 2;
    this.startSection('halftime', bpm, this.now);
    this.halfBeatMs = this.beatMs;
    const passes = this.upgrades.includes('echoMemory') ? 2 : 1;
    const showBeats = 1 + passes * (this.runes.length + 1);
    this.emit({ type: 'ascend', durationMs: showBeats * this.halfBeatMs });
    this.emit({ type: 'echo', line: 'ascend' });
    let b = 1;
    for (let p = 0; p < passes; p++) {
      this.runes.forEach((node, order) => {
        const pass = p;
        this.at(this.beat(b), () => this.emit({ type: 'rune', node, order, pass }));
        b++;
      });
      b++;
    }
    this.at(this.beat(b), () => this.beginRecall());
  }

  private beginRecall(): void {
    this.phase = 'recall';
    this.recall = { sequence: [...this.runes], taps: [] };
    const perTap = this.halfBeatMs * 3;
    this.recallStartAt = this.now;
    this.emit({ type: 'recall', points: this.runes.length, perTapMs: perTap });
    this.armRecallTimeout(this.now + perTap);
  }

  private recallStartAt = 0;

  private armRecallTimeout(deadline: number): void {
    const token = ++this.recallToken;
    this.at(deadline, () => {
      if (token === this.recallToken && this.phase === 'recall') this.recallTapAt(null, this.now);
    });
  }

  private recallTapAt(node: number | null, t: number): void {
    const rc = this.recall;
    if (!rc) return;
    const order = rc.taps.length;
    const expected = rc.sequence[order];
    if (expected === undefined) return;
    const correct = node === expected;
    rc.taps.push({ node, expected, correct, ms: Math.round(t - this.recallStartAt) });
    if (correct) {
      this.addCombo(1);
      this.addScore(150);
      this.damageEnemy(80);
    } else {
      this.breakCombo();
    }
    this.emit({ type: 'recallTap', node, expected, correct, order });
    this.emitMeters();
    if (rc.taps.length >= rc.sequence.length) {
      this.recallToken++;
      this.beginFinisher();
    } else {
      this.armRecallTimeout(t + this.halfBeatMs * 3);
    }
  }

  private beginFinisher(): void {
    this.phase = 'finisher';
    const flawless = !!this.recall && this.recall.taps.every((x) => x.correct);
    if (flawless) this.addScore(300);
    const bpm = this.tuning.bpm.ascension;
    // Drop on the next half-beat boundary.
    const since = (this.now - this.sectionAt) % this.halfBeatMs;
    const dropAt = this.now + (this.halfBeatMs - since);
    this.at(dropAt, () => {
      this.startSection('finale', bpm, this.now);
      const dur = 8 * this.beatMs;
      this.emit({ type: 'finisher', durationMs: dur, flawless });
      this.emit({ type: 'echo', line: 'finisher' });
      this.at(this.beat(4), () => {
        this.meters.enemyHp = 0;
        this.emitMeters();
      });
      this.at(this.beat(8), () => this.complete());
    });
  }

  private complete(): void {
    this.phase = 'complete';
    this.emit({ type: 'roundEnd', kind: 'ascension' });
    this.result = summarizeRun({
      mode: this.mode,
      seed: this.seed,
      durationMs: Math.round(this.now),
      score: Math.round(this.meters.score),
      maxCombo: this.maxCombo,
      attacks: this.attacks,
      strikes: this.strikes,
      orbs: this.orbs,
      recall: this.recall,
      reboots: this.reboots,
      hitsTaken: this.hitsTaken,
      stray: this.stray,
      upgrades: this.upgrades,
    });
    this.startSection('outro', this.tuning.bpm.takt, this.now);
    this.sectionToken++; // no beats needed after the end
    this.emit({ type: 'complete', result: this.result });
  }

  // ------------------------------------------------------------------ meters

  private addCombo(n: number): void {
    const before = this.meters.combo;
    this.meters.combo += n;
    this.maxCombo = Math.max(this.maxCombo, this.meters.combo);
    if (this.upgrades.includes('thirst') && Math.floor(this.meters.combo / 10) > Math.floor(before / 10)) {
      this.meters.integrity = Math.min(100, this.meters.integrity + 10);
    }
    if (!this.comboEchoDone && this.meters.combo >= 20) {
      this.comboEchoDone = true;
      this.emit({ type: 'echo', line: 'combo' });
    }
    this.updateHype();
  }

  private breakCombo(): void {
    this.meters.combo = 0;
    this.updateHype();
  }

  private updateHype(): void {
    let h = 0;
    for (let i = 0; i < HYPE_STEPS.length; i++) if (this.meters.combo >= HYPE_STEPS[i]) h = i;
    this.meters.hype = h;
  }

  private addScore(base: number): void {
    const mult = 1 + Math.min(this.meters.combo, 40) / 40;
    this.meters.score += base * mult;
  }

  private damageEnemy(n: number): void {
    // VERDICT cannot fall before the finisher — the story beat belongs to the Ascension.
    this.meters.enemyHp = Math.max(60, this.meters.enemyHp - n);
  }

  private beginReboot(): void {
    this.reboots++;
    const dur = 4 * this.beatMs;
    this.rebootUntil = this.now + dur;
    this.emit({ type: 'reboot', durationMs: dur });
    this.emit({ type: 'echo', line: 'reboot' });
    this.at(this.now + dur, () => {
      this.meters.integrity = 50;
      this.emitMeters();
    });
  }

  private emitMeters(): void {
    this.emit({ type: 'meters', meters: { ...this.meters, score: Math.round(this.meters.score) } });
  }

  // ------------------------------------------------------------------ checkpoint

  private restore(cp: Checkpoint): void {
    this.now = cp.now;
    this.meters = { ...cp.meters };
    this.maxCombo = cp.maxCombo;
    this.reboots = cp.reboots;
    this.hitsTaken = cp.hitsTaken;
    this.stray = cp.stray;
    this.upgrades = [...cp.upgrades];
    this.attacks.push(...cp.attacks);
    this.strikes.push(...cp.strikes);
    this.orbs.push(...cp.orbs);
    this.comboEchoDone = this.maxCombo >= 20;
    this.emitMeters();
    this.startRound(cp.round);
  }
}

export function kindOf(action: Action): AttackKind | null {
  return action === 'tap' ? 'mid' : action === 'down' ? 'high' : action === 'up' ? 'low' : null;
}
