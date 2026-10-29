export type CubeArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array;

export type DType =
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'
  | 'float32'
  | 'float64';

/** A hyperspectral cube stored band-sequential: data[b*H*W + y*W + x]. */
export interface HyperCube {
  name: string;
  width: number;
  height: number;
  bands: number;
  data: CubeArray;
  wavelengths?: number[];
  wavelengthUnits?: string;
  bandNames?: string[];
  /** true = band is bad and should be ignored (ENVI `bbl` = 0). */
  badBands?: boolean[];
  noDataValue?: number;
  /** 0-based band indices suggested for an RGB composite (ENVI `default bands`). */
  defaultBands?: [number, number, number];
}

/** Which logical array dimension maps to image rows, image columns and spectral bands. */
export interface Axes {
  y: number;
  x: number;
  b: number;
}

/** An N-d array; `order` says whether `shape` is laid out row-major (C) or column-major (F). */
export interface NdArray {
  data: CubeArray;
  shape: number[];
  order: 'C' | 'F';
}

/** Something inside an opened file that can become a cube. */
export interface Candidate {
  id: string;
  label: string;
  shape: number[];
  dtype: string;
  /** Suggested axis mapping; null when the format defines the layout itself (ENVI, GeoTIFF). */
  defaultAxes: Axes | null;
}

export interface OpenResult {
  sourceName: string;
  candidates: Candidate[];
}
