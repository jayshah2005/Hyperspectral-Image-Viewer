/** SAM 2.1 exports the app can run. Revisions are pinned so results can't change underneath us. */
export type SamModelKey = 'base-plus' | 'tiny';

export interface SamModel {
  label: string;
  id: string;
  revision: string;
  /** Download size in MB: full precision on a GPU, 8-bit on the processor. */
  gpuMB: number;
  cpuMB: number;
}

export const SAM_MODELS: Record<SamModelKey, SamModel> = {
  'base-plus': {
    label: 'Base+',
    id: 'onnx-community/sam2.1-hiera-base-plus-ONNX',
    revision: 'bab18593f44e652f04cf18b60b3690f60e8996b0',
    gpuMB: 327,
    cpuMB: 108,
  },
  tiny: {
    label: 'Tiny',
    id: 'onnx-community/sam2.1-hiera-tiny-ONNX',
    revision: '814a066640debee5a91e70aa401fb8e17e030503',
    gpuMB: 155,
    cpuMB: 61,
  },
};

export const DEFAULT_SAM_MODEL: SamModelKey = 'base-plus';

/**
 * Threads for SAM on the processor. Preparing an image took 10.1 s on 1 thread, 2.6 s on 4 and 1.4 s on 12 (14-core
 * machine). Two cores stay free so the page stays smooth.
 */
export function samThreads(cores: number): number {
  return Math.max(1, Math.min(12, cores - 2));
}

export type SamBackend = 'webgpu' | 'wasm';

/** Full precision needs no optional GPU features (16-bit floats often are unavailable); 8-bit suits the processor. */
export const SAM_DTYPE: Record<SamBackend, string> = { webgpu: 'fp32', wasm: 'uint8' };

/** The ONNX files a model needs on a backend, as stored on Hugging Face. Full precision has no suffix in its name. */
export function samFilePaths(key: SamModelKey, backend: SamBackend): string[] {
  const { id, revision } = SAM_MODELS[key];
  const suffix = backend === 'webgpu' ? '' : `_${SAM_DTYPE[backend]}`;
  return ['vision_encoder', 'prompt_encoder_mask_decoder'].flatMap((part) =>
    ['.onnx', '.onnx_data'].map((ext) => `${id}/resolve/${revision}/onnx/${part}${suffix}${ext}`),
  );
}

export async function hasWebgpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

/** One object's prompts. `label`: 1 = include, 0 = leave out. Box is [x0, y0, x1, y1] in image pixels. */
export interface SamPrompt {
  points: { x: number; y: number; label: 0 | 1 }[];
  box?: [number, number, number, number] | null;
}
