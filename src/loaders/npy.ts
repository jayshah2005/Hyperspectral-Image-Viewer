import { readTyped } from '../lib/dtypes';
import type { DType, NdArray } from '../types';

export interface NpyHeader {
  shape: number[];
  dtype: DType;
  littleEndian: boolean;
  fortranOrder: boolean;
  dataOffset: number;
}

const NPY_TYPES: Record<string, DType> = {
  b1: 'uint8',
  i1: 'int8',
  u1: 'uint8',
  i2: 'int16',
  u2: 'uint16',
  i4: 'int32',
  u4: 'uint32',
  i8: 'int64',
  u8: 'uint64',
  f4: 'float32',
  f8: 'float64',
};

export function readNpyHeader(buf: ArrayBuffer): NpyHeader {
  const bytes = new Uint8Array(buf);
  const magic = String.fromCharCode(...bytes.subarray(1, 6));
  if (bytes[0] !== 0x93 || magic !== 'NUMPY') throw new Error('Not a .npy file (bad magic).');
  const major = bytes[6];
  const dv = new DataView(buf);
  const headerLen = major === 1 ? dv.getUint16(8, true) : dv.getUint32(8, true);
  const start = major === 1 ? 10 : 12;
  const header = new TextDecoder(major >= 3 ? 'utf-8' : 'latin1').decode(bytes.subarray(start, start + headerLen));

  const descr = /'descr'\s*:\s*'([^']+)'/.exec(header)?.[1];
  const fortran = /'fortran_order'\s*:\s*(True|False)/.exec(header)?.[1];
  const shapeStr = /'shape'\s*:\s*\(([^)]*)\)/.exec(header)?.[1];
  if (!descr || !fortran || shapeStr === undefined) throw new Error(`Could not parse .npy header: ${header}`);

  const endian = descr[0];
  const dtype = NPY_TYPES[descr.slice(1)];
  if (!dtype) throw new Error(`Unsupported .npy dtype '${descr}'.`);
  const shape = shapeStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);

  return {
    shape,
    dtype,
    littleEndian: endian !== '>',
    fortranOrder: fortran === 'True',
    dataOffset: start + headerLen,
  };
}

export function parseNpy(buf: ArrayBuffer): NdArray {
  const h = readNpyHeader(buf);
  const count = h.shape.reduce((a, b) => a * b, 1);
  return {
    data: readTyped(buf, h.dataOffset, count, h.dtype, h.littleEndian),
    shape: h.shape,
    order: h.fortranOrder ? 'F' : 'C',
  };
}
