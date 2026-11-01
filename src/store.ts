import { create } from 'zustand';
import type { Candidate, HyperCube } from './types';
import { cubeFingerprint } from './lib/fingerprint';
import {
  browserStore,
  loadHighlights,
  serializeHighlights,
  type Box,
  type HighlightStore,
  type Region,
  type RegionPrompt,
} from './lib/highlights';
import { History } from './lib/history';
import { applyBinaryMask, clearLabel, countLabel, decodeRle, encodeRle, erodeLabel, labelBounds, stampLine, type BrushMode } from './lib/mask';
import type { DecodedMask } from './lib/maskFile';
import { encodeSam2Image, getSam2Rgb, predictSam2, resetSam2Image } from './lib/sam2';
import { DEFAULT_SAM_MODEL, SAM_MODELS, type SamBackend, type SamModelKey } from './lib/samModels';

export type Tool = 'pixel' | 'point' | 'box' | 'select' | 'brush';
export type ClickMode = 'new' | 'add' | 'exclude';

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The zoomed editor: one highlight, framed once when it opens so painting never moves the view. */
export interface EditorState {
  id: number;
  rect: { x0: number; y0: number; w: number; h: number };
  /** The tool to go back to on closing. */
  previousTool: Tool;
}

/** A mask being imported. */
export interface IncomingMask extends DecodedMask {
  name: string;
}

export interface MaskImportResult {
  added: number;
  updated: number;
  /** Imported pixels left out because another highlight already holds them. */
  skipped: { name: string; pixels: number }[];
}

/** Space kept around the highlight when the editor opens, in image pixels. */
const EDITOR_MARGIN = 48;

interface Snapshot {
  rle: number[];
  regions: Region[];
  nextId: number;
  activeRegion: number;
}

interface State {
  cube: HyperCube | null;
  /** Increments on every new cube; used to reset per-cube UI state. */
  cubeId: number;
  /** Identifies the image by its contents; saved highlights are stored under it. */
  fingerprint: string;
  sourceName: string;
  candidates: Candidate[];
  pickerOpen: boolean;
  loading: string | null;
  error: string | null;
  /** A short hint that replaces the tool help for a few seconds. */
  notice: string | null;

  /** The clicked pixel whose spectrum is plotted. */
  selected: { x: number; y: number } | null;
  /** The pixel under the mouse; its spectrum is plotted while no pixel is selected. */
  hovered: { x: number; y: number } | null;

  /** Per-pixel region ids (0 = none). The same buffer is mutated in place. */
  labels: Uint16Array | null;
  regions: Region[];
  nextId: number;
  /** The region that refinements and the brush apply to (0 = none). */
  activeRegion: number;
  /** Bumped on any label change; the overlay redraws. `maskDirty` limits it to a rectangle. */
  maskRev: number;
  maskDirty: Rect | null;
  /** The editor, while it is open. */
  editor: EditorState | null;
  /** Bumped when an edit is finished; statistics and the graph update. */
  statsRev: number;
  canUndo: boolean;
  canRedo: boolean;

  tool: Tool;
  brushMode: BrushMode;
  /** Brush diameter in image pixels. */
  brushSize: number;

  samModel: SamModelKey;
  samReady: boolean;
  /** Where SAM runs, once loaded. */
  samBackend: SamBackend | null;
  /** Predictions in flight. */
  samBusy: number;
  /** Showing the one-time "this downloads a model" notice. */
  modelNotice: boolean;

