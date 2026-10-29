import { create } from 'zustand';
import type { Axes, Candidate, HyperCube } from './types';
import type { ColormapName } from './lib/colormaps';
import type { Rect } from './lib/analysis';
import { covers, nearestBand, nmToCubeUnits } from './lib/cube';

/** Categorical series colours (dark-surface steps), assigned in fixed order. */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export interface Pin {
  id: number;
  kind: 'pixel' | 'roi';
  label: string;
  color: string;
  /** Pins past the eighth reuse colours with a dashed line so identity isn't colour alone. */
  dashed: boolean;
  x: number;
  y: number;
  rect?: Rect;
  spectrum: Float64Array;
  std?: Float64Array;
  count?: number;
  visible: boolean;
}

export interface Derived {
  name: string;
  data: Float32Array;
  colormap: ColormapName;
  unit?: string;
}

export type DisplayMode = 'single' | 'rgb';

interface State {
  cube: HyperCube | null;
  /** Increments on every new cube; used to reset per-cube UI state. */
  cubeId: number;
  sourceName: string;
  candidates: Candidate[];
  current: { id: string; axes: Axes | null } | null;
  pickerOpen: boolean;
  loading: string | null;
  error: string | null;

  mode: DisplayMode;
  band: number;
  rgb: [number, number, number];
  colormap: ColormapName;
  lowPct: number;
  highPct: number;
  gamma: number;

  derived: Derived | null;
  showDerived: boolean;

  hover: { x: number; y: number } | null;
  pins: Pin[];
  refPinId: number | null;
  nextPinId: number;

  set: (patch: Partial<State>) => void;
  setCube: (cube: HyperCube) => void;
  addPin: (p: Omit<Pin, 'id' | 'color' | 'dashed' | 'visible' | 'label'> & { label?: string }) => void;
  updatePin: (id: number, patch: Partial<Pin>) => void;
  removePin: (id: number) => void;
  clearPins: () => void;
}

/** Bands for a natural-colour composite if the wavelengths cover the visible range. */
export function trueColorBands(cube: HyperCube): [number, number, number] | null {
  if (!covers(cube, 460, 640)) return null;
  return [640, 550, 470].map((nm) => nearestBand(cube, nmToCubeUnits(cube, nm))) as [number, number, number];
}

/** Colour-infrared composite (NIR, red, green) — vegetation shows red. */
export function falseColorBands(cube: HyperCube): [number, number, number] | null {
  if (!covers(cube, 550, 860)) return null;
  return [860, 650, 550].map((nm) => nearestBand(cube, nmToCubeUnits(cube, nm))) as [number, number, number];
}

export function spreadBands(cube: HyperCube): [number, number, number] {
  const B = cube.bands;
  return [Math.round((B - 1) * 0.75), Math.round((B - 1) * 0.5), Math.round((B - 1) * 0.25)];
}

export const useStore = create<State>((set, get) => ({
  cube: null,
  cubeId: 0,
  sourceName: '',
  candidates: [],
  current: null,
  pickerOpen: false,
  loading: null,
  error: null,

  mode: 'rgb',
  band: 0,
  rgb: [0, 0, 0],
  colormap: 'gray',
  lowPct: 2,
  highPct: 98,
  gamma: 1,

  derived: null,
  showDerived: false,

  hover: null,
  pins: [],
  refPinId: null,
  nextPinId: 1,

  set: (patch) => set(patch),

  setCube: (cube) => {
    const rgb = cube.defaultBands?.every((b) => b >= 0 && b < cube.bands)
      ? cube.defaultBands
      : (trueColorBands(cube) ?? spreadBands(cube));
    set({
      cube,
      cubeId: get().cubeId + 1,
      mode: cube.bands >= 3 ? 'rgb' : 'single',
      band: Math.floor(cube.bands / 2),
      rgb,
      derived: null,
      showDerived: false,
      hover: null,
      pins: [],
      refPinId: null,
      nextPinId: 1,
      error: null,
    });
  },

  addPin: (p) => {
    const { pins, nextPinId } = get();
    const slot = nextPinId - 1;
    const pin: Pin = {
      ...p,
      id: nextPinId,
      label: p.label ?? (p.kind === 'roi' ? `ROI ${nextPinId}` : `Pixel (${p.x}, ${p.y})`),
      color: SERIES_COLORS[slot % SERIES_COLORS.length],
      dashed: slot >= SERIES_COLORS.length,
      visible: true,
    };
    set({ pins: [...pins, pin], nextPinId: nextPinId + 1, refPinId: get().refPinId ?? pin.id });
  },

  updatePin: (id, patch) => set({ pins: get().pins.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),

  removePin: (id) => {
    const pins = get().pins.filter((p) => p.id !== id);
    set({ pins, refPinId: get().refPinId === id ? (pins[0]?.id ?? null) : get().refPinId });
  },

  clearPins: () => set({ pins: [], refPinId: null }),
}));
