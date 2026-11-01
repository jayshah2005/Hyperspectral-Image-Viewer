import { strFromU8, strToU8, unzipSync, unzlibSync, zipSync, zlibSync } from 'fflate';
import { csvField, safeFilename, uniqueNames } from './csv';
import type { Box, Region, RegionPrompt } from './highlights';
import { labelBounds } from './mask';

/**
 * Mask files: full-image, single-channel 8-bit PNGs, 0 outside and 255 inside, the same values as the
 * Segmentation app's `_mask.png`. They load as a plain H×W array, so `cube[mask > 0]` just works.
 *
 * A canvas can't write these: `toBlob` always produces RGBA, which loads as H×W×4. So PNG is handled here,
 * which also keeps the pixels exact (no colour management, no browser fingerprinting noise).
 */

/** Written into each mask, so it can come back as the same highlight. Other programs ignore it. */
export interface MaskMeta {
  fingerprint: string;
  image: string;
  name: string;
  points: RegionPrompt[];
  box: Box | null;
  edited: boolean;
}

export interface DecodedMask {
  /** 1 inside, 0 outside. */
  mask: Uint8Array;
  pixels: number;
  /** Null for a mask made by something else, or re-saved by a tool that dropped it. */
  meta: MaskMeta | null;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const META_KEY = 'hsiv-mask';

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The mask of one region, as PNG bytes. */
export function encodeMaskPng(labels: Uint16Array, id: number, width: number, height: number, meta: MaskMeta): Uint8Array {
  const raw = new Uint8Array((width + 1) * height); // each row starts with filter byte 0
  for (let y = 0, o = 0, p = 0; y < height; y++) {
    o++;
    for (let x = 0; x < width; x++, o++, p++) if (labels[p] === id) raw[o] = 255;
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bits per sample
  // Colour type 0 (grayscale); compression, filter and interlace methods all 0.

  // tEXt is Latin-1, so names in any language are kept as \u escapes in the JSON.
  const json = JSON.stringify(meta).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return concat([
    Uint8Array.from(SIGNATURE),
    pngChunk('IHDR', header),
    pngChunk('tEXt', strToU8(`${META_KEY}\0${json}`)),
    pngChunk('IDAT', zlibSync(raw, { level: 6 })),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

function parseMeta(text: string, width: number, height: number): MaskMeta | null {
  try {
    const m = JSON.parse(text);
    const inside = (x: unknown, y: unknown) => typeof x === 'number' && typeof y === 'number' && x >= 0 && y >= 0 && x <= width && y <= height;
    const points: RegionPrompt[] = Array.isArray(m.points) ? m.points : [];
    const box = Array.isArray(m.box) && m.box.length === 4 && inside(m.box[0], m.box[1]) && inside(m.box[2], m.box[3]) ? (m.box as Box) : null;
    if (typeof m.name !== 'string' || !points.every((q) => inside(q?.x, q?.y) && (q.label === 0 || q.label === 1))) return null;
    return { fingerprint: String(m.fingerprint ?? ''), image: String(m.image ?? ''), name: m.name, points, box, edited: Boolean(m.edited) };
  } catch {
    return null;
  }
}

/** Undo the PNG row filters, in place. Each scanline in `raw` is a filter byte followed by `rowBytes`. */
function unfilter(raw: Uint8Array, rowBytes: number, height: number, bytesPerPixel: number): void {
  const stride = rowBytes + 1;
  for (let y = 0; y < height; y++) {
    const row = y * stride + 1;
    const up = row - stride;
    const filter = raw[row - 1];
    if (filter === 0) continue;
    if (filter > 4) throw new Error('the file is damaged');
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bytesPerPixel ? raw[row + i - bytesPerPixel] : 0;
      const b = y ? raw[up + i] : 0;
      const c = y && i >= bytesPerPixel ? raw[up + i - bytesPerPixel] : 0;
      let add: number;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[row + i] = (raw[row + i] + add) & 255;
    }
  }
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Read a mask of any PNG flavour that numpy, OpenCV, PIL or ImageJ write: gray, RGB, palette, with alpha,
 * 1 to 16 bits. Inside means brighter than half scale, or simply nonzero if nothing is that bright (0/1 masks).
 * Fully transparent is always outside. The size is checked before anything is decompressed.
 */
export function decodeMaskPng(bytes: Uint8Array, width: number, height: number): DecodedMask {
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) throw new Error('not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let depth = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;
  let meta: MaskMeta | null = null;
  const idat: Uint8Array[] = [];

  for (let o = 8; o + 12 <= bytes.length; ) {
    const length = view.getUint32(o);
    const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
    const data = bytes.subarray(o + 8, o + 8 + length);
    if (data.length < length) throw new Error('the file is cut short');
    if (type === 'IHDR') {
      const w = view.getUint32(o + 8);
      const h = view.getUint32(o + 12);
      if (w !== width || h !== height) {
        const hint = w === height && h === width ? ' It looks rotated.' : ' Masks must cover the whole image, so a cropped mask can\'t be placed.';
        throw new Error(`it is ${w} × ${h}, but this image is ${width} × ${height}.${hint}`);
      }
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported; save it without interlacing');
      if (!(colorType in CHANNELS)) throw new Error('the file is damaged');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') paletteAlpha = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'tEXt' && !meta) {
      const nul = data.indexOf(0);
      if (nul > 0 && strFromU8(data.subarray(0, nul), true) === META_KEY) meta = parseMeta(strFromU8(data.subarray(nul + 1), true), width, height);
    } else if (type === 'IEND') break;
    o += 12 + length;
  }
  if (!depth || !idat.length) throw new Error('the file is damaged');

  const channels = CHANNELS[colorType];
  const bitsPerPixel = channels * depth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  let raw: Uint8Array;
  try {
    raw = unzlibSync(concat(idat));
  } catch {
    throw new Error('the file is damaged');
  }
  if (raw.length < (rowBytes + 1) * height) throw new Error('the file is cut short');
  unfilter(raw, rowBytes, height, Math.max(1, bitsPerPixel >> 3));

  const sample = (row: number, index: number) => {
    if (depth === 8) return raw[row + index];
    if (depth === 16) return (raw[row + 2 * index] << 8) | raw[row + 2 * index + 1];
    const bit = index * depth;
    return (raw[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };

  const values = new Uint16Array(width * height);
  let brightest = 0;
  for (let y = 0, p = 0; y < height; y++) {
    const row = y * (rowBytes + 1) + 1;
    for (let x = 0; x < width; x++, p++) {
      let v: number;
      if (colorType === 3) {
        const i = sample(row, x);
        const pal = palette;
        v = pal ? Math.max(pal[3 * i] ?? 0, pal[3 * i + 1] ?? 0, pal[3 * i + 2] ?? 0) : 0;
        if (paletteAlpha && paletteAlpha[i] === 0) v = 0;
      } else if (colorType === 0) v = sample(row, x);
      else if (colorType === 4) v = sample(row, 2 * x + 1) ? sample(row, 2 * x) : 0;
      else {
        const c = x * channels;
        v = Math.max(sample(row, c), sample(row, c + 1), sample(row, c + 2));
        if (colorType === 6 && !sample(row, c + 3)) v = 0;
      }
      values[p] = v;
      if (v > brightest) brightest = v;
    }
  }

  const full = colorType === 3 ? 255 : (1 << depth) - 1;
  const cut = brightest > full / 2 ? full / 2 : 0;
  const mask = new Uint8Array(values.length);
  let pixels = 0;
  for (let p = 0; p < values.length; p++) {
    if (values[p] > cut) {
      mask[p] = 1;
      pixels++;
    }
  }
  return { mask, pixels, meta };
}

/** A highlight's name for a mask that doesn't carry one: `Leaf_A_mask.png` → `Leaf_A`. */
export function nameFromMaskFile(fileName: string, imageName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const stem = base.replace(/\.png$/i, '').replace(/_mask$/i, '');
  const prefix = `${safeFilename(imageName)}_`;
  return stem.startsWith(prefix) ? stem.slice(prefix.length) : stem;
}

export const maskMeta = (image: string, fingerprint: string, r: Region): MaskMeta => ({
  fingerprint,
  image,
  name: r.name,
  points: r.points,
  box: r.box,
  edited: r.edited,
});

/** File stems for these regions, safe and distinct. */
function maskStems(regions: Region[]): string[] {
  return uniqueNames(regions.map((r) => safeFilename(r.name, `object_${String(r.id).padStart(3, '0')}`)));
}

export function singleMaskFilename(imageName: string, r: Region): string {
  return `${safeFilename(imageName)}_${maskStems([r])[0]}_mask.png`;
}

/** All masks in one file, because browsers block a burst of separate downloads. Laid out like a Segmentation results folder. */
export function masksZip(
  cube: { name: string; width: number; height: number },
  fingerprint: string,
  labels: Uint16Array,
  regions: Region[],
): Uint8Array {
  const rows = ['id,name,file,x0,y0,x1,y1,area_px,centroid_x,centroid_y'];
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  maskStems(regions).forEach((stem, i) => {
    const r = regions[i];
    const file = `${stem}_mask.png`;
    files[file] = [encodeMaskPng(labels, r.id, cube.width, cube.height, maskMeta(cube.name, fingerprint, r)), { level: 0 }];
    const b = labelBounds(labels, r.id, cube.width);
    if (b) rows.push([r.id, csvField(r.name), csvField(file), b.x0, b.y0, b.x1, b.y1, b.count, b.cx.toFixed(1), b.cy.toFixed(1)].join(','));
  });
  files['objects.csv'] = [strToU8(`${rows.join('\n')}\n`), { level: 6 }];
  return zipSync(files);
}

/** The PNGs inside a zip, leaving out what macOS adds. */
export function pngsInZip(bytes: Uint8Array): { name: string; bytes: Uint8Array }[] {
  const entries = unzipSync(bytes, {
    filter: (f) => /\.png$/i.test(f.name) && !f.name.includes('__MACOSX/') && !/(^|\/)\._/.test(f.name),
  });
  return Object.entries(entries).map(([name, data]) => ({ name, bytes: data }));
}
