import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { renderDisplay } from '../lib/display';
import { getSpectrum } from '../lib/cube';
import { roiStats, type Rect } from '../lib/analysis';
import { colormapGradient } from '../lib/colormaps';

type Tool = 'pin' | 'roi';

interface View {
  zoom: number;
  ox: number;
  oy: number;
}

interface Drag {
  kind: 'pan' | 'roi';
  startX: number;
  startY: number;
  startView: View;
  moved: boolean;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

const fmt = (v: number) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(2) : +v.toPrecision(4) + '');

export function ImageCanvas() {
  const cube = useStore((s) => s.cube)!;
  const params = useStore(
    useShallow((s) => ({
      mode: s.mode,
      band: s.band,
      rgb: s.rgb,
      colormap: s.colormap,
      lowPct: s.lowPct,
      highPct: s.highPct,
      gamma: s.gamma,
      derived: s.derived,
      showDerived: s.showDerived,
    })),
  );
  const display = useMemo(() => renderDisplay(cube, params), [cube, params]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ zoom: 1, ox: 0, oy: 0 });
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const [tool, setTool] = useState<Tool>('pin');
  const [zoomPct, setZoomPct] = useState(100);

  const toImage = (sx: number, sy: number) => {
    const v = view.current;
    return { x: Math.floor((sx - v.ox) / v.zoom), y: Math.floor((sy - v.oy) / v.zoom) };
  };
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < cube.width && p.y < cube.height;

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const { zoom, ox, oy } = view.current;
    const { pins, hover, refPinId } = useStore.getState();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.drawImage(display.canvas, ox, oy, cube.width * zoom, cube.height * zoom);

    const sx = (x: number) => ox + x * zoom;
    const sy = (y: number) => oy + y * zoom;
    const outlined = (draw: () => void, color: string, width = 2) => {
      ctx.lineWidth = width + 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      draw();
      ctx.stroke();
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      draw();
      ctx.stroke();
    };

    for (const pin of pins) {
      if (!pin.visible) continue;
      ctx.setLineDash(pin.dashed ? [5, 3] : []);
      if (pin.rect) {
        const r = pin.rect;
        outlined(() => {
          ctx.beginPath();
          ctx.rect(sx(r.x0), sy(r.y0), (r.x1 - r.x0) * zoom, (r.y1 - r.y0) * zoom);
        }, pin.color);
      } else {
        const cx = sx(pin.x + 0.5);
        const cy = sy(pin.y + 0.5);
        const rad = Math.max(5, zoom * 0.7);
        outlined(() => {
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        }, pin.color);
      }
      if (pin.id === refPinId) {
        ctx.setLineDash([]);
        const lx = pin.rect ? sx(pin.rect.x1) : sx(pin.x + 0.5) + Math.max(5, zoom * 0.7);
        const ly = pin.rect ? sy(pin.rect.y0) : sy(pin.y + 0.5);
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(lx + 3, ly - 8, 28, 16);
        ctx.fillStyle = '#fff';
        ctx.fillText('REF', lx + 6, ly + 4);
      }
    }
    ctx.setLineDash([]);

    if (hover && !drag.current?.moved) {
      outlined(() => {
        ctx.beginPath();
        ctx.rect(sx(hover.x), sy(hover.y), zoom, zoom);
      }, '#ffffff', 1);
    }

    const d = drag.current;
    if (d?.kind === 'roi' && d.moved) {
      const r = normRect(d.start, d.end);
      ctx.setLineDash([4, 4]);
      outlined(() => {
        ctx.beginPath();
        ctx.rect(sx(r.x0), sy(r.y0), (r.x1 - r.x0) * zoom, (r.y1 - r.y0) * zoom);
      }, '#ffffff', 1.5);
      ctx.setLineDash([]);
    }
  };

  // Callbacks registered once (observers, store subscriptions) must always see the latest draw().
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const requestDraw = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => drawRef.current());
  };

  const normRect = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => {
    const clampX = (v: number) => Math.min(cube.width, Math.max(0, v));
    const clampY = (v: number) => Math.min(cube.height, Math.max(0, v));
    return {
      x0: clampX(Math.min(a.x, b.x)),
      y0: clampY(Math.min(a.y, b.y)),
      x1: clampX(Math.max(a.x, b.x) + 1),
      y1: clampY(Math.max(a.y, b.y) + 1),
    };
  };

  const fit = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const { clientWidth: w, clientHeight: h } = wrap;
    const zoom = Math.min(w / cube.width, h / cube.height) * 0.94;
    view.current = { zoom, ox: (w - cube.width * zoom) / 2, oy: (h - cube.height * zoom) / 2 };
    setZoomPct(Math.round(zoom * 100));
    requestDraw();
  };

  const zoomAt = (factor: number, cx: number, cy: number) => {
    const v = view.current;
    const zoom = Math.min(64, Math.max(0.05, v.zoom * factor));
    const k = zoom / v.zoom;
    view.current = { zoom, ox: cx - (cx - v.ox) * k, oy: cy - (cy - v.oy) * k };
    setZoomPct(Math.round(zoom * 100));
    requestDraw();
  };

  // Resize canvas to its container (device pixels) and fit on new cubes.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(wrap.clientWidth * dpr);
      canvas.height = Math.round(wrap.clientHeight * dpr);
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      requestDraw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    fit();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cube]);

  useEffect(requestDraw, [display]);
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.pins !== prev.pins || s.hover !== prev.hover || s.refPinId !== prev.refPinId) requestDraw();
      }),
    [],
  );

  // Wheel must be non-passive to prevent page scroll.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  });

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const { sx, sy } = local(e);
    const p = toImage(sx, sy);
    drag.current = {
      kind: e.button === 0 && (e.shiftKey || tool === 'roi') ? 'roi' : 'pan',
      startX: sx,
      startY: sy,
      startView: { ...view.current },
      moved: false,
      start: p,
      end: p,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { sx, sy } = local(e);
    const p = toImage(sx, sy);
    const d = drag.current;
    if (d) {
      if (Math.hypot(sx - d.startX, sy - d.startY) > 3) d.moved = true;
      if (d.kind === 'pan' && d.moved) {
        view.current = { ...d.startView, ox: d.startView.ox + sx - d.startX, oy: d.startView.oy + sy - d.startY };
      }
      d.end = p;
      requestDraw();
    }
    const hover = useStore.getState().hover;
    const next = inside(p) ? p : null;
    if (next?.x !== hover?.x || next?.y !== hover?.y) useStore.getState().set({ hover: next });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const { addPin } = useStore.getState();
    if (d.kind === 'roi' && d.moved) {
      const rect = normRect(d.start, d.end);
      if (rect.x1 > rect.x0 && rect.y1 > rect.y0) {
        const s = roiStats(cube, rect);
        addPin({
          kind: 'roi',
          x: rect.x0,
          y: rect.y0,
          rect,
          spectrum: s.mean,
          std: s.std,
          count: s.count,
          label: undefined,
        });
      }
    } else if (!d.moved && e.button === 0 && inside(d.start)) {
      addPin({ kind: 'pixel', x: d.start.x, y: d.start.y, spectrum: getSpectrum(cube, d.start.x, d.start.y) });
    }
    requestDraw();
  };

  return (
    <div className="image-panel">
      <div className="image-toolbar">
        <div className="seg" role="group" aria-label="Click tool">
          <button className={tool === 'pin' ? 'on' : ''} onClick={() => setTool('pin')} title="Click to pin a pixel spectrum (drag to pan)">
            Pin pixel
          </button>
          <button className={tool === 'roi' ? 'on' : ''} onClick={() => setTool('roi')} title="Drag a rectangle to pin its mean spectrum (also Shift+drag)">
            Draw ROI
          </button>
        </div>
        <span className="spacer" />
        <button onClick={() => zoomAt(1 / 1.5, wrapRef.current!.clientWidth / 2, wrapRef.current!.clientHeight / 2)} aria-label="Zoom out">
          −
        </button>
        <span className="zoom-readout">{zoomPct}%</span>
        <button onClick={() => zoomAt(1.5, wrapRef.current!.clientWidth / 2, wrapRef.current!.clientHeight / 2)} aria-label="Zoom in">
          +
        </button>
        <button onClick={fit}>Fit</button>
      </div>
      <div className="canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={tool === 'roi' ? 'tool-roi' : 'tool-pin'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => useStore.getState().set({ hover: null })}
          onContextMenu={(e) => e.preventDefault()}
        />
        {display.range && display.colormap && (
          <div className="colorbar">
            <div className="colorbar-ramp" style={{ background: colormapGradient(display.colormap) }} />
            <div className="colorbar-labels">
              <span>{fmt(display.range[0])}</span>
              <span>{fmt(display.range[1])}</span>
            </div>
          </div>
        )}
        <div className="hint">Click: pin spectrum · Drag: pan · Shift+drag: ROI · Wheel: zoom</div>
      </div>
    </div>
  );
}
