import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HyperCube } from './types';
import type { HighlightStore, SavedHighlights } from './lib/highlights';
import type { SamPrompt } from './lib/samModels';

// A stand-in for SAM: the mask is a 3×3 square around the last include click, minus any leave-out clicks.
const W = 16;
const H = 16;
let predictCalls: SamPrompt[] = [];
let failNext = false;
vi.mock('./lib/sam2', () => ({
  getSam2Rgb: () => ({}),
  resetSam2Image: () => {},
  encodeSam2Image: async () => 'wasm',
  predictSam2: async (prompt: SamPrompt) => {
    predictCalls.push(prompt);
    if (failNext) {
      failNext = false;
      throw new Error('model broke');
    }
    const mask = new Uint8Array(W * H);
    const includes = prompt.points.filter((p) => p.label === 1);
    const c = includes.at(-1) ?? { x: prompt.box![0] + 1, y: prompt.box![1] + 1 };
    for (let y = c.y - 1; y <= c.y + 1; y++) for (let x = c.x - 1; x <= c.x + 1; x++) if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = 1;
    for (const p of prompt.points) if (p.label === 0) mask[p.y * W + p.x] = 0;
    return mask;
  },
}));

function memory(): HighlightStore & { data: Map<string, SavedHighlights> } {
  const data = new Map<string, SavedHighlights>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

const makeCube = (seed = 0): HyperCube => ({
  name: 'test',
  width: W,
  height: H,
  bands: 3,
  data: Float32Array.from({ length: W * H * 3 }, (_, i) => i + seed),
});

const { useStore, setHighlightStore } = await import('./store');
const s = () => useStore.getState();
const count = (id: number) => s().labels!.reduce((n, v) => n + (v === id ? 1 : 0), 0);
let store: ReturnType<typeof memory>;

beforeEach(async () => {
  predictCalls = [];
  failNext = false;
  await s().flushSave(); // finish the last test's pending write before swapping stores
  store = memory();
  setHighlightStore(store);
  vi.stubGlobal('localStorage', { getItem: () => '1', setItem: () => {} });
  s().setCube(makeCube());
  await vi.waitFor(() => expect(s().labels).not.toBeNull());
});

describe('one click, one object', () => {
  it('creates a separate object per click, even for touching leaves', async () => {
    await s().highlightAt(3, 3);
    await s().highlightAt(6, 3); // its square touches the first one
    expect(s().regions.map((r) => r.id)).toEqual([1, 2]);
    expect(count(1)).toBe(9);
    expect(count(2)).toBe(9);
    expect(predictCalls.at(-1)!.points).toEqual([{ x: 6, y: 3, label: 1 }]);
    expect(s().activeRegion).toBe(2);
  });

  it('selects, rather than re-outlines, an object that is clicked again', async () => {
    await s().highlightAt(3, 3);
    await s().highlightAt(8, 8);
    predictCalls = [];
    await s().highlightAt(3, 3);
    expect(s().activeRegion).toBe(1);
    expect(s().regions).toHaveLength(2);
    expect(predictCalls).toHaveLength(0);
  });

  it('does not leave an empty object when the area is already taken', async () => {
    await s().highlightAt(3, 3);
    await s().highlightBox([2, 2, 4, 4]); // the stand-in mask lands exactly on object 1
    expect(s().regions.map((r) => r.id)).toEqual([1]);
    expect(s().notice).toMatch(/already highlighted/);
  });

  it('handles rapid clicks in order without losing a leaf', async () => {
    await Promise.all([s().highlightAt(3, 3), s().highlightAt(10, 3), s().highlightAt(3, 10)]);
    expect(s().regions.map((r) => r.id)).toEqual([1, 2, 3]);
    expect([count(1), count(2), count(3)]).toEqual([9, 9, 9]);
    expect(s().samBusy).toBe(0);
  });
});

describe('refining', () => {
  it('adds and leaves out on the selected object only', async () => {
    await s().highlightAt(3, 3);
    await s().highlightAt(10, 10);
    s().set({ activeRegion: 1 });
    await s().highlightAt(4, 4, 'exclude');
    expect(predictCalls.at(-1)!.points).toEqual([{ x: 3, y: 3, label: 1 }, { x: 4, y: 4, label: 0 }]);
    expect(count(1)).toBe(8);
    expect(count(2)).toBe(9);
  });

  it('ignores a leave-out click with nothing selected', async () => {
    await s().highlightAt(5, 5, 'exclude');
    expect(s().regions).toHaveLength(0);
    expect(predictCalls).toHaveLength(0);
    expect(s().notice).toMatch(/Select a highlight/);
  });

  it('asks before discarding brush work, and keeps it if refused', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('window', { confirm });
    try {
      await s().highlightAt(3, 3);
      s().set({ brushMode: 'add', brushSize: 2 });
      expect(s().beginStroke()).toBe(true);
      s().paintStroke(12.5, 12.5, 12.5, 12.5);
      s().endStroke();
      const painted = count(1);
      expect(painted).toBeGreaterThan(9);
      expect(s().regions[0].edited).toBe(true);

      await s().highlightAt(4, 4, 'exclude');
      expect(confirm).toHaveBeenCalledOnce();
      expect(count(1)).toBe(painted);

      confirm.mockReturnValue(true);
      await s().highlightAt(4, 4, 'exclude');
      expect(count(1)).toBe(8);
      expect(s().regions[0].edited).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('removing the last click removes the object; ids are never reused', async () => {
    await s().highlightAt(3, 3);
    await s().removeLastPoint();
    expect(s().regions).toHaveLength(0);
    await s().highlightAt(8, 8);
    expect(s().regions[0].id).toBe(2);
    expect(predictCalls.at(-1)!.points).toEqual([{ x: 8, y: 8, label: 1 }]);
  });

  it('puts the clicks back if the model fails', async () => {
    await s().highlightAt(3, 3);
    failNext = true;
    await s().highlightAt(4, 4, 'exclude');
    expect(s().error).toMatch(/model broke/);
    expect(s().regions[0].points).toHaveLength(1);
    expect(count(1)).toBe(9);
    failNext = true;
    await s().highlightAt(10, 10);
    expect(s().regions).toHaveLength(1);
  });
});

describe('editing', () => {
  it('shrinks, deletes one object, and undoes and redoes all of it', async () => {
    await s().highlightAt(3, 3);
    await s().highlightAt(10, 10);
    s().shrinkRegion(1);
    expect(count(1)).toBe(1);
    s().deleteRegion(2);
    expect(count(2)).toBe(0);
    expect(s().regions.map((r) => r.id)).toEqual([1]);

    s().undo();
    expect(count(2)).toBe(9);
    s().undo();
    expect(count(1)).toBe(9);
    s().redo();
    s().redo();
    expect(count(1)).toBe(1);
    expect(count(2)).toBe(0);
  });

  it('a stroke that paints nothing leaves no object and no undo step', () => {
    s().set({ brushMode: 'add', brushSize: 4 });
    expect(s().beginStroke()).toBe(true);
    s().endStroke();
    expect(s().regions).toHaveLength(0);
    expect(s().canUndo).toBe(false);
    expect(s().nextId).toBe(1);
  });

  it('erasing with nothing selected does nothing', () => {
    s().set({ brushMode: 'erase' });
    expect(s().beginStroke()).toBe(false);
    expect(s().regions).toHaveLength(0);
  });

  it('builds a set of pixels by toggling them', () => {
    s().togglePixel(1, 1);
    s().togglePixel(2, 2);
    expect(s().regions).toHaveLength(1);
    expect(s().regions[0].name).toMatch(/^Pixels/);
    expect(count(1)).toBe(2);
    s().togglePixel(1, 1);
    s().togglePixel(2, 2);
    expect(s().regions).toHaveLength(0);
  });

  it('undo drops a highlight still queued behind it', async () => {
    await s().highlightAt(3, 3);
    const queued = s().highlightAt(10, 10);
    s().undo();
    await queued;
    expect(s().regions).toHaveLength(0);
    expect(s().samBusy).toBe(0);
  });
});

describe('saving', () => {
  it('restores the same pixels, names and clicks when the image is reopened', async () => {
    await s().highlightAt(3, 3);
    s().renameRegion(1, 'Sick leaf');
    await s().flushSave();
    const saved = Array.from(s().labels!);

    s().setCube(makeCube(1000));
    await vi.waitFor(() => expect(s().regions).toHaveLength(0));
    s().setCube(makeCube());
    await vi.waitFor(() => expect(s().regions).toHaveLength(1));
    expect(Array.from(s().labels!)).toEqual(saved);
    expect(s().regions[0]).toMatchObject({ name: 'Sick leaf', points: [{ x: 3, y: 3, label: 1 }] });

    // Refining a restored object builds on its saved click.
    await s().highlightAt(4, 4, 'exclude');
    expect(predictCalls.at(-1)!.points).toHaveLength(2);
  });

  it('does not show one image\'s highlights on a different image with the same name', async () => {
    await s().highlightAt(3, 3);
    await s().flushSave();
    s().setCube({ ...makeCube(5000), name: 'test' });
    await new Promise((r) => setTimeout(r, 20));
    expect(s().regions).toHaveLength(0);
  });

  it('forgets an image whose highlights are all removed, and undo brings them back', async () => {
    await s().highlightAt(3, 3);
    await s().flushSave();
    expect(store.data.size).toBe(1);
    s().clearHighlights();
    await s().flushSave();
    expect(store.data.size).toBe(0);
    s().undo();
    await s().flushSave();
    expect(store.data.size).toBe(1);
    expect(count(1)).toBe(9);
  });

  it('reports a failed save instead of losing it silently', async () => {
    await s().highlightAt(3, 3);
    store.set = async () => {
      throw new Error('quota exceeded');
    };
    await s().flushSave();
    expect(s().error).toMatch(/could not be saved.*quota exceeded/);
  });

  describe('imported masks', () => {
    const maskOf = (pixels: number[]) => {
      const mask = new Uint8Array(s().labels!.length);
      for (const p of pixels) mask[p] = 1;
      return { mask, pixels: pixels.length, meta: null };
    };

    it('become new highlights in one undo step', () => {
      const r = s().addMasks([{ ...maskOf([0, 1, 2]), name: 'leaf_A' }, { ...maskOf([10, 11]), name: 'leaf_B' }]);
      expect(r).toEqual({ added: 2, updated: 0, skipped: [] });
      expect(s().regions.map((x) => x.name)).toEqual(['leaf_A', 'leaf_B']);
      expect(count(1)).toBe(3);
      expect(s().regions[0].edited).toBe(true);
      s().undo();
      expect(s().regions).toEqual([]);
      expect(count(1)).toBe(0);
    });

    it('replace a highlight of the same name, so importing twice changes nothing', () => {
      s().addMasks([{ ...maskOf([0, 1, 2]), name: 'leaf_A' }]);
      const r = s().addMasks([{ ...maskOf([5, 6]), name: 'leaf_A' }]);
      expect(r).toEqual({ added: 0, updated: 1, skipped: [] });
      expect(s().regions).toHaveLength(1);
      expect(s().labels![0]).toBe(0);
      expect(s().labels![5]).toBe(1);
    });

    it('never take pixels from another highlight, and report what was left out', () => {
      s().addMasks([{ ...maskOf([0, 1]), name: 'first' }]);
      const r = s().addMasks([{ ...maskOf([1, 2, 3]), name: 'second' }]);
      expect(r.skipped).toEqual([{ name: 'second', pixels: 1 }]);
      expect(count(1)).toBe(2);
      expect(count(2)).toBe(2);
    });

    it('are not created at all when every pixel is taken', () => {
      s().addMasks([{ ...maskOf([0, 1]), name: 'first' }]);
      const r = s().addMasks([{ ...maskOf([0, 1]), name: 'copy' }]);
      expect(r).toEqual({ added: 0, updated: 0, skipped: [{ name: 'copy', pixels: 2 }] });
      expect(s().regions).toHaveLength(1);
      s().undo();
      expect(s().regions).toHaveLength(0);
    });
  });

  describe('editor', () => {
    const paint = (x: number, y: number) => {
      s().beginStroke();
      s().paintStroke(x, y, x, y);
      s().endStroke();
    };

    it('frames the highlight once and goes back to the previous tool', async () => {
      await s().highlightAt(3, 3);
      s().set({ tool: 'select' });
      s().openEditor(s().activeRegion);
      expect(s().tool).toBe('brush');
      expect(s().editor?.rect).toMatchObject({ x0: 0, y0: 0 });
      const rect = s().editor!.rect;
      s().set({ brushSize: 1 });
      paint(12, 12);
      expect(s().editor!.rect).toBe(rect);
      s().closeEditor();
      expect(s().tool).toBe('select');
      expect(s().editor).toBeNull();
    });

    it('undoes only what was done since it opened; afterwards everything can be undone', async () => {
      await s().highlightAt(3, 3);
      await s().highlightAt(12, 12);
      const id = s().regions[0].id;
      s().openEditor(id);
      expect(s().canUndo).toBe(false);
      s().undo();
      expect(s().regions).toHaveLength(2);

      const before = count(id);
      s().set({ brushSize: 3, brushMode: 'add' });
      paint(10, 10);
      expect(count(id)).toBeGreaterThan(before);
      expect(s().canUndo).toBe(true);
      s().undo();
      expect(count(id)).toBe(before);
      expect(s().canUndo).toBe(false);
      s().undo();
      expect(s().regions).toHaveLength(2);
      s().redo();
      expect(count(id)).toBeGreaterThan(before);

      s().closeEditor();
      expect(s().canUndo).toBe(true);
    });

    it('closes when its highlight is erased completely, and undo restores it', async () => {
      await s().highlightAt(3, 3);
      const id = s().activeRegion;
      const before = count(id);
      s().openEditor(id);
      s().set({ brushSize: 60, brushMode: 'erase' });
      paint(3, 3);
      expect(s().editor).toBeNull();
      expect(s().notice).toMatch(/erased completely/);
      s().undo();
      expect(count(id)).toBe(before);
    });

    it('resets to the automatic outline', async () => {
      await s().highlightAt(3, 3);
      const id = s().activeRegion;
      const before = count(id);
      s().openEditor(id);
      s().set({ brushSize: 3, brushMode: 'add' });
      paint(12, 12);
      expect(s().regions[0].edited).toBe(true);
      await s().resetOutline(id);
      expect(count(id)).toBe(before);
      expect(s().regions[0].edited).toBe(false);
    });

    it('does not paint while an outline is still being computed', async () => {
      await s().highlightAt(3, 3);
      s().set({ samBusy: 1 });
      expect(s().beginStroke()).toBe(false);
      s().set({ samBusy: 0 });
    });
  });
});
