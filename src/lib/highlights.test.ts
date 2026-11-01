import { describe, expect, it } from 'vitest';
import { deserializeHighlights, loadHighlights, serializeHighlights, type HighlightStore, type Region, type SavedHighlights } from './highlights';

function memoryStore(): HighlightStore & { data: Map<string, SavedHighlights> } {
  const data = new Map<string, SavedHighlights>();
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
}

const cube = { name: 'Demo', width: 4, height: 2, bands: 3 };
const regions: Region[] = [{ id: 2, name: 'Leaf', points: [{ x: 1, y: 0, label: 1 }], box: null, edited: true }];
const labels = Uint16Array.from([0, 2, 2, 0, 0, 0, 0, 0]);
const highlights = { regions, labels, nextId: 3, activeRegion: 2 };

describe('highlight persistence', () => {
  it('round-trips regions, clicks and pixels', async () => {
    const store = memoryStore();
    await store.set('fp', serializeHighlights(cube, 'fp', highlights));
    const loaded = (await loadHighlights(store, 'fp', 4, 2))!;
    expect(Array.from(loaded.labels)).toEqual(Array.from(labels));
    expect(loaded.regions).toEqual(regions);
    expect(loaded.nextId).toBe(3);
    expect(loaded.activeRegion).toBe(2);
    expect(await loadHighlights(store, 'other', 4, 2)).toBeNull();
  });

  it('survives being written to a file and read back', () => {
    const file = JSON.stringify(serializeHighlights(cube, 'fp', highlights));
    expect(Array.from(deserializeHighlights(JSON.parse(file), 4, 2).labels)).toEqual(Array.from(labels));
  });

  it('rejects other files, the wrong size, and damaged contents', () => {
    const good = serializeHighlights(cube, 'fp', highlights);
    expect(() => deserializeHighlights({ hello: 1 }, 4, 2)).toThrow(/not a highlights file/);
    expect(() => deserializeHighlights(null, 4, 2)).toThrow(/not a highlights file/);
    expect(() => deserializeHighlights(good, 8, 2)).toThrow(/4 × 2/);
    expect(() => deserializeHighlights({ ...good, rle: [0, 3] }, 4, 2)).toThrow(/length mismatch/);
    expect(() => deserializeHighlights({ ...good, regions: [] }, 4, 2)).toThrow(/damaged/);
  });

  it('never reuses an id, even if nextId is missing', () => {
    const { nextId: _unused, ...old } = serializeHighlights(cube, 'fp', highlights);
    expect(deserializeHighlights(old, 4, 2).nextId).toBe(3);
  });
});
