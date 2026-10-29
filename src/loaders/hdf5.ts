import type { CubeArray } from '../types';
import { toCubeArray } from '../lib/dtypes';

type H5 = typeof import('h5wasm').default;
type H5File = InstanceType<H5['File']>;

export interface H5DatasetInfo {
  path: string;
  shape: number[];
  dtype: string;
}

export interface H5Handle {
  datasets: H5DatasetInfo[];
  read(path: string): CubeArray;
  /** Numeric attributes on a dataset (e.g. wavelength lists). */
  attrs(path: string): { name: string; values: number[] }[];
  close(): void;
}

const H5T_INTEGER = 0;
const H5T_FLOAT = 1;
let h5Promise: Promise<H5> | null = null;
let fileCounter = 0;

function loadH5wasm(): Promise<H5> {
  h5Promise ??= import('h5wasm').then(async (m) => {
    await m.default.ready;
    return m.default;
  });
  return h5Promise;
}

function walk(h5: H5, group: InstanceType<H5['Group']>, prefix: string, out: H5DatasetInfo[]) {
  for (const key of group.keys()) {
    if (key === '#refs#' || key === '#subsystem#') continue; // MATLAB v7.3 internals
    const path = `${prefix}/${key}`;
    let entity;
    try {
      entity = group.get(key);
    } catch {
      continue; // broken/external links
    }
    if (entity instanceof h5.Group) walk(h5, entity, path, out);
    else if (entity instanceof h5.Dataset) {
      const meta = entity.metadata;
      if ((meta.type === H5T_INTEGER || meta.type === H5T_FLOAT) && entity.shape) {
        const kind = meta.type === H5T_FLOAT ? 'float' : meta.signed ? 'int' : 'uint';
        out.push({ path, shape: entity.shape, dtype: `${kind}${meta.size * 8}` });
      }
    }
  }
}

/** Open an HDF5 file (including MATLAB v7.3 .mat) held in memory. */
export async function openH5(buf: ArrayBuffer): Promise<H5Handle> {
  const h5 = await loadH5wasm();
  const { FS } = await h5.ready;
  const fsPath = `/hsi_${++fileCounter}.h5`;
  FS.writeFile(fsPath, new Uint8Array(buf));
  let file: H5File;
  try {
    file = new h5.File(fsPath, 'r');
  } catch (e) {
    FS.unlink(fsPath);
    throw new Error(`Could not open as HDF5 (HDF4 and NetCDF-3 files are not supported): ${(e as Error).message}`);
  }

  const datasets: H5DatasetInfo[] = [];
  walk(h5, file, '', datasets);

  const dataset = (path: string) => {
    const ds = file.get(path);
    if (!(ds instanceof h5.Dataset)) throw new Error(`${path} is not a dataset.`);
    return ds;
  };

  return {
    datasets,
    read(path) {
      const value = dataset(path).value;
      if (!ArrayBuffer.isView(value)) throw new Error(`${path} did not return a numeric array.`);
      return toCubeArray(value as ArrayLike<number>);
    },
    attrs(path) {
      const ds = dataset(path);
      const out: { name: string; values: number[] }[] = [];
      for (const [name, attr] of Object.entries(ds.attrs)) {
        try {
          const v = attr.value;
          if (ArrayBuffer.isView(v)) out.push({ name, values: Array.from(toCubeArray(v as ArrayLike<number>)) });
          else if (Array.isArray(v) && v.every((n) => typeof n === 'number')) out.push({ name, values: v as number[] });
        } catch {
          // unreadable attribute types are skipped
        }
      }
      return out;
    },
    close() {
      file.close();
      FS.unlink(fsPath);
    },
  };
}
