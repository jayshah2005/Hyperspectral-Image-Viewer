import { unzipSync, strFromU8, zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Region } from './highlights';
import { decodeMaskPng, encodeMaskPng, maskMeta, masksZip, nameFromMaskFile, pngsInZip, singleMaskFilename } from './maskFile';

const W = 5;
const H = 3;
const region = (id: number, name: string): Region => ({ id, name, points: [{ x: 1, y: 1, label: 1 }], box: null, edited: true });
const labels = Uint16Array.from([0, 1, 1, 0, 0, 0, 1, 2, 2, 0, 0, 0, 0, 2, 0]);
const meta = maskMeta('capture 5', 'fp1', region(1, 'Leaf A'));

/** A PNG as other tools write it, built without our encoder. */
function png(colorType: number, depth: number, rows: number[][], extra: [string, number[]][] = [], interlace = 0): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type: string, data: number[] | Uint8Array) => {
    const body = [...type].map((c) => c.charCodeAt(0)).concat(Array.from(data));
    let c = 0xffffffff;
    for (const b of body) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    c = (c ^ 0xffffffff) >>> 0;
    const u32 = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    return [...u32(data.length), ...body, ...u32(c)];
  };
  const u32 = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const ihdr = [...u32(W), ...u32(H), depth, colorType, 0, 0, interlace];
  return Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', ihdr),
    ...extra.flatMap(([t, d]) => chunk(t, d)),
    ...chunk('IDAT', zlibSync(Uint8Array.from(rows.flat()))),
    ...chunk('IEND', []),
  ]);
}

const INSIDE = [1, 2, 6]; // the pixels of label 1
const ROWS = [0, 1, 2].map((y) => [0, 1, 2, 3, 4].map((x) => INSIDE.includes(y * W + x)));
const on = (decoded: { mask: Uint8Array }) => Array.from(decoded.mask.keys()).filter((i) => decoded.mask[i]);

describe('writing masks', () => {
  it('round-trips the exact pixels, name and clicks', () => {
    const d = decodeMaskPng(encodeMaskPng(labels, 1, W, H, meta), W, H);
    expect(on(d)).toEqual(INSIDE);
    expect(d.pixels).toBe(3);
    expect(d.meta).toEqual(meta);
  });

  it('writes one 8-bit gray channel holding only 0 and 255', () => {
    const bytes = encodeMaskPng(labels, 2, W, H, meta);
    expect(bytes[24]).toBe(8); // bit depth
    expect(bytes[25]).toBe(0); // colour type: grayscale
  });

  it('keeps names in any language, and survives a damaged or foreign metadata chunk', () => {
    const named = { ...meta, name: '叶 é "A"' };
    expect(decodeMaskPng(encodeMaskPng(labels, 1, W, H, named), W, H).meta?.name).toBe('叶 é "A"');
    const row = (v: boolean) => (v ? 255 : 0);
    const rows = ROWS.map((r) => [0, ...r.map(row)]);
    const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
    expect(decodeMaskPng(png(0, 8, rows, [['tEXt', text('hsiv-mask\0{broken')]]), W, H).meta).toBeNull();
    expect(decodeMaskPng(png(0, 8, rows, [['tEXt', text('Software\0numpy')]]), W, H).meta).toBeNull();
  });
});

