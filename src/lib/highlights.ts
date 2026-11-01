import { decodeRle, encodeRle } from './mask';

export interface RegionPrompt {
  x: number;
  y: number;
  label: 0 | 1;
}

export type Box = [number, number, number, number];

/** A highlighted area. Its pixels live in the shared label image under `id`. */
export interface Region {
  id: number;
  name: string;
  points: RegionPrompt[];
  box: Box | null;
  /** The mask has hand edits that re-running SAM would discard. */
  edited: boolean;
}

export interface Highlights {
  regions: Region[];
  labels: Uint16Array;
  nextId: number;
  activeRegion: number;
}

/** What is stored: portable JSON, the same in the browser's database and in a sidecar file. */
export interface SavedHighlights {
  format: 'hsiv-highlights';
  version: 1;
  fingerprint: string;
  cubeName: string;
  width: number;
  height: number;
  bands: number;
  regions: Region[];
  nextId: number;
  activeRegion: number;
  rle: number[];
}

/** The browser database behind a small interface, so tests can run without one. */
export interface HighlightStore {
  get(key: string): Promise<SavedHighlights | undefined>;
  set(key: string, value: SavedHighlights): Promise<void>;
  delete(key: string): Promise<void>;
}

const DB_NAME = 'hsiv';
const DB_STORE = 'highlights';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(DB_STORE, mode);
        const req = run(t.objectStore(DB_STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onabort = t.onerror = () => {
          db.close();
          reject(t.error ?? req.error);
        };
      }),
  );
}

export const browserStore: HighlightStore = {
  get: (key) => tx('readonly', (s) => s.get(key)),
  set: (key, value) => tx('readwrite', (s) => s.put(value, key)).then(() => undefined),
  delete: (key) => tx('readwrite', (s) => s.delete(key)).then(() => undefined),
};

export function serializeHighlights(
  cube: { name: string; width: number; height: number; bands: number },
  fingerprint: string,
  h: Highlights,
): SavedHighlights {
  return {
    format: 'hsiv-highlights',
    version: 1,
    fingerprint,
    cubeName: cube.name,
    width: cube.width,
    height: cube.height,
    bands: cube.bands,
    regions: h.regions,
    nextId: h.nextId,
    activeRegion: h.activeRegion,
    rle: encodeRle(h.labels),
  };
}

/** Rebuild highlights, rejecting anything malformed or the wrong size for this image. */
export function deserializeHighlights(saved: unknown, width: number, height: number): Highlights {
  const s = saved as Partial<SavedHighlights> | null;
  if (!s || s.format !== 'hsiv-highlights' || s.version !== 1 || !Array.isArray(s.regions) || !Array.isArray(s.rle)) {
    throw new Error('This is not a highlights file from this app.');
  }
  if (s.width !== width || s.height !== height) {
    throw new Error(`These highlights are for a ${s.width} × ${s.height} image, but this image is ${width} × ${height}.`);
  }
  const labels = decodeRle(s.rle, width * height);
  const ids = new Set(s.regions.map((r) => r.id));
  for (const id of labels) if (id && !ids.has(id)) throw new Error('This highlights file is damaged.');
  const maxId = s.regions.reduce((m, r) => Math.max(m, r.id), 0);
  return {
    regions: s.regions,
    labels,
    nextId: Math.max(s.nextId ?? 0, maxId + 1),
    activeRegion: ids.has(s.activeRegion ?? 0) ? s.activeRegion! : 0,
  };
}

export async function loadHighlights(store: HighlightStore, fingerprint: string, width: number, height: number): Promise<Highlights | null> {
  const saved = await store.get(fingerprint);
  return saved ? deserializeHighlights(saved, width, height) : null;
}
