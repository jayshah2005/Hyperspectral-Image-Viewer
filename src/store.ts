import { create } from 'zustand';
import type { Candidate, HyperCube } from './types';

interface State {
  cube: HyperCube | null;
  /** Increments on every new cube; used to reset per-cube UI state. */
  cubeId: number;
  sourceName: string;
  candidates: Candidate[];
  pickerOpen: boolean;
  loading: string | null;
  error: string | null;
  /** The clicked pixel whose spectrum is plotted. */
  selected: { x: number; y: number } | null;
  /** The pixel under the mouse; its spectrum is plotted while nothing is selected. */
  hovered: { x: number; y: number } | null;

  set: (patch: Partial<State>) => void;
  setCube: (cube: HyperCube) => void;
}

export const useStore = create<State>((set, get) => ({
  cube: null,
  cubeId: 0,
  sourceName: '',
  candidates: [],
  pickerOpen: false,
  loading: null,
  error: null,
  selected: null,
  hovered: null,

  set: (patch) => set(patch),
  setCube: (cube) => set({ cube, cubeId: get().cubeId + 1, selected: null, hovered: null, error: null }),
}));
