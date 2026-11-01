import * as Comlink from 'comlink';
import type { Sam2Api } from '../worker/sam2.worker';
import type { SamBackend, SamModelKey, SamPrompt } from './samModels';

let api: Comlink.Remote<Sam2Api> | null = null;
let encodedKey = '';
let rgbCanvas: HTMLCanvasElement | null = null;

export function setSam2Rgb(canvas: HTMLCanvasElement | null) {
  rgbCanvas = canvas;
}

export function getSam2Rgb(): HTMLCanvasElement | null {
  return rgbCanvas;
}

/** Rejects if the worker's script can't load or crashes: its calls would otherwise never return. */
let workerFailure: Promise<never> | null = null;

function worker() {
  if (!api) {
    const w = new Worker(new URL('../worker/sam2.worker.ts', import.meta.url), { type: 'module' });
    workerFailure = new Promise<never>((_, reject) => {
      w.addEventListener('error', (e) => {
        // Start afresh on the next try; a new worker has to reload and re-encode.
        api = null;
        encodedKey = '';
        workerFailure = null;
        reject(new Error(e.message || 'The outlining model could not be loaded. Check your connection and reload the page.'));
      });
    });
    workerFailure.catch(() => undefined);
    api = Comlink.wrap<Sam2Api>(w);
  }
  return api;
}

/** All model work runs one job at a time, so a click can never see a half-replaced image. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(() => {
    const result = job();
    return workerFailure ? Promise.race([result, workerFailure]) : result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Load the model if needed and encode this image. `key` identifies the image; it encodes only once per key. */
export function encodeSam2Image(
  canvas: HTMLCanvasElement,
  model: SamModelKey,
  key: string,
  onProgress?: (message: string) => void,
): Promise<SamBackend> {
  return enqueue(async () => {
    const progress = onProgress ? Comlink.proxy(onProgress) : undefined;
    const backend = await worker().load(model, progress);
    const full = `${model}:${key}`;
    if (encodedKey !== full) {
      encodedKey = '';
      const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      await worker().encode(Comlink.transfer({ data: img.data, width: canvas.width, height: canvas.height }, [img.data.buffer]), progress);
      encodedKey = full;
    }
    return backend;
  });
}

export function predictSam2(prompt: SamPrompt): Promise<Uint8Array> {
  return enqueue(() => worker().predict(prompt));
}

export function resetSam2Image() {
  void enqueue(async () => {
    encodedKey = '';
    await api?.reset();
  });
}
