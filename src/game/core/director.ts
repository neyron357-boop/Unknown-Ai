import { buildMissionConfig, clamp, WEAK_POINT_NODES, type MissionConfig, type ScriptedAttack } from './missionConfig';
import { createRng, pickDistinct } from './random';
import { hintActions, isCorrect } from './rules';
import { summarizeMission, type MissionResult } from './metrics';
import {
  isSuccess,
  type Action,
  type AscensionRecord,
  type AscensionTap,
  type AttackRecord,
  type AttackType,
  type Outcome,
  type StageId,
  type TutorialRecord,
} from './types';

export type DirectorPhase =
  | 'awakeningCine'
  | 'tutorial'
  | 'tutorialGap'
  | 'stageIntro'
  | 'gap'
  | 'telegraph'
  | 'recover'
  | 'reboot'
  | 'assist'
  | 'ascendTrigger'
  | 'ascendShow'
  | 'ascendRecall'
  | 'ascendStrike'
  | 'finisher'
  | 'complete';

export type LoopKey = 'contact' | 'pattern' | 'overdrive';

export type CinematicId = 'awaken' | 'enemyIntro' | 'patternIntro' | 'overdriveIntro';

export type EchoLineId =
  | 'awaken'
  | 'contact'
  | 'patternIntro'
  | 'firstRead'
  | 'assist'
  | 'reboot'
  | 'overdrive'
  | 'newAttack'
  | 'ascend'
  | 'finisher';

export type DirectorEvent =
  | { type: 'stage'; stage: StageId; loop: LoopKey | null; traceDepth: number }
  | { type: 'cinematic'; id: CinematicId; durationMs: number }
  | { type: 'tutorialStep'; step: number; total: number; expect: Action }
  | { type: 'tutorialResult'; step: number; result: 'ok' | 'wrong' | 'auto'; action: Action | null }
  | { type: 'gap'; durationMs: number; predictable: boolean }
  | { type: 'predictCommit'; action: Action }
  | { type: 'inputIgnored'; action: Action }
  | {
      type: 'telegraph';
      attack: AttackType;
      durationMs: number;
      index: number;
      hint: Action[] | null;
      isNew: boolean;
    }
  | { type: 'reaction'; action: Action; correct: boolean }
  | { type: 'stagger'; durationMs: number; predicted: Action }
  | { type: 'resolve'; record: AttackRecord }
  | { type: 'strike'; attack: AttackType; outcome: Outcome; damage: number; dodged: Action | null }
  | { type: 'meters'; aura: number; integrity: number; barrier: number }
  | { type: 'reboot'; durationMs: number }
  | { type: 'echo'; line: EchoLineId }
  | { type: 'ascendTrigger'; index: number; trigger: AscensionRecord['trigger']; durationMs: number }
  | { type: 'ascendNode'; node: number; order: number; onMs: number }
  | { type: 'ascendRecall'; durationMs: number; points: number; candidates: number }
  | { type: 'ascendTap'; tap: AscensionTap; order: number }
  | { type: 'ascendStrike'; index: number; hits: number; total: number; damage: number; final: boolean; durationMs: number }
  | { type: 'finisher'; durationMs: number }
  | { type: 'complete'; result: MissionResult };

export interface Checkpoint {
  version: 1;
  mode: MissionConfig['mode'];
  seed: number;
  telegraphScale: number;
  resumeAt: 'pattern' | 'overdrive';
  now: number;
  aura: number;
  integrity: number;
  barrier: number;
  attackIndex: number;
  reboots: number;
  assists: number;
  attacks: AttackRecord[];
  ascensions: AscensionRecord[];
  tutorial: TutorialRecord[];
  savedAt: number;
}

export interface DirectorOptions {
  config?: MissionConfig;
  /** Shortcut when no explicit config is passed. */
  mode?: MissionConfig['mode'];
  seed?: number;
  telegraphScale?: number;
  /** Adaptive hints (in-context gesture hints after repeated errors). Demo hints are always shown. */
  hints?: boolean;
  resume?: Checkpoint;
}

