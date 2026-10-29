import { describe, expect, it } from 'vitest';
import { buildMat, colMajorCube, cubeValue, matMatrix, H, W, B } from '../test/fixtures';
import { isMat73, parseMatV5 } from './mat';
import { guessAxes, toBSQ } from './arrayToCube';
import { getSpectrum } from '../lib/cube';

function checkCube(buf: ArrayBuffer) {
  const vars = parseMatV5(buf);
  const v = vars.find((m) => m.name === 'cube')!;
  expect(v.dims).toEqual([H, W, B]);
  const cube = { name: 't', ...toBSQ({ data: v.data, shape: v.dims, order: 'F' }, guessAxes(v.dims)) };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) expect(Array.from(getSpectrum(cube, x, y))).toEqual([0, 1, 2, 3, 4].map((b) => cubeValue(y, x, b)));
  return vars;
}

describe('MAT v5', () => {
  it('reads an uncompressed double array', () => {
    const buf = buildMat([matMatrix('cube', [H, W, B], colMajorCube())], false);
    expect(isMat73(buf)).toBe(false);
    checkCube(buf);
  });

  it('reads compressed variables and keeps narrower stored types', () => {
    const buf = buildMat(
      [matMatrix('wavelength', [1, B], [400, 500, 600, 700, 800]), matMatrix('cube', [H, W, B], colMajorCube(), 4)],
      true,
    );
    const vars = checkCube(buf);
    expect(vars.find((m) => m.name === 'cube')!.data).toBeInstanceOf(Uint16Array);
    expect(Array.from(vars.find((m) => m.name === 'wavelength')!.data)).toEqual([400, 500, 600, 700, 800]);
  });
});
