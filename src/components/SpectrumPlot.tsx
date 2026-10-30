import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useStore } from '../store';
import { getSpectrum, spectralAxis } from '../lib/cube';

const INK = '#a6adbb';
const GRID = 'rgba(255,255,255,0.07)';
const LINE = '#3987e5';
/** Room left under the plot for uPlot's legend (wavelength + value under the cursor). */
const LEGEND_H = 30;

/** NaN (bad band / no-data) becomes null so uPlot leaves a gap. */
const toSeries = (a: ArrayLike<number> | null, n: number): (number | null)[] =>
  Array.from({ length: n }, (_, i) => (a && Number.isFinite(a[i]) ? a[i] : null));

/** Spectrum of the selected pixel, or of the hovered one while nothing is selected. */
export function SpectrumPlot() {
  const cube = useStore((s) => s.cube)!;
  const selected = useStore((s) => s.selected);
  const hovered = useStore((s) => s.hovered);
  const shown = selected ?? hovered;
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const axis = useMemo(() => spectralAxis(cube), [cube]);

  const data = (sel: { x: number; y: number } | null): uPlot.AlignedData => [
    axis.values,
    toSeries(sel ? getSpectrum(cube, sel.x, sel.y) : null, cube.bands),
  ];

  useEffect(() => {
    const wrap = wrapRef.current!;
    const u = new uPlot(
      {
        width: wrap.clientWidth,
        height: wrap.clientHeight - LEGEND_H,
        scales: { x: { time: false } },
        cursor: { drag: { x: true, y: false }, points: { size: 7 } },
        axes: [
          { label: axis.label, stroke: INK, grid: { stroke: GRID }, ticks: { stroke: GRID }, labelSize: 22, size: 34 },
          { label: 'Value', stroke: INK, grid: { stroke: GRID }, ticks: { stroke: GRID }, labelSize: 22, size: 54 },
        ],
        series: [{ label: axis.label }, { label: 'Value', stroke: LINE, width: 2, spanGaps: false, points: { show: false } }],
      },
      data(shown),
      wrap,
    );
    plotRef.current = u;
    const ro = new ResizeObserver(() => u.setSize({ width: wrap.clientWidth, height: wrap.clientHeight - LEGEND_H }));
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      u.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cube, axis]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useStore.getState().set({ selected: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    plotRef.current?.setData(data(shown));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.x, shown?.y]);

  return (
    <section className="spectrum">
      <div className="spectrum-head">
        <h2>
          {selected
            ? `Spectrum at pixel (${selected.x}, ${selected.y})`
            : hovered
              ? `Pixel (${hovered.x}, ${hovered.y}) · click to keep`
              : 'Spectrum'}
        </h2>
        {selected && (
          <button onClick={() => useStore.getState().set({ selected: null })} title="Deselect pixel (Esc)">
            Clear
          </button>
        )}
      </div>
      <div className="spectrum-plot" ref={wrapRef}>
        {!shown && <div className="plot-empty">Hover over the image to see a pixel's spectrum; click to keep it</div>}
      </div>
    </section>
  );
}