interface CurrentAttack {
  type: AttackType;
  telegraphMs: number;
  telegraphStart: number;
  hinted: boolean;
  predicted: Action | null;
  staggerUntil: number;
  response: Action | null;
  record: AttackRecord | null;
}

const TUTORIAL_STEPS: Action[] = ['dodgeR', 'dodgeL', 'block'];
const AURA_FULL = 100;

/**
 * MissionDirector — deterministic state machine for the mission AWAKENING.
 *
 * It owns every rule and every timing. Renderers (Phaser scene, HUD) only
 * listen to events and forward player intents. Time advances exclusively via
 * `update(dt)`, which makes the whole mission simulable in tests.
 */
export class MissionDirector {
  readonly config: MissionConfig;
  private readonly listeners = new Set<(e: DirectorEvent) => void>();
  private readonly hintsEnabled: boolean;
  private readonly rng: () => number;

  private now = 0;
  private phase: DirectorPhase = 'awakeningCine';
  private phaseEnd = 0;
  private stage: StageId = 'awakening';
  private loop: LoopKey | null = null;

  // meters
  private aura = 0;
  private integrity: number;
  private barrier = 100;

  // tutorial
  private tutorialStep = 0;
  private tutorialStart = 0;
  private tutorialWrong = 0;
  private readonly tutorial: TutorialRecord[] = [];

  // attacks
  private attackIndex = 0;
  private stageAttackCount = 0;
  private scriptIndex = 0;
  private current: CurrentAttack | null = null;
  private readonly attacks: AttackRecord[] = [];
  private readonly failStreak: Partial<Record<AttackType, number>> = {};
  private readonly seenTypes = new Set<AttackType>();
  private reboots = 0;
  private assists = 0;
  private firstReadAnnounced = false;

  // ascension
  private ascensionIndex = 0;
  private ascension: AscensionRecord | null = null;
  private showOrder = 0;
  private nextShowAt = 0;
  private recallStart = 0;
  private readonly ascensions: AscensionRecord[] = [];

  private started = false;
  private result: MissionResult | null = null;
  private resumeFrom: Checkpoint | null;

  constructor(options: DirectorOptions = {}) {
    const resume = options.resume ?? null;
    this.config =
      options.config ??
      buildMissionConfig({
        mode: resume?.mode ?? options.mode ?? 'spark',
        seed: resume?.seed ?? options.seed ?? Date.now() % 2147483647,
        telegraphScale: resume?.telegraphScale ?? options.telegraphScale ?? 1,
      });
    this.hintsEnabled = options.hints ?? true;
    this.rng = createRng(this.config.seed);
    this.integrity = this.config.integrity.max;
    this.resumeFrom = resume;
  }

  // ---------------------------------------------------------------- public API

  on(listener: (e: DirectorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Begins the mission (or resumes from a checkpoint). Call once after listeners are attached. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.resumeFrom) {
      this.restore(this.resumeFrom);
      this.resumeFrom = null;
      return;
    }
    this.enterStage('awakening', null);
    this.setPhase('awakeningCine', this.config.awakening.cineMs);
    this.emit({ type: 'cinematic', id: 'awaken', durationMs: this.config.awakening.cineMs });
    this.emit({ type: 'echo', line: 'awaken' });
    this.emitMeters();
  }

  /** Advances mission time. dt in milliseconds. */
  update(dt: number): void {
    if (!this.started || this.phase === 'complete') return;
    const target = this.now + Math.max(0, dt);
    // Process every boundary that falls inside this step so large dt values stay exact.
    let guard = 0;
    while (guard++ < 64) {
      const boundary = this.nextBoundary();
      if (boundary === null || boundary > target) break;
      this.now = boundary;
      this.onBoundary();
      if (this.isComplete()) return;
    }
    this.now = target;
  }

  /** Player intent: dash or shield. `lagMs` = time since the last update, to timestamp precisely. */
  input(action: Action, lagMs = 0): void {
    if (!this.started) return;
    const at = this.now + clamp(lagMs, 0, 50);
    switch (this.phase) {
      case 'tutorial':
        this.handleTutorialInput(action, at);
        return;
      case 'gap':
        this.handleGapInput(action);
        return;
      case 'telegraph':
        this.handleTelegraphInput(action, at);
        return;
      default:
        return;
    }
  }

