import * as Comlink from 'comlink';
import { guessAxes, isCubeShape, squeeze, toBSQ } from '../loaders/arrayToCube';
import { parseEnvi, parseEnviHeader } from '../loaders/envi';
import { parseGeoTiff } from '../loaders/geotiff';
import { openH5, type H5Handle } from '../loaders/hdf5';
import { isMat73, parseMatV5, type MatVariable } from '../loaders/mat';
import { parseNpy, readNpyHeader } from '../loaders/npy';
import { fromArrayBuffer } from 'geotiff';
import type { Axes, Candidate, HyperCube, NdArray, OpenResult } from '../types';

type Source =
  | { kind: 'envi'; header: string; dataFile: File }
  | { kind: 'tiff'; file: File }
  | { kind: 'npy'; file: File }
  | { kind: 'mat'; vars: MatVariable[] }
  | { kind: 'h5'; handle: H5Handle; matlab: boolean };

let source: Source | null = null;
let sourceName = '';

const ext = (name: string) => name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';
const stem = (name: string) => name.replace(/\.[^.]+$/, '');

function closeSource() {
  if (source?.kind === 'h5') source.handle.close();
  source = null;
}

/** Look for a 1-D vector that is plausibly the wavelength axis. */
function findWavelengths(vectors: { name: string; values: ArrayLike<number> }[], bands: number) {
  const v = vectors.find((c) => c.values.length === bands && /wave|lambda|wvl|^wl|band_?cent/i.test(c.name));
  if (!v) return {};
  const values = Array.from(v.values);
  return { wavelengths: values, wavelengthUnits: Math.max(...values) < 30 ? 'µm' : 'nm' };
}

function candidateFromShape(id: string, label: string, shape: number[], dtype: string): Candidate {
  const squeezed = shape.filter((d) => d !== 1);
  return { id, label, shape, dtype, defaultAxes: guessAxes(squeezed) };
}

