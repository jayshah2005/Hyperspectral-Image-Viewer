import { useStore } from '../store';
import { bandLabel } from '../lib/cube';

interface Props {
  label: string;
  value: number;
  onChange: (b: number) => void;
  accent?: string;
}

export function BandSlider({ label, value, onChange, accent }: Props) {
  const cube = useStore((s) => s.cube)!;
  const bad = cube.badBands?.[value];
  return (
    <label className="band-slider">
      <span className="band-slider-head">
        <span className="band-slider-name" style={accent ? { color: accent } : undefined}>
          {label}
        </span>
        <span className="band-slider-value">
          {bandLabel(cube, value)}
          {bad && <span className="tag warn">bad band</span>}
        </span>
      </span>
      <input
        type="range"
        min={0}
        max={cube.bands - 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={accent ? { accentColor: accent } : undefined}
      />
    </label>
  );
}