  /** Ascension recall: the player tapped a weak-point node (or empty space = null). */
  tapNode(node: number | null, lagMs = 0): void {
    if (this.phase !== 'ascendRecall' || !this.ascension) return;
    const order = this.ascension.taps.length;
    const expected = this.ascension.sequence[order];
    if (expected === undefined) return;
    const at = this.now + clamp(lagMs, 0, 50);
    const tap: AscensionTap = { node, expected, correct: node === expected, ms: Math.round(at - this.recallStart) };
    this.ascension.taps.push(tap);
    this.emit({ type: 'ascendTap', tap, order });
    if (this.ascension.taps.length >= this.ascension.sequence.length) {
      this.beginAscendStrike();
    }
  }

  isComplete(): boolean {
    return this.phase === 'complete';
  }

  getPhase(): DirectorPhase {
    return this.phase;
  }

  getStage(): StageId {
    return this.stage;
  }

  getLoop(): LoopKey | null {
    return this.loop;
  }

  getNow(): number {
    return this.now;
  }

  getMeters(): { aura: number; integrity: number; barrier: number } {
    return { aura: this.aura, integrity: this.integrity, barrier: this.barrier };
  }

  getResult(): MissionResult | null {
    return this.result;
  }

  /** Whether the current gap accepts predictions (used by renderers for the prediction ring). */
  isPredictionWindow(): boolean {
    return this.phase === 'gap' && (this.loop === 'pattern' || this.loop === 'overdrive') && !this.current?.predicted;
  }

  /** A checkpoint is available at the start of the pattern and overdrive stages. */
  getCheckpoint(): Checkpoint | null {
    if (this.phase !== 'stageIntro' || (this.loop !== 'pattern' && this.loop !== 'overdrive')) return null;
    return {
      version: 1,
      mode: this.config.mode,
      seed: this.config.seed,
      telegraphScale: this.config.telegraphScale,
      resumeAt: this.loop,
      now: this.now,
      aura: this.aura,
      integrity: this.integrity,
      barrier: this.barrier,
      attackIndex: this.attackIndex,
      reboots: this.reboots,
      assists: this.assists,
      attacks: this.attacks.map((a) => ({ ...a })),
      ascensions: this.ascensions.map((a) => ({ ...a, sequence: [...a.sequence], taps: a.taps.map((t) => ({ ...t })) })),
      tutorial: this.tutorial.map((t) => ({ ...t })),
      savedAt: Date.now(),
    };
  }

  // ---------------------------------------------------------------- internals

  private emit(e: DirectorEvent): void {
    for (const l of this.listeners) l(e);
  }

  private emitMeters(): void {
    this.emit({ type: 'meters', aura: this.aura, integrity: this.integrity, barrier: this.barrier });
  }

  private setPhase(phase: DirectorPhase, durationMs: number): void {
    this.phase = phase;
    this.phaseEnd = this.now + durationMs;
  }

  private enterStage(stage: StageId, loop: LoopKey | null): void {
    this.stage = stage;
    this.loop = loop;
    const traceDepth =
      loop === 'pattern' ? this.config.pattern.traceDepth : loop === 'overdrive' ? this.config.overdrive.traceDepth : 0;
    this.emit({ type: 'stage', stage, loop, traceDepth });
  }

  private nextBoundary(): number | null {
    if (this.phase === 'complete') return null;
    if (this.phase === 'ascendShow' && this.nextShowAt < this.phaseEnd) return this.nextShowAt;
    return this.phaseEnd;
  }