async function open(files: File[]): Promise<OpenResult> {
  closeSource();
  if (!files.length) throw new Error('No files selected.');

  const hdr = files.find((f) => ext(f.name) === 'hdr');
  if (hdr) {
    const others = files.filter((f) => f !== hdr);
    const dataFile =
      others.find((f) => stem(f.name) === stem(hdr.name)) ?? others.find((f) => f.name === stem(hdr.name)) ?? others[0];
    if (!dataFile) {
      throw new Error(`"${hdr.name}" is an ENVI header. Select it together with its data file (e.g. .img/.raw/.dat).`);
    }
    const header = await hdr.text();
    const h = parseEnviHeader(header);
    source = { kind: 'envi', header, dataFile };
    sourceName = stem(hdr.name);
    return {
      sourceName,
      candidates: [{ id: 'envi', label: `${h.interleave.toUpperCase()} ${h.dtype}`, shape: [h.lines, h.samples, h.bands], dtype: h.dtype, defaultAxes: null }],
    };
  }

  const file = files[0];
  sourceName = file.name;
  const e = ext(file.name);

  if (e === 'npy') {
    const h = readNpyHeader(await file.slice(0, 65536).arrayBuffer());
    if (!isCubeShape(h.shape)) throw new Error(`Expected a 3-D array, got shape (${h.shape.join(', ')}).`);
    source = { kind: 'npy', file };
    return { sourceName, candidates: [candidateFromShape('npy', 'array', h.shape, h.dtype)] };
  }

  if (e === 'tif' || e === 'tiff') {
    const tiff = await fromArrayBuffer(await file.arrayBuffer());
    const img = await tiff.getImage(0);
    const spp = img.getSamplesPerPixel();
    const bands = spp > 1 ? spp : await tiff.getImageCount();
    source = { kind: 'tiff', file };
    return { sourceName, candidates: [{ id: 'tiff', label: 'GeoTIFF', shape: [img.getHeight(), img.getWidth(), bands], dtype: '', defaultAxes: null }] };
  }

  if (e === 'mat' || e === 'h5' || e === 'hdf5' || e === 'he5' || e === 'nc') {
    const buf = await file.arrayBuffer();
    if (e === 'mat' && !isMat73(buf)) {
      const vars = parseMatV5(buf);
      source = { kind: 'mat', vars };
      const candidates = vars
        .filter((v) => isCubeShape(v.dims))
        .map((v) => candidateFromShape(v.name, v.name, v.dims, v.dtype));
      if (!candidates.length) throw new Error(`No 3-D numeric variables found in ${file.name}.`);
      return { sourceName, candidates };
    }
    const handle = await openH5(buf);
    const matlab = e === 'mat';
    source = { kind: 'h5', handle, matlab };
    // MATLAB v7.3 writes dimensions reversed (column-major); present them in MATLAB order.
    const candidates = handle.datasets
      .filter((d) => isCubeShape(d.shape))
      .map((d) => candidateFromShape(d.path, d.path.replace(/^\//, ''), matlab ? [...d.shape].reverse() : d.shape, d.dtype));
    if (!candidates.length) throw new Error(`No 3-D numeric datasets found in ${file.name}.`);
    return { sourceName, candidates };
  }

  if (!e || ['img', 'raw', 'dat', 'bsq', 'bil', 'bip'].includes(e)) {
    throw new Error(`"${file.name}" looks like an ENVI data file. Select it together with its .hdr header.`);
  }
  throw new Error(`Unsupported file type ".${e}". Supported: ENVI (.hdr + data), .mat, .npy, .h5/.hdf5/.he5/.nc, .tif/.tiff.`);
}

function ndToCube(nd: NdArray, axes: Axes | undefined, name: string, mustCopy: boolean): HyperCube {
  const sq = squeeze(nd);
  const bsq = toBSQ(sq, axes ?? guessAxes(sq.shape));
  if (mustCopy && bsq.data === nd.data) bsq.data = bsq.data.slice();
  return { name, ...bsq };
}

async function load(id: string, axes?: Axes): Promise<HyperCube> {
  if (!source) throw new Error('No file is open.');
  let cube: HyperCube;
  switch (source.kind) {
    case 'envi':
      cube = parseEnvi(source.header, await source.dataFile.arrayBuffer(), sourceName);
      break;
    case 'tiff':
      cube = await parseGeoTiff(await source.file.arrayBuffer(), sourceName);
      break;
    case 'npy':
      cube = ndToCube(parseNpy(await source.file.arrayBuffer()), axes, sourceName, false);
      break;
    case 'mat': {
      const v = source.vars.find((m) => m.name === id);
      if (!v) throw new Error(`Variable ${id} not found.`);
      // Variable data shares the decompressed buffer we keep cached, so always copy before transfer.
      cube = ndToCube({ data: v.data, shape: v.dims, order: 'F' }, axes, `${sourceName} › ${v.name}`, true);
      const vectors = source.vars.filter((m) => m.dims.filter((d) => d !== 1).length === 1).map((m) => ({ name: m.name, values: m.data }));
      Object.assign(cube, findWavelengths(vectors, cube.bands));
      break;
    }
    case 'h5': {
      const { handle } = source;
      const info = handle.datasets.find((d) => d.path === id);
      if (!info) throw new Error(`Dataset ${id} not found.`);
      const data = handle.read(id);
      const nd: NdArray = source.matlab
        ? { data, shape: [...info.shape].reverse(), order: 'F' }
        : { data, shape: info.shape, order: 'C' };
      cube = ndToCube(nd, axes, `${sourceName} › ${id.replace(/^\//, '')}`, false);
      const vectors = [
        ...handle.datasets
          .filter((d) => d.shape.filter((n) => n !== 1).length === 1 && d.shape.reduce((a, b) => a * b, 1) === cube.bands)
          .map((d) => ({ name: d.path.split('/').pop()!, values: handle.read(d.path) })),
        ...handle.attrs(id),
      ];
      Object.assign(cube, findWavelengths(vectors, cube.bands));
      break;
    }
  }
  return Comlink.transfer(cube, [cube.data.buffer as ArrayBuffer]);
}

const api = { open, load };
export type LoaderApi = typeof api;
Comlink.expose(api);
