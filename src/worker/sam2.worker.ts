import * as Comlink from 'comlink';
import ortMjs from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import { cleanMask, pickBestMask } from '../lib/mask';
import { SAM_MODELS, type SamBackend, type SamModelKey, type SamPrompt } from '../lib/samModels';

type Progress = (message: string) => void;

interface Embeddings {
  tensors: Record<string, unknown>;
  original_sizes: number[][];
  reshaped_input_sizes: number[][];
  width: number;
  height: number;
}

// The published typings omit Sam2Model / Sam2Processor.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tf = any;

let tf: Tf | null = null;
let model: Tf | null = null;
let processor: Tf | null = null;
let loadedKey: SamModelKey | null = null;
let backend: SamBackend | null = null;
let encoded: Embeddings | null = null;

async function transformers(): Promise<Tf> {
  if (!tf) {
    tf = await import('@huggingface/transformers');
    // Use the runtime shipped with the site, not its default copy on a third-party CDN. The library
    // picks another build for old Safari without WebGPU; leave that one alone, since it isn't shipped.
    const wasm = tf.env.backends.onnx.wasm;
    if (String(wasm.wasmPaths?.mjs).endsWith('.asyncify.mjs')) {
      wasm.wasmPaths = { mjs: new URL(ortMjs, import.meta.url).href, wasm: new URL(ortWasm, import.meta.url).href };
    }
  }
  return tf;
}

async function hasWebgpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

/** Full precision needs no optional GPU features (16-bit floats often are unavailable); 8-bit suits the processor. */
const CONFIG: Record<SamBackend, { device: SamBackend; dtype: string }> = {
  webgpu: { device: 'webgpu', dtype: 'fp32' },
  wasm: { device: 'wasm', dtype: 'uint8' },
};

const api = {
  /** Check for a GPU before downloading anything, then fall back to the processor if its session fails. */
  async load(key: SamModelKey, onProgress?: Progress): Promise<SamBackend> {
    if (model && processor && backend && loadedKey === key) return backend;
    await model?.dispose?.();
    model = processor = encoded = backend = loadedKey = null;

    const { Sam2Model, Sam2Processor } = await transformers();
    const { label, id, revision, gpuMB, cpuMB } = SAM_MODELS[key];
    const order: SamBackend[] = (await hasWebgpu()) ? ['webgpu', 'wasm'] : ['wasm'];
    let lastError: unknown;
    for (const b of order) {
      const size = b === 'webgpu' ? gpuMB : cpuMB;
      const where = b === 'webgpu' ? 'graphics card' : 'processor';
      onProgress?.(`Loading SAM 2 ${label} for your ${where}…`);
      try {
        model = await Sam2Model.from_pretrained(id, {
          revision,
          ...CONFIG[b],
          progress_callback: (info: { status?: string; progress?: number }) => {
            if (info.status === 'progress_total' && typeof info.progress === 'number') {
              onProgress?.(`Loading SAM 2 ${label} (${size} MB, once only)… ${Math.round(info.progress)}%`);
            }
          },
        });
        processor = await Sam2Processor.from_pretrained(id, { revision });
        loadedKey = key;
        backend = b;
        return b;
      } catch (e) {
        lastError = e;
        console.warn(`SAM 2 could not start on ${b}:`, e);
        await model?.dispose?.();
        model = null;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  },

  async encode(image: { data: Uint8ClampedArray; width: number; height: number }, onProgress?: Progress) {
    if (!model || !processor) throw new Error('SAM 2 is not loaded.');
    onProgress?.(backend === 'wasm' ? 'Preparing image for SAM 2 (takes a few seconds without a GPU)…' : 'Preparing image for SAM 2…');
    encoded = null;
    const { RawImage } = await transformers();
    const rgb = new Uint8Array(image.width * image.height * 3);
    for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
      rgb[j] = image.data[i];
      rgb[j + 1] = image.data[i + 1];
      rgb[j + 2] = image.data[i + 2];
    }
    const raw = new RawImage(rgb, image.width, image.height, 3);
    const inputs = await processor(raw);
    encoded = {
      tensors: await model.get_image_embeddings(inputs),
      original_sizes: inputs.original_sizes,
      reshaped_input_sizes: inputs.reshaped_input_sizes,
      width: image.width,
      height: image.height,
    };
  },

  /** One object's mask (0/1, image-sized), cleaned as the Segmentation app does. */
  async predict(prompt: SamPrompt): Promise<Uint8Array> {
    if (!model || !processor || !encoded) throw new Error('SAM 2 is not ready.');
    const { points, box } = prompt;
    if (!points.length && !box) throw new Error('Click an object to highlight it.');
    const { Tensor } = await transformers();
    const [rH, rW] = encoded.reshaped_input_sizes[0];
    const sx = rW / encoded.width;
    const sy = rH / encoded.height;
    const inputs: Record<string, unknown> = {};
    if (points.length) {
      const coords = new Float32Array(points.length * 2);
      const labels = new BigInt64Array(points.length);
      points.forEach((p, i) => {
        coords[i * 2] = p.x * sx;
        coords[i * 2 + 1] = p.y * sy;
        labels[i] = BigInt(p.label);
      });
      inputs.input_points = new Tensor('float32', coords, [1, 1, points.length, 2]);
      inputs.input_labels = new Tensor('int64', labels, [1, 1, points.length]);
    }
    if (box) {
      inputs.input_boxes = new Tensor('float32', Float32Array.from([box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy]), [1, 1, 4]);
    }
    const out = await model({ ...encoded.tensors, ...inputs });
    const masks = await processor.post_process_masks(out.pred_masks, encoded.original_sizes, encoded.reshaped_input_sizes);
    const best = pickBestMask(masks[0].data, masks[0].dims, out.iou_scores.data, encoded.width, encoded.height, points);
    return cleanMask(best, encoded.width, encoded.height);
  },

  reset() {
    encoded = null;
  },
};

export type Sam2Api = typeof api;

Comlink.expose(api);