  private onBoundary(): void {
    switch (this.phase) {
      case 'awakeningCine':
        this.beginTutorialStep(0);
        return;
      case 'tutorial':
        this.finishTutorialStep('auto', null);
        return;
      case 'tutorialGap':
        if (this.tutorialStep + 1 < TUTORIAL_STEPS.length) this.beginTutorialStep(this.tutorialStep + 1);
        else this.beginContact();
        return;
      case 'stageIntro':
        this.beginAttack();
        return;
      case 'gap':
        this.beginTelegraph();
        return;
      case 'telegraph':
        this.strike();
        return;
      case 'recover':
      case 'reboot':
        if (this.phase === 'reboot') {
          this.integrity = this.config.integrity.rebootRestore;
          this.aura = Math.floor(this.aura * 0.5);
          this.emitMeters();
        }
        this.afterAttack();
        return;
      case 'assist':
        this.beginAscendTrigger('assist');
        return;
      case 'ascendTrigger':
        this.beginAscendShow();
        return;
      case 'ascendShow':
        if (this.now >= this.phaseEnd) this.beginAscendRecall();
        else this.showNextNode();
        return;
      case 'ascendRecall':
        this.timeoutRecall();
        return;
      case 'ascendStrike':
        this.afterAscendStrike();
        return;
      case 'finisher':
        this.complete();
        return;
      default:
        return;
    }
  }

  // --- stage 1: awakening -----------------------------------------------------

  private beginTutorialStep(step: number): void {
    this.tutorialStep = step;
    this.tutorialStart = this.now;
    this.tutorialWrong = 0;
    this.setPhase('tutorial', this.config.awakening.stepTimeoutMs);
    this.emit({ type: 'tutorialStep', step, total: TUTORIAL_STEPS.length, expect: TUTORIAL_STEPS[step] });
  }

  private handleTutorialInput(action: Action, at: number): void {
    const expect = TUTORIAL_STEPS[this.tutorialStep];
    if (action === expect) {
      this.tutorial.push({ expect, ms: Math.round(at - this.tutorialStart), wrongInputs: this.tutorialWrong });
      this.finishTutorialStep('ok', action);
    } else {
      this.tutorialWrong++;
      this.emit({ type: 'tutorialResult', step: this.tutorialStep, result: 'wrong', action });
    }
  }

  private finishTutorialStep(result: 'ok' | 'auto', action: Action | null): void {
    if (result === 'auto') {
      this.tutorial.push({ expect: TUTORIAL_STEPS[this.tutorialStep], ms: null, wrongInputs: this.tutorialWrong });
    }
    this.emit({ type: 'tutorialResult', step: this.tutorialStep, result, action });
    this.setPhase('tutorialGap', 650);
  }

  // --- stage 2..4: attack loops ---------------------------------------------------

  private beginContact(): void {
    this.stageAttackCount = 0;
    this.scriptIndex = 0;
    this.setPhase('stageIntro', this.config.contact.introMs);
    this.enterStage('contact', 'contact');
    this.emit({ type: 'cinematic', id: 'enemyIntro', durationMs: this.config.contact.introMs });
    this.emit({ type: 'echo', line: 'contact' });
  }

  private beginPattern(): void {
    this.stageAttackCount = 0;
    this.aura = 0;
    // Phase first, so listeners reacting to the 'stage' event can already take a checkpoint.
    this.setPhase('stageIntro', this.config.pattern.introMs);
    this.enterStage('pattern', 'pattern');
    this.emit({ type: 'cinematic', id: 'patternIntro', durationMs: this.config.pattern.introMs });
    this.emit({ type: 'echo', line: 'patternIntro' });
    this.emitMeters();
  }

  private beginOverdrive(): void {
    this.stageAttackCount = 0;
    this.aura = 0;
    this.setPhase('stageIntro', this.config.overdrive.introMs);
    this.enterStage('ascension', 'overdrive');
    this.emit({ type: 'cinematic', id: 'overdriveIntro', durationMs: this.config.overdrive.introMs });
    this.emit({ type: 'echo', line: 'overdrive' });
    this.emitMeters();
  }

  private loopTuning() {
    return this.loop === 'overdrive' ? this.config.overdrive : this.config.pattern;
  }

  private gapMs(): number {
    if (this.loop === 'contact') return this.config.contact.gapMs;
    return this.loopTuning().gapMs;
  }

