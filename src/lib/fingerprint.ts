import type { HyperCube } from '../types';

/** 53-bit string-free hash (cyrb53) over raw bytes. */
function hashBytes(bytes: Uint8Array, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Identifies an image by its contents, not its file name: `CODE/Data` alone has 20 different files named `5.hdr`.
 * Whole bands are hashed rather than scattered pixels, because leaf cut-outs are mostly a zero background and a
 * sparse sample could land only on zeros and match a different leaf of the same size.
 */
export function cubeFingerprint(cube: Pick<HyperCube, 'width' | 'height' | 'bands' | 'data'>): string {
  const { width, height, bands, data } = cube;
  const pixels = width * height;
  const picks = new Set([0, Math.floor(bands / 3), Math.floor(bands / 2), Math.floor((2 * bands) / 3), bands - 1]);
  let hash = '';
  let seed = 0;
  for (const b of picks) {
    const plane = data.subarray(b * pixels, (b + 1) * pixels);
    hash = hashBytes(new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength), seed++ ^ parseInt(hash.slice(0, 8) || '0', 16));
  }
  return `${width}x${height}x${bands}-${data.constructor.name}-${hash}`;
}