describe('reading masks from other tools', () => {
  const gray8 = (hi: number) => ROWS.map((r) => [0, ...r.map((v) => (v ? hi : 0))]);

  it.each([
    ['gray 0/255', () => png(0, 8, gray8(255))],
    ['gray 0/1, as numpy often saves them', () => png(0, 8, gray8(1))],
    ['gray 16-bit', () => png(0, 16, ROWS.map((r) => [0, ...r.flatMap((v) => (v ? [255, 255] : [0, 0]))]))],
    ['gray 16-bit 0/1', () => png(0, 16, ROWS.map((r) => [0, ...r.flatMap((v) => (v ? [0, 1] : [0, 0]))]))],
    ['gray 1-bit', () => png(0, 1, ROWS.map((r) => [0, r.reduce((b, v, i) => b | (v ? 128 >> i : 0), 0)]))],
    ['RGB', () => png(2, 8, ROWS.map((r) => [0, ...r.flatMap((v) => (v ? [255, 255, 255] : [0, 0, 0]))]))],
    ['RGBA opaque', () => png(6, 8, ROWS.map((r) => [0, ...r.flatMap((v) => (v ? [255, 255, 255, 255] : [0, 0, 0, 255]))]))],
    ['white on transparent', () => png(6, 8, ROWS.map((r) => [0, ...r.flatMap((v) => (v ? [255, 255, 255, 255] : [255, 255, 255, 0]))]))],
    ['gray + alpha', () => png(4, 8, ROWS.map((r) => [0, ...r.flatMap((v) => (v ? [255, 255] : [0, 255]))]))],
    ['palette', () => png(3, 8, ROWS.map((r) => [0, ...r.map((v) => (v ? 1 : 0))]), [['PLTE', [0, 0, 0, 255, 255, 255]]])],
  ])('%s', (_label, make) => {
    const d = decodeMaskPng(make(), W, H);
    expect(on(d)).toEqual(INSIDE);
    expect(d.meta).toBeNull();
  });

  it('undoes every PNG row filter', () => {
    // The same 0/255 picture, written with filters 1 (sub), 2 (up) and 4 (Paeth).
    const v = ROWS.map((r) => r.map((x) => (x ? 255 : 0)));
    const sub = [1, ...v[0].map((x, i) => (x - (v[0][i - 1] ?? 0)) & 255)];
    const up = [2, ...v[1].map((x, i) => (x - v[0][i]) & 255)];
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    const last = [4, ...v[2].map((x, i) => (x - paeth(v[2][i - 1] ?? 0, v[1][i], v[1][i - 1] ?? 0)) & 255)];
    expect(on(decodeMaskPng(png(0, 8, [sub, up, last]), W, H))).toEqual(INSIDE);
  });

  it('treats a soft edge as inside only past half scale', () => {
    const rows = [[0, 0, 100, 200, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
    expect(on(decodeMaskPng(png(0, 8, rows), W, H))).toEqual([2]);
  });

  it('rejects what it cannot place, with a reason', () => {
    const rows = gray8(255);
    expect(() => decodeMaskPng(png(0, 8, rows), W + 1, H)).toThrow(/5 × 3.*6 × 3.*cropped/);
    expect(() => decodeMaskPng(png(0, 8, rows), H, W)).toThrow(/rotated/);
    expect(() => decodeMaskPng(Uint8Array.from([1, 2, 3]), W, H)).toThrow(/not a PNG/);
    expect(() => decodeMaskPng(png(0, 8, rows, [], 1), W, H)).toThrow(/interlaced/);
    const good = png(0, 8, rows);
    expect(() => decodeMaskPng(good.subarray(0, 40), W, H)).toThrow(/cut short|damaged/);
  });
});

describe('file names and the zip', () => {
  it('names a highlight after a mask file', () => {
    expect(nameFromMaskFile('Leaf_A_mask.png', 'x')).toBe('Leaf_A');
    expect(nameFromMaskFile('out/run1/Leaf_A_mask.PNG', 'x')).toBe('Leaf_A');
    expect(nameFromMaskFile('capture-5_Leaf_A_mask.png', 'capture 5')).toBe('Leaf_A');
    expect(nameFromMaskFile('anything.png', 'x')).toBe('anything');
  });

  it('includes the image in a single download, with a fallback for an unusable name', () => {
    expect(singleMaskFilename('capture 5', region(1, 'Leaf A'))).toBe('capture-5_Leaf-A_mask.png');
    expect(singleMaskFilename('capture 5', region(7, '叶'))).toBe('capture-5_object_007_mask.png');
  });

  it('zips one mask per highlight plus a table, with clashing names kept apart', () => {
    const cube = { name: 'capture 5', width: W, height: H };
    const regions = [region(1, 'Leaf'), region(2, 'Leaf')];
    const files = unzipSync(masksZip(cube, 'fp1', labels, regions));
    expect(Object.keys(files).sort()).toEqual(['Leaf_2_mask.png', 'Leaf_mask.png', 'objects.csv']);
    expect(on(decodeMaskPng(files['Leaf_mask.png'], W, H))).toEqual(INSIDE);
    expect(strFromU8(files['objects.csv']).split('\n').slice(0, 3)).toEqual([
      'id,name,file,x0,y0,x1,y1,area_px,centroid_x,centroid_y',
      '1,Leaf,Leaf_mask.png,1,0,3,2,3,1.3,0.3',
      '2,Leaf,Leaf_2_mask.png,2,1,4,3,3,2.7,1.3',
    ]);
  });

  it('reads the PNGs back from a zip, ignoring everything else', () => {
    const zip = masksZip({ name: 'c', width: W, height: H }, 'fp', labels, [region(1, 'Leaf')]);
    expect(pngsInZip(zip).map((f) => f.name)).toEqual(['Leaf_mask.png']);
  });
});