  private beginAttack(): void {
    let next: ScriptedAttack;
    let demo = false;
    if (this.loop === 'contact') {
      next = this.config.contact.script[this.scriptIndex++];
      demo = !!next.demo;
    } else {
      const tuning = this.loopTuning();
      const type = tuning.loop[this.stageAttackCount % tuning.loop.length];
      next = { type, telegraphMs: tuning.telegraphMs };
    }
    const isNew = !this.seenTypes.has(next.type);
    let telegraphMs = next.telegraphMs * this.config.telegraphScale;
    if (isNew && this.loop === 'overdrive') {
      // A never-seen attack gets one slowed, hinted demonstration before it counts as "known".
      telegraphMs *= this.config.overdrive.newTypeSlowdown;
      demo = true;
    }
    telegraphMs = Math.max(this.config.minTelegraphMs, Math.round(telegraphMs));
    const adaptiveHint = this.hintsEnabled && (this.failStreak[next.type] ?? 0) >= 2;
    this.current = {
      type: next.type,
      telegraphMs,
      telegraphStart: 0,
      hinted: demo || adaptiveHint,
      predicted: null,
      staggerUntil: 0,
      response: null,
      record: null,
    };
    this.stageAttackCount++;
    const gap = this.gapMs();
    this.setPhase('gap', gap);
    this.emit({ type: 'gap', durationMs: gap, predictable: this.loop !== 'contact' });
  }

  private handleGapInput(action: Action): void {
    const cur = this.current;
    if (!cur) return;
    if (this.loop === 'contact' || cur.predicted) {
      this.emit({ type: 'inputIgnored', action });
      return;
    }
    cur.predicted = action;
    this.emit({ type: 'predictCommit', action });
  }

  private beginTelegraph(): void {
    const cur = this.current;
    if (!cur) return;
    cur.telegraphStart = this.now;
    const isNew = !this.seenTypes.has(cur.type);
    this.seenTypes.add(cur.type);
    this.setPhase('telegraph', cur.telegraphMs);
    this.emit({
      type: 'telegraph',
      attack: cur.type,
      durationMs: cur.telegraphMs,
      index: this.attackIndex,
      hint: cur.hinted ? hintActions(cur.type) : null,
      isNew,
    });
    if (newTypeEcho(isNew, this.loop)) this.emit({ type: 'echo', line: 'newAttack' });

    if (cur.predicted) {
      if (isCorrect(cur.type, cur.predicted)) {
        this.resolve('read', null);
      } else {
        cur.staggerUntil = this.now + this.config.staggerMs;
        this.emit({ type: 'stagger', durationMs: this.config.staggerMs, predicted: cur.predicted });
      }
    }
  }

  private handleTelegraphInput(action: Action, at: number): void {
    const cur = this.current;
    if (!cur || cur.record || cur.response) return;
    if (at < cur.staggerUntil) {
      this.emit({ type: 'inputIgnored', action });
      return;
    }
    cur.response = action;
    const correct = isCorrect(cur.type, action);
    this.emit({ type: 'reaction', action, correct });
    if (correct) {
      this.resolve(cur.predicted ? 'recovered' : 'react', Math.round(at - cur.telegraphStart));
    } else {
      this.resolve(cur.predicted ? 'misread' : 'wrong', null);
    }
  }

  private resolve(outcome: Outcome, reactionMs: number | null): void {
    const cur = this.current;
    if (!cur || cur.record) return;
    const record: AttackRecord = {
      i: this.attackIndex++,
      stage: this.stage,
      type: cur.type,
      telegraphMs: cur.telegraphMs,
      predicted: cur.predicted,
      predictedCorrect: cur.predicted ? isCorrect(cur.type, cur.predicted) : null,
      response: cur.response,
      reactionMs,
      outcome,
      hinted: cur.hinted,
      t: Math.round(this.now),
    };
    cur.record = record;
    this.attacks.push(record);

    if (isSuccess(outcome)) {
      this.failStreak[cur.type] = 0;
      if (this.loop === 'pattern' || this.loop === 'overdrive') {
        const tuning = this.loopTuning();
        const gain = outcome === 'read' ? tuning.auraRead : outcome === 'react' ? tuning.auraReact : tuning.auraRecovered;
        this.aura = Math.min(AURA_FULL, this.aura + gain);
      }
      if (outcome === 'read') {
        this.barrier = Math.max(0, this.barrier - this.config.barrier.readChip);
        if (!this.firstReadAnnounced) {
          this.firstReadAnnounced = true;
          this.emit({ type: 'echo', line: 'firstRead' });
        }
      }
    } else {
      this.failStreak[cur.type] = (this.failStreak[cur.type] ?? 0) + 1;
    }
    this.emit({ type: 'resolve', record });
    this.emitMeters();

    // Ascension Moment: a successful defence while the aura is full freezes time.
    if (isSuccess(outcome) && this.aura >= AURA_FULL && (this.loop === 'pattern' || this.loop === 'overdrive')) {
      this.beginAscendTrigger(outcome === 'read' ? 'read' : 'react');
    }
  }

