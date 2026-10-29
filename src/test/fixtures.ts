import { zlibSync } from 'fflate';

/** A small H×W×B test cube with distinct values: v = y*100 + x*10 + b. */
export function cubeValue(y: number, x: number, b: number) {
  return y * 100 + x * 10 + b;
}

export const H = 6;
export const W = 7;
export const B = 5;

export function buildNpy(descr: string, shape: number[], fortran: boolean, body: Uint8Array, pad = 0): ArrayBuffer {
  let header = `{'descr': '${descr}', 'fortran_order': ${fortran ? 'True' : 'False'}, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  // Real files pad the header to a multiple of 64; `pad` lets tests force misalignment.
  const total = 10 + header.length + 1;
  header += ' '.repeat((pad || (64 - (total % 64)) % 64)) + '\n';
  const out = new Uint8Array(10 + header.length + body.length);
  out.set([0x93, ...'NUMPY'.split('').map((c) => c.charCodeAt(0)), 1, 0]);
  new DataView(out.buffer).setUint16(8, header.length, true);
  out.set(new TextEncoder().encode(header), 10);
  out.set(body, 10 + header.length);
  return out.buffer;
}

// ---- MAT v5 writer (just enough for tests) ----
function pad8(n: number) {
  return Math.ceil(n / 8) * 8;
}

function element(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + pad8(payload.length));
  const dv = new DataView(out.buffer);
  dv.setUint32(0, type, true);
  dv.setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** miMATRIX for a column-major double array stored as `storedType` (miDOUBLE=9, miUINT16=4). */
export function matMatrix(name: string, dims: number[], colMajor: number[], storedType = 9): Uint8Array {
  const flags = new Uint8Array(8);
  new DataView(flags.buffer).setUint32(0, 6, true); // mxDOUBLE_CLASS
  const dimBytes = new Uint8Array(dims.length * 4);
  dims.forEach((d, i) => new DataView(dimBytes.buffer).setInt32(i * 4, d, true));
  const data =
    storedType === 9 ? new Uint8Array(Float64Array.from(colMajor).buffer) : new Uint8Array(Uint16Array.from(colMajor).buffer);
  const body = concat([
    element(6, flags),
    element(5, dimBytes),
    element(1, new TextEncoder().encode(name)),
    element(storedType, data),
  ]);
  return element(14, body);
}

export function buildMat(matrices: Uint8Array[], compress: boolean): ArrayBuffer {
  const header = new Uint8Array(128).fill(32);
  header.set(new TextEncoder().encode('MATLAB 5.0 MAT-file, test'));
  header.set([0, 1, 'I'.charCodeAt(0), 'M'.charCodeAt(0)], 124);
  const els = matrices.map((m) => {
    if (!compress) return m;
    const z = zlibSync(m);
    const out = new Uint8Array(8 + z.length);
    new DataView(out.buffer).setUint32(0, 15, true);
    new DataView(out.buffer).setUint32(4, z.length, true);
    out.set(z, 8);
    return out;
  });
  return concat([header, ...els]).buffer;
}

/** Column-major values of the H×W×B test cube. */
export function colMajorCube(): number[] {
  const v: number[] = [];
  for (let b = 0; b < B; b++) for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) v.push(cubeValue(y, x, b));
  return v;
}
