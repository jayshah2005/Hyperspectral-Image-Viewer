/** Golden-angle hue steps keep neighbouring regions visually distinct, as in the Segmentation app. */
export function regionColor(index: number): [number, number, number] {
  const h = (48 + index * 137.5) % 360;
  const s = 0.85;
  const l = 0.6;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export const regionCss = (index: number) => `rgb(${regionColor(index).join(',')})`;