  private strike(): void {
    const cur = this.current;
    if (!cur) return;
    if (!cur.record) this.resolve(cur.predicted ? 'misread' : 'miss', null);
    // resolve() may have started an ascension (cannot for failures, but stay defensive)
    if (this.phase !== 'telegraph') return;
    const outcome = cur.record!.outcome;
    const hit = !isSuccess(outcome);
    const damage = hit ? this.config.integrity.hitDamage : 0;
    if (hit) this.integrity = Math.max(0, this.integrity - damage);
    const dodged = !hit ? (cur.response ?? cur.predicted) : null;
    this.emit({ type: 'strike', attack: cur.type, outcome, damage, dodged });
    this.emitMeters();
    if (this.integrity <= 0) {
      this.reboots++;
      this.setPhase('reboot', this.config.integrity.rebootMs);
      this.emit({ type: 'reboot', durationMs: this.config.integrity.rebootMs });
      this.emit({ type: 'echo', line: 'reboot' });
    } else {
      this.setPhase('recover', this.config.recoverMs);
    }
  }

  private afterAttack(): void {
    this.current = null;
    if (this.loop === 'contact') {
      if (this.scriptIndex >= this.config.contact.script.length) this.beginPattern();
      else this.beginAttack();
      return;
    }
    const tuning = this.loopTuning();
    if (this.stageAttackCount >= tuning.assistAfter) {
      // ECHO steps in: the mission must stay completable without perfect play.
      this.assists++;
      this.aura = AURA_FULL;
      this.emitMeters();
      this.setPhase('assist', this.config.timing.assistMs);
      this.emit({ type: 'echo', line: 'assist' });
      return;
    }
    this.beginAttack();
  }

  // --- ascension -------------------------------------------------------------------

  private beginAscendTrigger(trigger: AscensionRecord['trigger']): void {
    const tuning = this.config.ascension[Math.min(this.ascensionIndex, 1)];
    const sequence = pickDistinct(this.rng, WEAK_POINT_NODES.length, tuning.points);
    this.ascension = { index: this.ascensionIndex, trigger, sequence, taps: [] };
    if (this.stage !== 'ascension') this.enterStage('ascension', this.loop);
    this.setPhase('ascendTrigger', this.config.timing.ascendTriggerMs);
    this.emit({ type: 'ascendTrigger', index: this.ascensionIndex, trigger, durationMs: this.config.timing.ascendTriggerMs });
    this.emit({ type: 'echo', line: 'ascend' });
  }

  private beginAscendShow(): void {
    const tuning = this.config.ascension[Math.min(this.ascensionIndex, 1)];
    const lead = 350;
    const step = tuning.showOnMs + tuning.showOffMs;
    this.showOrder = 0;
    this.setPhase('ascendShow', lead + step * tuning.points + 250);
    this.nextShowAt = this.now + lead;
  }

  private showNextNode(): void {
    const asc = this.ascension;
    if (!asc) return;
    const tuning = this.config.ascension[Math.min(this.ascensionIndex, 1)];
    if (this.showOrder < asc.sequence.length) {
      this.emit({ type: 'ascendNode', node: asc.sequence[this.showOrder], order: this.showOrder, onMs: tuning.showOnMs });
      this.showOrder++;
      this.nextShowAt = this.now + tuning.showOnMs + tuning.showOffMs;
    } else {
      this.nextShowAt = Number.POSITIVE_INFINITY;
    }
  }

