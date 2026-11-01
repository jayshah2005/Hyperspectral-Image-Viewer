import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useStore } from '../store';
import { regionCss } from '../lib/colors';
import { getSpectrum, spectralAxis } from '../lib/cube';
import { pixelCsv, safeFilename } from '../lib/csv';
import { downloadBlob } from '../lib/download';
import { useRegionStats } from './useRegionStats';

const INK = '#a6adbb';
const GRID = 'rgba(255,255,255,0.07)';
const LINE = '#3987e5';
const PIXEL_ON_MEANS = '#e8eaed';

/** NaN (bad band / no-data) becomes null so uPlot leaves a gap. */
const toSeries = (a: ArrayLike<number> | null, n: number): (number | null)[] =>
  Array.from({ length: n }, (_, i) => (a && Number.isFinite(a[i]) ? a[i] : null));

/** Mean spectrum of every highlight, in its colour, plus the selected or hovered pixel. */
export function SpectrumPlot() {
  const cube = useStore((s) => s.cube)!;
  const selected = useStore((s) => s.selected);
  const hovered = useStore((s) => s.hovered);
  const regions = useStore((s) => s.regions);
  const activeRegion = useStore((s) => s.activeRegion);
  const stats = useRegionStats();
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const axis = useMemo(() => spectralAxis(cube), [cube]);

  const pixel = selected ?? hovered;
  const pixelSpectrum = useMemo(() => (pixel ? getSpectrum(cube, pixel.x, pixel.y) : null), [cube, pixel?.x, pixel?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = regions.find((r) => r.id === activeRegion);
  const activeStats = active && stats.get(active.id);

  const data = (): uPlot.AlignedData => [
    axis.values,
    ...regions.map((r) => toSeries(stats.get(r.id)?.mean ?? null, cube.bands)),
    toSeries(pixelSpectrum, cube.bands),
  ];

  // uPlot fixes its lines when created, so a change of lines or of the emphasised one rebuilds it.
  const shape = `${regions.map((r) => `${r.id}:${r.name}`).join('|')}#${activeRegion}`;
  const legendH = regions.length > 2 ? 58 : 30;

  useEffect(() => {
    const wrap = wrapRef.current!;
    const u = new uPlot(
      {
        width: wrap.clientWidth,
        height: Math.max(80, wrap.clientHeight - legendH),
        scales: { x: { time: false } },
        cursor: { drag: { x: true, y: false }, points: { size: 7 } },
        axes: [
          { label: axis.label, stroke: INK, grid: { stroke: GRID }, ticks: { stroke: GRID }, labelSize: 22, size: 34 },
          { label: 'Value', stroke: INK, grid: { stroke: GRID }, ticks: { stroke: GRID }, labelSize: 22, size: 54 },
        ],
        series: [
          { label: axis.label },
          ...regions.map((r) => ({
            label: r.name,
            stroke: regionCss(r.id - 1),
            width: r.id === activeRegion ? 3 : 1.5,
            spanGaps: false,
            points: { show: false },
          })),
          regions.length
            ? { label: 'Pixel', stroke: PIXEL_ON_MEANS, width: 1, dash: [4, 3], spanGaps: false, points: { show: false } }
            : { label: 'Value', stroke: LINE, width: 2, spanGaps: false, points: { show: false } },
        ],
      },
      data(),
      wrap,
    );
    plotRef.current = u;
    const ro = new ResizeObserver(() => u.setSize({ width: wrap.clientWidth, height: Math.max(80, wrap.clientHeight - legendH) }));
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      u.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cube, axis, shape]);

  useEffect(() => {
    plotRef.current?.setData(data());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, pixelSpectrum]);

  const title = selected
    ? `Pixel (${selected.x}, ${selected.y})`
    : active && activeStats
      ? `${active.name}: mean of ${activeStats.count.toLocaleString()} pixels`
      : hovered
        ? `Pixel (${hovered.x}, ${hovered.y}) · click to keep`
        : 'Spectrum';

  const exportPixel = () => {
    if (!selected) return;
    const name = `${safeFilename(cube.name)}-pixel-x${selected.x}-y${selected.y}.csv`;
    downloadBlob(name, [pixelCsv(cube, getSpectrum(cube, selected.x, selected.y))], 'text/csv;charset=utf-8');
  };

  return (
    <section className="spectrum">
      <div className="spectrum-head">
        <h2>{title}</h2>
        {selected && (
          <div className="row">
            <button onClick={exportPixel}>Export CSV</button>
            <button onClick={() => useStore.getState().set({ selected: null })} title="Deselect pixel (Esc)">
              Clear
            </button>
          </div>
        )}
      </div>
      <div className="spectrum-plot" ref={wrapRef}>
        {!pixel && !regions.length && <div className="plot-empty">Hover over the image to see a pixel's spectrum; click to keep it, or highlight a leaf for its mean</div>}
      </div>
    </section>
  );
}
