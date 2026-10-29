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

/** Spectrum of the selected pixel. */
export function SpectrumPlot() {
  const cube = useStore((s) => s.cube)!;
  const selected = useStore((s) => s.selected);
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
      data(useStore.getState().selected),
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
    plotRef.current?.setData(data(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <section className="spectrum">
      <h2>{selected ? `Spectrum at pixel (${selected.x}, ${selected.y})` : 'Spectrum'}</h2>
      <div className="spectrum-plot" ref={wrapRef}>
        {!selected && <div className="plot-empty">Click a pixel in the image to see its spectrum</div>}
      </div>
    </section>
  );
}
