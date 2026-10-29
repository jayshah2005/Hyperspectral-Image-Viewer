import type { CubeArray, DType } from '../types';

type Ctor = { new (buffer: ArrayBufferLike, byteOffset: number, length: number): CubeArray; new (length: number): CubeArray };

const CTORS: Record<Exclude<DType, 'int64' | 'uint64'>, Ctor> = {
  int8: Int8Array,
  uint8: Uint8Array,
  int16: Int16Array,
  uint16: Uint16Array,
  int32: Int32Array,
  uint32: Uint32Array,
  float32: Float32Array,
  float64: Float64Array,
};

export const DTYPE_SIZE: Record<DType, number> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  int64: 8,
  uint64: 8,
  float32: 4,
  float64: 8,
};

const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function allocate(dtype: DType, length: number): CubeArray {
  if (dtype === 'int64' || dtype === 'uint64') return new Float64Array(length);
  return new CTORS[dtype](length);
}

/** Same element type as `like`, new storage. */
export function allocateLike(like: CubeArray, length: number): CubeArray {
  return new (like.constructor as Ctor)(length);
}

/**
 * Interpret `count` elements of `dtype` starting at `byteOffset`.
 * Returns a zero-copy view when alignment and endianness allow, otherwise a converted copy.
 * 64-bit integers are converted to Float64Array (no BigInt arrays downstream).
 */
export function readTyped(
  buffer: ArrayBufferLike,
  byteOffset: number,
  count: number,
  dtype: DType,
  littleEndian: boolean,
  forceCopy = false,
): CubeArray {
  const size = DTYPE_SIZE[dtype];
  if (byteOffset + count * size > buffer.byteLength) {
    throw new Error(
      `File is too small: expected ${count * size} bytes of ${dtype} data at offset ${byteOffset}, found ${buffer.byteLength - byteOffset}.`,
    );
  }

  if (dtype === 'int64' || dtype === 'uint64') {
    const out = new Float64Array(count);
    const dv = new DataView(buffer, byteOffset, count * 8);
    for (let i = 0; i < count; i++) {
      out[i] = Number(dtype === 'int64' ? dv.getBigInt64(i * 8, littleEndian) : dv.getBigUint64(i * 8, littleEndian));
    }
    return out;
  }

  const C = CTORS[dtype];
  const sameEndian = size === 1 || littleEndian === HOST_LITTLE_ENDIAN;
  if (sameEndian && byteOffset % size === 0 && !forceCopy) return new C(buffer, byteOffset, count);

  // Misaligned and/or byte-swapped: copy bytes into fresh storage, swapping if needed.
  const out = new C(count);
  const src = new Uint8Array(buffer, byteOffset, count * size);
  const dst = new Uint8Array(out.buffer);
  if (sameEndian) {
    dst.set(src);
  } else {
    for (let i = 0; i < count * size; i += size) {
      for (let k = 0; k < size; k++) dst[i + k] = src[i + size - 1 - k];
    }
  }
  return out;
}

export function dtypeOf(arr: CubeArray): DType {
  if (arr instanceof Float32Array) return 'float32';
  if (arr instanceof Float64Array) return 'float64';
  if (arr instanceof Int8Array) return 'int8';
  if (arr instanceof Uint8Array) return 'uint8';
  if (arr instanceof Int16Array) return 'int16';
  if (arr instanceof Uint16Array) return 'uint16';
  if (arr instanceof Int32Array) return 'int32';
  return 'uint32';
}

/** Convert a typed array of any supported kind (including BigInt arrays) to a CubeArray. */
export function toCubeArray(arr: ArrayLike<number> | BigInt64Array | BigUint64Array): CubeArray {
  if (arr instanceof BigInt64Array || arr instanceof BigUint64Array) {
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = Number(arr[i]);
    return out;
  }
  if (
    arr instanceof Float32Array ||
    arr instanceof Float64Array ||
    arr instanceof Int8Array ||
    arr instanceof Uint8Array ||
    arr instanceof Int16Array ||
    arr instanceof Uint16Array ||
    arr instanceof Int32Array ||
    arr instanceof Uint32Array
  ) {
    return arr;
  }
  return Float64Array.from(arr as ArrayLike<number>);
}
