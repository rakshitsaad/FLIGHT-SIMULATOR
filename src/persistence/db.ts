/**
 * IndexedDB persistence: recorded flights and the hand calibration.
 * Everything stays in the player's browser.
 */
import type { FlightRecord } from '../types';

const DB_NAME = 'skybound';
const DB_VERSION = 1;
const FLIGHTS = 'flights';
const KV = 'kv';
const MAX_UNSAVED = 12;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FLIGHTS)) db.createObjectStore(FLIGHTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export type FlightSummary = Omit<FlightRecord, 'frames'> & { frameCount: number };

export async function saveFlight(rec: FlightRecord): Promise<void> {
  await tx(FLIGHTS, 'readwrite', (s) => s.put(rec));
  await prune();
}

export async function listFlights(): Promise<FlightSummary[]> {
  const all = await tx<FlightRecord[]>(FLIGHTS, 'readonly', (s) => s.getAll());
  return all
    .map(({ frames, ...rest }) => ({ ...rest, frameCount: frames.length }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getFlight(id: string): Promise<FlightRecord | undefined> {
  return tx<FlightRecord | undefined>(FLIGHTS, 'readonly', (s) => s.get(id));
}

export async function deleteFlight(id: string): Promise<void> {
  await tx(FLIGHTS, 'readwrite', (s) => s.delete(id));
}

export async function setFlightSaved(id: string, saved: boolean): Promise<void> {
  const rec = await getFlight(id);
  if (!rec) return;
  rec.saved = saved;
  await tx(FLIGHTS, 'readwrite', (s) => s.put(rec));
}

/** Keep every starred flight, but only the most recent unstarred ones. */
async function prune(): Promise<void> {
  const list = await listFlights();
  const unsaved = list.filter((f) => !f.saved);
  for (const f of unsaved.slice(MAX_UNSAVED)) await deleteFlight(f.id);
}

export function kvSet(key: string, value: unknown): Promise<unknown> {
  return tx(KV, 'readwrite', (s) => s.put(value, key));
}

export function kvGet<T>(key: string): Promise<T | undefined> {
  return tx<T | undefined>(KV, 'readonly', (s) => s.get(key));
}

export function kvDelete(key: string): Promise<unknown> {
  return tx(KV, 'readwrite', (s) => s.delete(key));
}
