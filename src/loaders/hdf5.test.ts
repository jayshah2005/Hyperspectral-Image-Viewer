import { describe, expect, it } from 'vitest';
import h5wasm from 'h5wasm';
import { openH5 } from './hdf5';
import { cubeValue, H, W, B } from '../test/fixtures';
import { guessAxes, toBSQ } from './arrayToCube';
import { getSpectrum } from '../lib/cube';

describe('HDF5', () => {
  it('lists numeric datasets and reads a cube', async () => {
    const { FS } = await h5wasm.ready;
    const path = '/fixture.h5'; // emscripten in-memory FS
    const values: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let b = 0; b < B; b++) values.push(cubeValue(y, x, b));
    const f = new h5wasm.File(path, 'w');
    const g = f.create_group('data');
    g.create_dataset({ name: 'reflectance', data: Float32Array.from(values), shape: [H, W, B] });
    g.create_dataset({ name: 'wavelength', data: Float64Array.from([400, 500, 600, 700, 800]) });
    f.close();
    const bytes = FS.readFile(path) as Uint8Array;
    FS.unlink(path);

    const handle = await openH5(bytes.slice().buffer);
    expect(handle.datasets.map((d) => d.path).sort()).toEqual(['/data/reflectance', '/data/wavelength']);
    const data = handle.read('/data/reflectance');
    const cube = { name: 't', ...toBSQ({ data, shape: [H, W, B], order: 'C' }, guessAxes([H, W, B])) };
    expect(Array.from(getSpectrum(cube, 3, 2))).toEqual([0, 1, 2, 3, 4].map((b) => cubeValue(2, 3, b)));
    handle.close();
  });
});