  set: (patch: Partial<State>) => void;
  setCube: (cube: HyperCube) => void;
  setTool: (tool: Tool) => void;
  chooseModel: (model: SamModelKey) => void;
  acceptModel: () => void;
  prepareSam: () => Promise<boolean>;
  /** A plain click creates one object or selects the one under it; `add` and `exclude` refine the active object. */
  highlightAt: (x: number, y: number, mode?: ClickMode) => Promise<void>;
  highlightBox: (box: Box) => Promise<void>;
  removePoint: (regionId: number, index: number) => Promise<void>;
  removeLastPoint: () => Promise<void>;
  beginStroke: () => boolean;
  paintStroke: (x0: number, y0: number, x1: number, y1: number) => void;
  endStroke: () => void;
  togglePixel: (x: number, y: number) => void;
  renameRegion: (id: number, name: string) => void;
  shrinkRegion: (id: number) => void;
  deleteRegion: (id: number) => void;
  clearHighlights: () => void;
  undo: () => void;
  redo: () => void;
  openEditor: (id: number) => void;
  closeEditor: () => void;
  /** Throw away hand edits and outline the highlight again from its clicks. */
  resetOutline: (id: number) => Promise<void>;
  /** One undo step. A mask named like an existing highlight replaces it; any other becomes a new one. */
  addMasks: (masks: IncomingMask[]) => MaskImportResult;
  notify: (notice: string) => void;
  /** Write pending edits now. */
  flushSave: () => Promise<void>;
}

const pref = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* The preference just won't be remembered. */
    }
  },
};

const MODEL_PREF = 'hsiv.sam.model';
const acceptedKey = (m: SamModelKey) => `hsiv.sam.accepted.${m}`;
/** Also kept in memory: where browser storage is blocked, the notice must still only appear once. */
const acceptedNow = new Set<SamModelKey>();
const modelAccepted = (m: SamModelKey) => acceptedNow.has(m) || pref.get(acceptedKey(m)) !== null;
const initialModel = (): SamModelKey => {
  const m = pref.get(MODEL_PREF);
  return m && m in SAM_MODELS ? (m as SamModelKey) : DEFAULT_SAM_MODEL;
};

