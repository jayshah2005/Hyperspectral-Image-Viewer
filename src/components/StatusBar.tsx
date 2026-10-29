import { useStore } from '../store';
import { describeCube } from '../lib/cube';

const fmt = (v: number) =>
  !Number.isFinite(v) ? 'n/a' : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : +v.toPrecision(5) + '';

export function StatusBar() {
  const cube = useStore((s) => s.cube);
  const hover = useStore((s) => s.hover);
  const mode = useStore((s) => s.mode);
  const band = useStore((s) => s.band);
  const rgb = useStore((s) => s.rgb);
  const derived = useStore((s) => s.derived);
  const showDerived = useStore((s) => s.showDerived);
  if (!cube) return null;

  const at = (b: number) => cube.data[b * cube.width * cube.height + hover!.y * cube.width + hover!.x];
  let value = '';
  if (hover) {
    if (showDerived && derived) value = `${derived.name}: ${fmt(derived.data[hover.y * cube.width + hover.x])}${derived.unit ? ` ${derived.unit}` : ''}`;
    else if (mode === 'single') value = `band ${band + 1}: ${fmt(at(band))}`;
    else value = `R ${fmt(at(rgb[0]))}  G ${fmt(at(rgb[1]))}  B ${fmt(at(rgb[2]))}`;
  }

  return (
    <footer className="statusbar">
      <span>{describeCube(cube)}</span>
      {cube.wavelengths && (
        <span>
          {+Math.min(...cube.wavelengths).toFixed(2)}–{+Math.max(...cube.wavelengths).toFixed(2)} {cube.wavelengthUnits}
        </span>
      )}
      {cube.badBands && <span>{cube.badBands.filter(Boolean).length} bad bands</span>}
      <span className="spacer" />
      {hover ? (
        <span className="mono">
          x {hover.x}, y {hover.y} · {value}
        </span>
      ) : (
        <span className="muted">Hover the image to inspect pixels</span>
      )}
    </footer>
  );
}