  private beginAscendRecall(): void {
    const asc = this.ascension;
    if (!asc) return;
    const tuning = this.config.ascension[Math.min(this.ascensionIndex, 1)];
    this.recallStart = this.now;
    this.setPhase('ascendRecall', tuning.recallMs);
    this.emit({ type: 'ascendRecall', durationMs: tuning.recallMs, points: asc.sequence.length, candidates: WEAK_POINT_NODES.length });
  }

  private timeoutRecall(): void {
    const asc = this.ascension;
    if (!asc) return;
    while (asc.taps.length < asc.sequence.length) {
      const order = asc.taps.length;
      const tap: AscensionTap = { node: null, expected: asc.sequence[order], correct: false, ms: Math.round(this.now - this.recallStart) };
      asc.taps.push(tap);
      this.emit({ type: 'ascendTap', tap, order });
    }
    this.beginAscendStrike();
  }

  private beginAscendStrike(): void {
    const asc = this.ascension;
    if (!asc || this.phase === 'ascendStrike') return;
    this.ascensions.push(asc);
    const hits = asc.taps.filter((t) => t.correct).length;
    const final = this.ascensionIndex >= 1;
    const before = this.barrier;
    if (final) {
      this.barrier = 0;
    } else {
      const dmg = this.config.barrier.ascensionBase + this.config.barrier.ascensionPerHit * hits;
      this.barrier = Math.max(this.config.barrier.floorAfterFirst, this.barrier - dmg);
    }
    this.aura = 0;
    this.setPhase('ascendStrike', this.config.timing.ascendStrikeMs);
    this.emit({
      type: 'ascendStrike',
      index: this.ascensionIndex,
      hits,
      total: asc.sequence.length,
      damage: before - this.barrier,
      final,
      durationMs: this.config.timing.ascendStrikeMs,
    });
    this.emitMeters();
  }

  private afterAscendStrike(): void {
    const wasFinal = this.ascensionIndex >= 1;
    this.ascensionIndex++;
    this.ascension = null;
    if (wasFinal) {
      this.setPhase('finisher', this.config.timing.finisherMs);
      this.emit({ type: 'finisher', durationMs: this.config.timing.finisherMs });
      this.emit({ type: 'echo', line: 'finisher' });
    } else {
      this.beginOverdrive();
    }
  }

  private complete(): void {
    this.enterStage('evolution', null);
    this.phase = 'complete';
    this.result = summarizeMission({
      mode: this.config.mode,
      seed: this.config.seed,
      durationMs: Math.round(this.now),
      attacks: this.attacks,
      ascensions: this.ascensions,
      tutorial: this.tutorial,
      reboots: this.reboots,
      assists: this.assists,
    });
    this.emit({ type: 'complete', result: this.result });
  }

  // --- checkpoint ------------------------------------------------------------------

  private restore(cp: Checkpoint): void {
    this.now = cp.now;
    this.aura = cp.aura;
    this.integrity = cp.integrity;
    this.barrier = cp.barrier;
    this.attackIndex = cp.attackIndex;
    this.reboots = cp.reboots;
    this.assists = cp.assists;
    this.attacks.push(...cp.attacks);
    this.ascensions.push(...cp.ascensions);
    this.tutorial.push(...cp.tutorial);
    for (const a of cp.attacks) this.seenTypes.add(a.type);
    this.firstReadAnnounced = cp.attacks.some((a) => a.outcome === 'read');
    // Re-consume the rng so weak-point sequences after resume match an uninterrupted run.
    this.ascensionIndex = cp.ascensions.length;
    for (const asc of cp.ascensions) {
      const tuning = this.config.ascension[Math.min(asc.index, 1)];
      pickDistinct(this.rng, WEAK_POINT_NODES.length, tuning.points);
    }
    if (cp.resumeAt === 'pattern') this.beginPattern();
    else this.beginOverdrive();
  }
}

function newTypeEcho(isNew: boolean, loop: LoopKey | null): boolean {
  return isNew && loop === 'overdrive';
}
