import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Checkpoint } from '@/game/core/director';
import type { ModeId } from '@/game/core/types';
import type { RunSummary } from './adaptation';

/**
 * Local-only persistence (IndexedDB). Nothing here is sent to a server
 * unless the player explicitly triggers an AI request, and then only a
 * compact numeric summary is sent.
 */

export interface ChoiceEvent {
  id?: number;
  at: number;
  kind: 'modeSelected' | 'missionStarted' | 'missionAbandoned' | 'replay';
  mode: ModeId;
}

interface UnknownDB extends DBSchema {
  runs: { key: string; value: RunSummary; indexes: { byFinished: number } };
  choices: { key: number; value: ChoiceEvent };
  kv: { key: string; value: unknown };
}

const DB_NAME = 'unknown-ascension';
const DB_VERSION = 1;
const MAX_RUNS = 500;

let dbPromise: Promise<IDBPDatabase<UnknownDB>> | null = null;

function db(): Promise<IDBPDatabase<UnknownDB>> {
  if (!dbPromise) {
    dbPromise = openDB<UnknownDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const runs = database.createObjectStore('runs', { keyPath: 'id' });
        runs.createIndex('byFinished', 'finishedAt');
        database.createObjectStore('choices', { keyPath: 'id', autoIncrement: true });
        database.createObjectStore('kv');
      },
    });
  }
  return dbPromise;
}

export async function saveRun(run: RunSummary): Promise<void> {
  const d = await db();
  await d.put('runs', run);
  // Keep storage bounded: drop the oldest runs beyond MAX_RUNS.
  const keys = await d.getAllKeysFromIndex('runs', 'byFinished');
  if (keys.length > MAX_RUNS) {
    const tx = d.transaction('runs', 'readwrite');
    for (const k of keys.slice(0, keys.length - MAX_RUNS)) await tx.store.delete(k);
    await tx.done;
  }
}

export async function loadRuns(): Promise<RunSummary[]> {
  const d = await db();
  return d.getAllFromIndex('runs', 'byFinished');
}

export async function logChoice(event: Omit<ChoiceEvent, 'id'>): Promise<void> {
  const d = await db();
  await d.add('choices', event as ChoiceEvent);
}

export async function loadChoices(): Promise<ChoiceEvent[]> {
  const d = await db();
  return d.getAll('choices');
}

const CHECKPOINT_KEY = 'checkpoint:awakening';

export async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  const d = await db();
  await d.put('kv', cp, CHECKPOINT_KEY);
}

export async function loadCheckpoint(): Promise<Checkpoint | null> {
  const d = await db();
  const cp = (await d.get('kv', CHECKPOINT_KEY)) as Checkpoint | undefined;
  if (!cp || cp.version !== 1) return null;
  // Stale checkpoints (older than 7 days) are discarded quietly.
  if (Date.now() - cp.savedAt > 7 * 24 * 3600 * 1000) return null;
  return cp;
}

export async function clearCheckpoint(): Promise<void> {
  const d = await db();
  await d.delete('kv', CHECKPOINT_KEY);
}

/** Deletes every locally stored record (runs, choices, checkpoints). */
export async function wipeAllData(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['runs', 'choices', 'kv'], 'readwrite');
  await Promise.all([tx.objectStore('runs').clear(), tx.objectStore('choices').clear(), tx.objectStore('kv').clear()]);
  await tx.done;
}

/** Test helper: forget the cached connection (used with fake-indexeddb). */
export function __resetDbForTests(): void {
  dbPromise = null;
}
