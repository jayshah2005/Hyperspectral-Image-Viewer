import * as Comlink from 'comlink';
import type { LoaderApi } from '../worker/loader.worker';
import type { Axes } from '../types';
import { useStore } from '../store';
import { makeDemoCube } from './demo';

let api: Comlink.Remote<LoaderApi> | null = null;

function worker() {
  api ??= Comlink.wrap<LoaderApi>(new Worker(new URL('../worker/loader.worker.ts', import.meta.url), { type: 'module' }));
  return api;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function openFiles(files: File[]) {
  const { set } = useStore.getState();
  set({ loading: `Reading ${files.map((f) => f.name).join(', ')}…`, error: null });
  try {
    const res = await worker().open(files);
    set({ sourceName: res.sourceName, candidates: res.candidates });
    if (res.candidates.length === 1) {
      await loadCandidate(res.candidates[0].id, res.candidates[0].defaultAxes);
    } else {
      set({ pickerOpen: true, loading: null });
    }
  } catch (e) {
    set({ loading: null, error: message(e) });
  }
}

export async function loadCandidate(id: string, axes: Axes | null) {
  const { set, setCube } = useStore.getState();
  set({ loading: 'Decoding cube…', error: null, pickerOpen: false });
  try {
    const cube = await worker().load(id, axes ?? undefined);
    setCube(cube);
    set({ current: { id, axes }, loading: null });
  } catch (e) {
    set({ loading: null, error: message(e) });
  }
}

export function loadDemo() {
  const { set, setCube } = useStore.getState();
  set({ loading: 'Generating demo scene…', error: null });
  // Let the spinner paint before the synchronous generation.
  setTimeout(() => {
    setCube(makeDemoCube());
    set({ loading: null, candidates: [], current: null, sourceName: 'demo' });
  }, 30);
}
