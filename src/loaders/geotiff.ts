import { fromArrayBuffer } from 'geotiff';
import { allocateLike, toCubeArray } from '../lib/dtypes';
import type { CubeArray, HyperCube } from '../types';

type Image = Awaited<ReturnType<Awaited<ReturnType<typeof fromArrayBuffer>>['getImage']>>;

/** Pull per-band wavelengths out of GDAL metadata items like "wavelength" or "WAVELENGTH". */
function readWavelengths(image: Image, bands: number): { values?: number[]; units?: string } {
  const values: number[] = [];
  let units: string | undefined;
  for (let b = 0; b < bands; b++) {
    let md: Record<string, string> | null = null;
    try {
      md = image.getGDALMetadata(b);
    } catch {
      return {};
    }
    if (!md) return {};
    const key = Object.keys(md).find((k) => /^(wavelength|center_?wavelength)$/i.test(k));
    const unitKey = Object.keys(md).find((k) => /^wavelength_?units$/i.test(k));
    if (unitKey) units = md[unitKey];
    const v = key ? parseFloat(md[key]) : NaN;
    if (!Number.isFinite(v)) return {};
    values.push(v);
  }
  return { values, units };
}

export async function parseGeoTiff(buf: ArrayBuffer, name: string): Promise<HyperCube> {
  const tiff = await fromArrayBuffer(buf);
  const first = await tiff.getImage(0);
  const width = first.getWidth();
  const height = first.getHeight();
  const pixels = width * height;

  let bandArrays: CubeArray[];
  let wl: { values?: number[]; units?: string } = {};
  if (first.getSamplesPerPixel() > 1) {
    const rasters = await first.readRasters({ interleave: false });
    bandArrays = (rasters as unknown as ArrayLike<number>[]).map((r) => toCubeArray(r));
    wl = readWavelengths(first, bandArrays.length);
  } else {
    // One band per page (multi-page TIFF stack), keeping only full-size pages.
    bandArrays = [];
    const count = await tiff.getImageCount();
    for (let i = 0; i < count; i++) {
      const img = i === 0 ? first : await tiff.getImage(i);
      if (img.getWidth() !== width || img.getHeight() !== height) continue;
      const [r] = (await img.readRasters({ interleave: false })) as unknown as ArrayLike<number>[];
      bandArrays.push(toCubeArray(r));
    }
  }

  const bands = bandArrays.length;
  const data = allocateLike(bandArrays[0], pixels * bands);
  bandArrays.forEach((arr, b) => data.set(arr, b * pixels));
  const noData = first.getGDALNoData();

  return {
    name,
    width,
    height,
    bands,
    data,
    wavelengths: wl.values?.length === bands ? wl.values : undefined,
    wavelengthUnits: wl.units,
    noDataValue: noData ?? undefined,
  };
}
