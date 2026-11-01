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

export type SamBackend = 'webgpu' | 'wasm';

/** One object's prompts. `label`: 1 = include, 0 = leave out. Box is [x0, y0, x1, y1] in image pixels. */
export interface SamPrompt {
  points: { x: number; y: number; label: 0 | 1 }[];
  box?: [number, number, number, number] | null;
}
