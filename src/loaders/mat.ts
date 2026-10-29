import { unzlibSync } from 'fflate';
import { DTYPE_SIZE, readTyped } from '../lib/dtypes';
import type { CubeArray, DType } from '../types';

/** A numeric MATLAB variable. `data` is column-major (Fortran order) over `dims`. */
export interface MatVariable {
  name: string;
  dims: number[];
  dtype: DType;
  data: CubeArray;
}

const MI_TYPES: Record<number, DType> = {
  1: 'int8',
  2: 'uint8',
  3: 'int16',
  4: 'uint16',
  5: 'int32',
  6: 'uint32',
  7: 'float32',
  9: 'float64',
  12: 'int64',
  13: 'uint64',
};
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;
// mxDOUBLE_CLASS .. mxUINT64_CLASS
const NUMERIC_CLASSES = new Set([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

export function isMat73(buf: ArrayBuffer): boolean {
  const text = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(128, buf.byteLength)));
  return /MATLAB 7\.3 MAT-file/.test(text);
}

interface Tag {
  type: number;
  nbytes: number;
  dataOffset: number;
  next: number;
}

function readTag(dv: DataView, o: number, le: boolean): Tag {
  const w0 = dv.getUint32(o, le);
  if (w0 >>> 16 !== 0) {
    // Small data element: type and size share the first word, data fits in the second.
    return { type: w0 & 0xffff, nbytes: w0 >>> 16, dataOffset: o + 4, next: o + 8 };
  }
  const nbytes = dv.getUint32(o + 4, le);
  return { type: w0, nbytes, dataOffset: o + 8, next: o + 8 + Math.ceil(nbytes / 8) * 8 };
}

function parseMatrix(dv: DataView, start: number, end: number, le: boolean): MatVariable | null {
  const flagsTag = readTag(dv, start, le);
  const flags = dv.getUint32(flagsTag.dataOffset, le);
  const mxClass = flags & 0xff;

  const dimsTag = readTag(dv, flagsTag.next, le);
  const dims: number[] = [];
  for (let i = 0; i < dimsTag.nbytes / 4; i++) dims.push(dv.getInt32(dimsTag.dataOffset + i * 4, le));

  const nameTag = readTag(dv, dimsTag.next, le);
  const name = new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset + nameTag.dataOffset, nameTag.nbytes));

  if (!NUMERIC_CLASSES.has(mxClass) || nameTag.next >= end) return null;

  // Real part (imaginary part, if any, is ignored). Values may be stored in a narrower type than
  // the MATLAB class (e.g. a double array saved as uint16); we keep the stored type.
  const realTag = readTag(dv, nameTag.next, le);
  const dtype = MI_TYPES[realTag.type];
  if (!dtype) return null;
  const count = realTag.nbytes / DTYPE_SIZE[dtype];
  const data = readTyped(dv.buffer, dv.byteOffset + realTag.dataOffset, count, dtype, le);
  return { name, dims, dtype, data };
}

/** Parse a MATLAB v5–v7.2 .mat file and return its numeric variables. */
export function parseMatV5(buf: ArrayBuffer): MatVariable[] {
  if (buf.byteLength < 128) throw new Error('File too small to be a .mat file.');
  const endian = String.fromCharCode(...new Uint8Array(buf, 126, 2));
  if (endian !== 'IM' && endian !== 'MI') throw new Error('Not a MATLAB v5 .mat file.');
  const le = endian === 'IM';

  const vars: MatVariable[] = [];
  const parseElements = (dv: DataView) => {
    let o = 0;
    while (o + 8 <= dv.byteLength) {
      const tag = readTag(dv, o, le);
      if (tag.type === MI_COMPRESSED) {
        const inflated = unzlibSync(new Uint8Array(dv.buffer, dv.byteOffset + tag.dataOffset, tag.nbytes));
        parseElements(new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength));
        o = tag.dataOffset + tag.nbytes; // compressed elements are not padded
        continue;
      }
      if (tag.type === MI_MATRIX && tag.nbytes > 0) {
        const v = parseMatrix(dv, tag.dataOffset, tag.dataOffset + tag.nbytes, le);
        if (v) vars.push(v);
      }
      o = tag.next;
    }
  };
  parseElements(new DataView(buf, 128));
  return vars;
}
