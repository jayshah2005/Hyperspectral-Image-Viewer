import * as Comlink from 'comlink';
import type { LoaderApi } from '../worker/loader.worker';
import type { Axes } from '../types';
import { useStore } from '../store';

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
    set({ loading: null });
  } catch (e) {
    set({ loading: null, error: message(e) });
  }
}

/** A real Specim IQ capture of a vine row, bundled from public/demo (~65 MB in two gzipped halves). */
export async function loadDemo() {
  const { set, setCube } = useStore.getState();
  const MB = (n: number) => (n / 1e6).toFixed(0);
  set({ loading: 'Downloading demo cube…', error: null });
  let shown = '';
  const onProgress = (loaded: number, total: number | null) => {
    const text = !total
      ? `Downloading demo cube… ${MB(loaded)} MB`
      : loaded >= total
        ? 'Decoding demo cube…'
        : `Downloading demo cube… ${Math.floor((100 * loaded) / total)}% of ${MB(total)} MB`;
    if (text !== shown) set({ loading: (shown = text) });
  };
  try {
    // Resolve against the page, not the worker script, so it works under the GitHub Pages sub-path.
    const url = (f: string) => new URL(`demo/${f}`, document.baseURI).href;
    const cube = await worker().loadRemoteEnvi(
      url('vine_row30.hdr'),
      [url('vine_row30.img.part1.gz'), url('vine_row30.img.part2.gz')],
      'Demo: vine row (Specim IQ)',
      Comlink.proxy(onProgress),
    );
    setCube(cube);
    set({ loading: null, candidates: [], sourceName: 'demo' });
  } catch (e) {
    set({ loading: null, error: message(e) });
  }
}