let store: HighlightStore = browserStore;
/** Swap the browser database for a fake in tests. */
export function setHighlightStore(s: HighlightStore) {
  store = s;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const objectName = (id: number) => `Object ${id}`;
const usesSam = (t: Tool) => t === 'point' || t === 'box';

export const useStore = create<State>((set, get) => {
  let history = new History<Snapshot>();
  /** Bumped by undo, redo, deletes and new images: any highlight operation started earlier is dropped. */
  let epoch = 0;
  /** Highlight operations run one at a time, so each click starts from settled labels. */
  let ops: Promise<unknown> = Promise.resolve();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let askedToPersist = false;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let stroke: { id: number; before: Snapshot; created: boolean; changed: boolean; dirty: Rect | null } | null = null;
  /** Edits made in this editor session: its undo stops here, so it can't reach back to other highlights. */
  let editorEdits = 0;

  const notify = (notice: string) => {
    clearTimeout(noticeTimer);
    set({ notice });
    noticeTimer = setTimeout(() => set({ notice: null }), 5000);
  };

  const snapshot = (): Snapshot => {
    const { labels, regions, nextId, activeRegion } = get();
    return { rle: encodeRle(labels!), regions, nextId, activeRegion };
  };

  const syncHistory = () => set({ canUndo: history.canUndo && (!get().editor || editorEdits > 0), canRedo: history.canRedo });
  const checkpoint = (before = snapshot()) => {
    history.push(before);
    editorEdits++;
    syncHistory();
  };

  const saveNow = async () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const { cube, labels, regions, nextId, activeRegion, fingerprint } = get();
    if (!cube || !labels || !fingerprint) return;
    // Serialize now: the image may be replaced before the write finishes.
    const saved = regions.length ? serializeHighlights(cube, fingerprint, { regions, labels, nextId, activeRegion }) : null;
    // Ask the browser not to clear saved highlights when disk space runs low.
    if (saved && !askedToPersist && typeof navigator !== 'undefined') {
      askedToPersist = true;
      void navigator.storage?.persist?.().catch(() => undefined);
    }
    try {
      await (saved ? store.set(fingerprint, saved) : store.delete(fingerprint));
    } catch (e) {
      set({ error: `Your highlights could not be saved in this browser: ${message(e)}. Use "Save file" to keep them.` });
    }
  };

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(), 300);
  };

  /** An edit is finished: refresh statistics and save. */
  const committed = () => {
    set({ maskRev: get().maskRev + 1, maskDirty: null, statsRev: get().statsRev + 1 });
    scheduleSave();
    const { editor, regions } = get();
    if (editor && !regions.some((r) => r.id === editor.id)) {
      get().closeEditor();
      notify('That highlight was erased completely. Ctrl+Z brings it back.');
    }
  };

  const restore = (s: Snapshot) => {
    epoch++;
    get().labels!.set(decodeRle(s.rle, get().labels!.length));
    set({ regions: s.regions, nextId: s.nextId, activeRegion: s.activeRegion });
    syncHistory();
    committed();
  };

  const updateRegion = (id: number, patch: Partial<Region>) =>
    set({ regions: get().regions.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  /** Re-running SAM replaces the outline, so hand edits are only discarded with permission. */
  const mayDiscardEdits = (r: Region) =>
    !r.edited || typeof window === 'undefined' || window.confirm(`Re-outlining ${r.name} will discard your brush edits to it. Continue?`);

  const serial = (job: (isCurrent: () => boolean) => Promise<void>): Promise<void> => {
    const { cubeId } = get();
    const started = epoch;
    const isCurrent = () => get().cubeId === cubeId && epoch === started;
    set({ samBusy: get().samBusy + 1 });
    const run = ops
      .then(() => (isCurrent() ? job(isCurrent) : undefined))
      .catch((e) => {
        if (isCurrent()) set({ error: message(e) });
      })
      .finally(() => set({ samBusy: get().samBusy - 1 }));
    ops = run;
    return run;
  };

  /** Outline a region whose prompts just changed. If it can't be done, its prompts go back to `before`. */
  const outline = async (id: number, before: Snapshot, created: boolean, isCurrent: () => boolean) => {
    const labels = get().labels!;
    const revert = () => {
      const old = before.regions.find((r) => r.id === id);
      if (created || !old) removeRegion(id);
      else updateRegion(id, { points: old.points, box: old.box });
      committed();
    };
    try {
      if (!(await get().prepareSam())) {
        if (isCurrent()) revert();
        return;
      }
      if (!isCurrent()) return;
      const region = get().regions.find((r) => r.id === id);
      if (!region) return;
      const mask = await predictSam2({ points: region.points, box: region.box });
      if (!isCurrent()) return;
      const count = applyBinaryMask(labels, id, mask);
      if (!count && created) {
        revert();
        notify('That area is already highlighted.');
        return;
      }
      updateRegion(id, { edited: false });
      set({ activeRegion: id });
      committed();
    } catch (e) {
      if (isCurrent()) {
        revert();
        throw e;
      }
    }
  };

  const removeRegion = (id: number) => {
    clearLabel(get().labels!, id);
    set({
      regions: get().regions.filter((r) => r.id !== id),
      activeRegion: get().activeRegion === id ? 0 : get().activeRegion,
    });
  };

  const addRegion = (patch: Partial<Region> = {}): Region => {
    const id = get().nextId;
    const region: Region = { id, name: objectName(id), points: [], box: null, edited: false, ...patch };
    set({ regions: [...get().regions, region], nextId: id + 1, activeRegion: id });
    return region;
  };

  return {
    cube: null,
    cubeId: 0,
    fingerprint: '',
    sourceName: '',
    candidates: [],
    pickerOpen: false,
    loading: null,
    error: null,
    notice: null,
    selected: null,
    hovered: null,
    labels: null,
    regions: [],
    nextId: 1,
    activeRegion: 0,
    maskRev: 0,
    maskDirty: null,
    editor: null,
    statsRev: 0,
    canUndo: false,
    canRedo: false,
    tool: 'pixel',
    brushMode: 'add',
    brushSize: 12,
    samModel: initialModel(),
    samReady: false,
    samBackend: null,
    samBusy: 0,
    modelNotice: false,

    set: (patch) => set(patch),

    setCube: (cube) => {
      if (saveTimer !== undefined) void saveNow();
      epoch++;
      stroke = null;
      history = new History<Snapshot>();
      resetSam2Image();
      const cubeId = get().cubeId + 1;
      const fingerprint = cubeFingerprint(cube);
      const labels = new Uint16Array(cube.width * cube.height);
      set({
        cube,
        cubeId,
        fingerprint,
        selected: null,
        hovered: null,
        error: null,
        notice: null,
        labels,
        regions: [],
        nextId: 1,
        activeRegion: 0,
        maskRev: get().maskRev + 1,
        maskDirty: null,
        editor: null,
        statsRev: get().statsRev + 1,
        canUndo: false,
        canRedo: false,
        tool: 'pixel',
        samReady: false,
      });
      loadHighlights(store, fingerprint, cube.width, cube.height)
        .then((saved) => {
          if (!saved || get().cubeId !== cubeId || get().regions.length) return;
          labels.set(saved.labels);
          set({ regions: saved.regions, nextId: saved.nextId, activeRegion: saved.activeRegion, maskRev: get().maskRev + 1, maskDirty: null, statsRev: get().statsRev + 1 });
        })
        .catch((e) => {
          if (get().cubeId === cubeId) set({ error: `Saved highlights could not be read: ${message(e)}` });
        });
    },

    setTool: (tool) => {
      set({ tool });
      if (!usesSam(tool)) return;
      if (modelAccepted(get().samModel)) void get().prepareSam();
      else set({ modelNotice: true });
    },

    chooseModel: (samModel) => {
      pref.set(MODEL_PREF, samModel);
      set({ samModel, samReady: false, samBackend: null });
      if (usesSam(get().tool)) get().setTool(get().tool);
    },

    acceptModel: () => {
      acceptedNow.add(get().samModel);
      pref.set(acceptedKey(get().samModel), '1');
      set({ modelNotice: false });
      void get().prepareSam();
    },

    prepareSam: async () => {
      const { cubeId, samModel } = get();
      const rgb = getSam2Rgb();
      if (!rgb) {
        set({ error: 'The image is not ready to highlight yet.' });
        return false;
      }
      const current = () => get().cubeId === cubeId && get().samModel === samModel;
      try {
        const samBackend = await encodeSam2Image(rgb, samModel, String(cubeId), (loading) => {
          if (current()) set({ loading });
        });
        if (!current()) return false;
        set({ samReady: true, samBackend, loading: null });
        return true;
      } catch (e) {
        if (current()) set({ samReady: false, loading: null, error: `SAM 2 could not start: ${message(e)}` });
        return false;
      }
    },

    highlightAt: (x, y, mode = 'new') => {
      if (!modelAccepted(get().samModel)) {
        set({ modelNotice: true });
        return Promise.resolve();
      }
      return serial(async (isCurrent) => {
        const { cube, labels, activeRegion, regions } = get();
        if (!cube || !labels) return;
        const under = labels[y * cube.width + x];
        const point: RegionPrompt = { x, y, label: mode === 'exclude' ? 0 : 1 };

        if (mode === 'new') {
          // One click, one object: never merged into a neighbouring leaf, however close.
          if (under) {
            set({ activeRegion: under, selected: null });
            return;
          }
          const before = snapshot();
          checkpoint(before);
          const region = addRegion({ points: [point] });
          set({ selected: null });
          await outline(region.id, before, true, isCurrent);
          return;
        }

        const region = regions.find((r) => r.id === activeRegion);
        if (!region) {
          notify('Select a highlight first: this click refines the selected one.');
          return;
        }
        if (mode === 'add' && under && under !== region.id) {
          notify('That pixel already belongs to another highlight.');
          return;
        }
        if (!mayDiscardEdits(region)) return;
        const before = snapshot();
        checkpoint(before);
        updateRegion(region.id, { points: [...region.points, point] });
        await outline(region.id, before, false, isCurrent);
      });
    },

    highlightBox: (box) => {
      if (!modelAccepted(get().samModel)) {
        set({ modelNotice: true });
        return Promise.resolve();
      }
      return serial(async (isCurrent) => {
        if (!get().cube || !get().labels) return;
        const before = snapshot();
        checkpoint(before);
        const region = addRegion({ box });
        set({ selected: null });
        await outline(region.id, before, true, isCurrent);
      });
    },

    removePoint: (regionId, index) =>
      serial(async (isCurrent) => {
        const region = get().regions.find((r) => r.id === regionId);
        if (!region || !mayDiscardEdits(region)) return;
        const before = snapshot();
        checkpoint(before);
        const points = region.points.filter((_, i) => i !== index);
        if (!points.length && !region.box) {
          // Its last prompt is gone, so the object is too.
          removeRegion(regionId);
          committed();
          return;
        }
        updateRegion(regionId, { points });
        set({ activeRegion: regionId });
        await outline(regionId, before, false, isCurrent);
      }),

    removeLastPoint: async () => {
      const region = get().regions.find((r) => r.id === get().activeRegion);
      if (region?.points.length) await get().removePoint(region.id, region.points.length - 1);
    },

    beginStroke: () => {
      if (!get().labels) return false;
      if (get().samBusy) {
        notify('Still outlining. Paint once it has finished.');
        return false;
      }
      const before = snapshot();
      let id = get().activeRegion;
      let created = false;
      if (!id) {
        if (get().brushMode === 'erase') {
          notify('Select a highlight to erase from.');
          return false;
        }
        id = addRegion().id;
        created = true;
      }
      stroke = { id, before, created, changed: false, dirty: null };
      return true;
    },

    paintStroke: (x0, y0, x1, y1) => {
      const { cube, labels, brushMode, brushSize } = get();
      if (!cube || !labels || !stroke) return;
      if (!stampLine(labels, cube.width, cube.height, x0, y0, x1, y1, brushSize, stroke.id, brushMode)) return;
      stroke.changed = true;
      const r = brushSize / 2 + 1;
      set({
        selected: null,
        maskRev: get().maskRev + 1,
        maskDirty: { x0: Math.min(x0, x1) - r, y0: Math.min(y0, y1) - r, x1: Math.max(x0, x1) + r, y1: Math.max(y0, y1) + r },
      });
    },

    endStroke: () => {
      const s = stroke;
      stroke = null;
      if (!s || !get().labels) return;
      if (!s.changed) {
        if (s.created) {
          removeRegion(s.id);
          set({ nextId: s.before.nextId, activeRegion: s.before.activeRegion });
        }
        return;
      }
      checkpoint(s.before);
      if (countLabel(get().labels!, s.id)) updateRegion(s.id, { edited: true });
      else removeRegion(s.id);
      committed();
    },

    togglePixel: (x, y) => {
      const { cube, labels, regions, activeRegion } = get();
      if (!cube || !labels) return;
      const i = y * cube.width + x;
      if (labels[i] && labels[i] !== activeRegion) {
        notify('That pixel already belongs to another highlight.');
        return;
      }
      checkpoint();
      let id = activeRegion;
      if (!regions.some((r) => r.id === id)) id = addRegion({ name: `Pixels ${get().nextId}`, edited: true }).id;
      labels[i] = labels[i] ? 0 : id;
      if (countLabel(labels, id)) updateRegion(id, { edited: true });
      else removeRegion(id);
      set({ selected: null });
      committed();
    },

    renameRegion: (id, name) => {
      updateRegion(id, { name });
      scheduleSave();
    },

    shrinkRegion: (id) => {
      const { cube, labels } = get();
      if (!cube || !labels) return;
      checkpoint();
      erodeLabel(labels, id, cube.width, cube.height);
      if (countLabel(labels, id)) updateRegion(id, { edited: true });
      else removeRegion(id);
      committed();
    },

    deleteRegion: (id) => {
      if (!get().labels) return;
      epoch++;
      checkpoint();
      removeRegion(id);
      committed();
    },

    clearHighlights: () => {
      const { labels } = get();
      if (!labels || !get().regions.length) return;
      epoch++;
      checkpoint();
      labels.fill(0);
      set({ regions: [], activeRegion: 0 });
      committed();
    },

    undo: () => {
      if (!get().labels || (get().editor && editorEdits <= 0)) return;
      const s = history.undo(snapshot());
      if (!s) return;
      editorEdits--;
      restore(s);
    },

    redo: () => {
      if (!get().labels) return;
      const s = history.redo(snapshot());
      if (!s) return;
      editorEdits++;
      restore(s);
    },

    openEditor: (id) => {
      const { cube, labels, tool, samBusy } = get();
      if (!cube || !labels || samBusy) return;
      const b = labelBounds(labels, id, cube.width);
      if (!b) return;
      const x0 = Math.max(0, b.x0 - EDITOR_MARGIN);
      const y0 = Math.max(0, b.y0 - EDITOR_MARGIN);
      const x1 = Math.min(cube.width, b.x1 + EDITOR_MARGIN);
      const y1 = Math.min(cube.height, b.y1 + EDITOR_MARGIN);
      editorEdits = 0;
      history.clearRedo();
      set({ editor: { id, rect: { x0, y0, w: x1 - x0, h: y1 - y0 }, previousTool: tool }, activeRegion: id, tool: 'brush', selected: null, hovered: null });
      syncHistory();
    },

    closeEditor: () => {
      const { editor } = get();
      if (!editor) return;
      // Plain set, not setTool: going back to a highlight tool must not start the model again.
      set({ editor: null, tool: editor.previousTool, hovered: null, maskRev: get().maskRev + 1, maskDirty: null });
      syncHistory();
      void saveNow();
    },

    resetOutline: (id) => {
      if (!modelAccepted(get().samModel)) {
        set({ modelNotice: true });
        return Promise.resolve();
      }
      return serial(async (isCurrent) => {
        const region = get().regions.find((r) => r.id === id);
        if (!region || (!region.points.length && !region.box)) return;
        const before = snapshot();
        checkpoint(before);
        await outline(id, before, false, isCurrent);
      });
    },

    addMasks: (masks) => {
      const result: MaskImportResult = { added: 0, updated: 0, skipped: [] };
      const { labels } = get();
      if (!labels || !masks.length) return result;
      epoch++;
      checkpoint();
      const regionsBefore = get().regions;
      const claimed = new Set<number>();
      let last = 0;
      for (const m of masks) {
        const existing = get().regions.find((r) => r.name === m.name && !claimed.has(r.id));
        const prompts = m.meta ? { points: m.meta.points, box: m.meta.box, edited: m.meta.edited } : { points: [], box: null, edited: true };
        const id = existing?.id ?? get().nextId;
        const count = applyBinaryMask(labels, id, m.mask);
        if (count < m.pixels) result.skipped.push({ name: m.name, pixels: m.pixels - count });
        if (!count) {
          if (existing) removeRegion(existing.id);
          continue;
        }
        if (existing) {
          updateRegion(id, prompts);
          result.updated++;
        } else {
          addRegion({ name: m.name || objectName(id), ...prompts });
          result.added++;
        }
        claimed.add(id);
        last = id;
      }
      if (last) set({ activeRegion: last });
      // Every pixel was already taken and nothing else changed, so there's nothing to undo.
      if (!result.added && !result.updated && get().regions === regionsBefore) {
        history.dropLast();
        syncHistory();
      }
      committed();
      return result;
    },

    notify,

    flushSave: () => saveNow(),
  };
});

if (typeof window !== 'undefined') {
  // A closing tab may not finish a write started later, so save as soon as it goes out of view.
  window.addEventListener('pagehide', () => void useStore.getState().flushSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void useStore.getState().flushSave();
  });
}
