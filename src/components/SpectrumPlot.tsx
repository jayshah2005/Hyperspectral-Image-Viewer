import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useStore, type Pin } from '../store';
import { getSpectrum, spectralAxis } from '../lib/cube';

const INK = '#a6adbb';
const GRID = 'rgba(255,255,255,0.07)';
const CURSOR_SERIES = '#e8eaed';

const toSeries = (a: ArrayLike<number> | null, n: number): (number | null)[] => {
  const out = new Array<number | null>(n);
  for (let i = 0; i < n; i++) {
    const v = a ? a[i] : NaN;
    out[i] = Number.isFinite(v) ? v : null;
  }
  return out;
};

const fmt = (v: number | null | undefined) =>
  v == null ? '–' : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : +v.toPrecision(5) + '';

interface Layout {
  /** uPlot series index of each pin's mean line. */
  pinSeries: Map<number, number>;
}

export function SpectrumPlot() {
  const cube = useStore((s) => s.cube)!;
  const pins = useStore((s) => s.pins);
  const band = useStore((s) => s.band);
  const mode = useStore((s) => s.mode);
  const rgb = useStore((s) => s.rgb);
  const hasHover = useStore((s) => s.hover !== null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const markers = useRef<{ band: number; rgb: [number, number, number] | null }>({ band, rgb: null });
  markers.current = { band, rgb: mode === 'rgb' ? rgb : null };

  const axis = useMemo(() => spectralAxis(cube), [cube]);
  const visiblePins = useMemo(() => pins.filter((p) => p.visible), [pins]);

  const buildData = (hover: { x: number; y: number } | null, list: Pin[]): uPlot.AlignedData => {
    const n = cube.bands;
    const cols: (number | null)[][] = [toSeries(hover ? getSpectrum(cube, hover.x, hover.y) : null, n)];
    for (const p of list) {
      cols.push(toSeries(p.spectrum, n));
      if (p.std) {
        cols.push(toSeries(p.spectrum.map((m, i) => m + p.std![i]), n));
        cols.push(toSeries(p.spectrum.map((m, i) => m - p.std![i]), n));
      }
    }
    return [axis.values, ...cols] as uPlot.AlignedData;
  };

  // (Re)create the plot when the series set changes.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const layout: Layout = { pinSeries: new Map() };
    const series: uPlot.Series[] = [
      { label: axis.label },
      { label: 'Cursor', stroke: CURSOR_SERIES, width: 1.5, dash: [5, 4], spanGaps: false, points: { show: false } },
    ];
    const bands: uPlot.Band[] = [];
    for (const p of visiblePins) {
      layout.pinSeries.set(p.id, series.length);
      series.push({ label: p.label, stroke: p.color, width: 2, dash: p.dashed ? [6, 4] : undefined, spanGaps: false, points: { show: false } });
      if (p.std) {
        const hi = series.length;
        series.push({ label: `${p.label} +σ`, stroke: 'transparent', width: 0, points: { show: false } });
        series.push({ label: `${p.label} −σ`, stroke: 'transparent', width: 0, points: { show: false } });
        bands.push({ series: [hi, hi + 1], fill: `${p.color}33` });
      }
    }

    const shadeBadBands = (u: uPlot) => {
      const bad = cube.badBands;
      if (!bad) return;
      const { ctx, bbox } = u;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      const xs = axis.values;
      for (let i = 0; i < bad.length; i++) {
        if (!bad[i]) continue;
        const left = i > 0 ? (xs[i - 1] + xs[i]) / 2 : xs[i];
        const right = i < xs.length - 1 ? (xs[i] + xs[i + 1]) / 2 : xs[i];
        const x0 = u.valToPos(left, 'x', true);
        const x1 = u.valToPos(right, 'x', true);
        ctx.fillRect(Math.max(bbox.left, x0), bbox.top, Math.min(bbox.left + bbox.width, x1) - Math.max(bbox.left, x0), bbox.height);
      }
      ctx.restore();
    };

    const drawBandMarkers = (u: uPlot) => {
      const { ctx, bbox } = u;
      const line = (b: number, color: string, label?: string) => {
        if (b < 0 || b >= axis.values.length) return;
        const x = Math.round(u.valToPos(axis.values[b], 'x', true)) + 0.5;
        if (x < bbox.left || x > bbox.left + bbox.width) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 * devicePixelRatio;
        ctx.beginPath();
        ctx.moveTo(x, bbox.top);
        ctx.lineTo(x, bbox.top + bbox.height);
        ctx.stroke();
        if (label) {
          ctx.fillStyle = color;
          ctx.font = `600 ${10 * devicePixelRatio}px system-ui, sans-serif`;
          ctx.fillText(label, x + 3 * devicePixelRatio, bbox.top + 11 * devicePixelRatio);
        }
      };
      ctx.save();
      const m = markers.current;
      if (m.rgb) {
        line(m.rgb[0], 'rgba(255,99,99,0.8)', 'R');
        line(m.rgb[1], 'rgba(99,220,120,0.8)', 'G');
        line(m.rgb[2], 'rgba(110,160,255,0.85)', 'B');
      } else {
        line(m.band, 'rgba(255,255,255,0.55)');
      }
      ctx.restore();
    };

    const updateReadout = (u: uPlot) => {
      const el = readoutRef.current;
      if (!el) return;
      const idx = u.cursor.idx;
      const xLabel = axis.isWavelength ? 'λ' : 'Band';
      if (idx == null) {
        el.textContent = '';
        return;
      }
      const parts = [axis.isWavelength ? `${xLabel} ${fmt(axis.values[idx])} (band ${idx + 1})` : `${xLabel} ${idx + 1}`];
      const cur = u.data[1][idx];
      if (cur != null) parts.push(`cursor ${fmt(cur)}`);
      for (const p of visiblePins) parts.push(`${p.label}: ${fmt(u.data[layout.pinSeries.get(p.id)!][idx])}`);
      el.textContent = parts.join('   ·   ');
    };

    const u = new uPlot(
      {
        width: wrap.clientWidth,
        height: wrap.clientHeight,
        legend: { show: false },
        scales: { x: { time: false } },
        cursor: { drag: { x: true, y: false }, points: { size: 7 } },
        axes: [
          { label: axis.label, stroke: INK, grid: { stroke: GRID, width: 1 }, ticks: { stroke: GRID }, labelSize: 22, size: 34 },
          { label: 'Value', stroke: INK, grid: { stroke: GRID, width: 1 }, ticks: { stroke: GRID }, labelSize: 22, size: 54 },
        ],
        series,
        bands,
        hooks: {
          drawAxes: [shadeBadBands],
          draw: [drawBandMarkers],
          setCursor: [updateReadout],
        },
      },
      buildData(useStore.getState().hover, visiblePins),
      wrap,
    );
    plotRef.current = u;

    // A click (not a drag-zoom) on the plot selects the band under the cursor.
    let downX = 0;
    const onDown = (e: MouseEvent) => (downX = e.clientX);
    const onUp = (e: MouseEvent) => {
      if (Math.abs(e.clientX - downX) > 3 || u.cursor.idx == null) return;
      useStore.getState().set({ band: u.cursor.idx, mode: 'single', showDerived: false });
    };
    u.over.addEventListener('mousedown', onDown);
    u.over.addEventListener('mouseup', onUp);

    const ro = new ResizeObserver(() => u.setSize({ width: wrap.clientWidth, height: wrap.clientHeight }));
    ro.observe(wrap);

    const unsub = useStore.subscribe((s, prev) => {
      if (s.hover === prev.hover) return;
      // Keep any x zoom, but let y re-fit: re-applying the x scale re-ranges y.
      const { min, max } = u.scales.x;
      u.setData(buildData(s.hover, visiblePins), false);
      if (min != null && max != null) u.setScale('x', { min, max });
    });

    return () => {
      unsub();
      ro.disconnect();
      u.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cube, axis, visiblePins]);

  // Band markers only need a redraw.
  useEffect(() => {
    plotRef.current?.redraw(false);
  }, [band, mode, rgb]);

  return (
    <div className="spectrum">
      <div className="spectrum-legend">
        <span className="legend-item">
          <span className="swatch dashed" style={{ borderColor: CURSOR_SERIES }} /> Cursor
        </span>
        {visiblePins.map((p) => (
          <span className="legend-item" key={p.id}>
            <span className={`swatch${p.dashed ? ' dashed' : ''}`} style={{ borderColor: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
      <div className="spectrum-plot" ref={wrapRef}>
        {!hasHover && !visiblePins.length && <div className="plot-empty">Hover or click the image to see spectra</div>}
      </div>
      <div className="spectrum-readout" ref={readoutRef} aria-live="off" />
    </div>
  );
}
