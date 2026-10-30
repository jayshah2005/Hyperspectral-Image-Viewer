import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { renderRgbImage } from '../lib/display';

interface View {
  zoom: number;
  ox: number;
  oy: number;
}

/** RGB view of the cube. Click selects a pixel; drag pans; wheel zooms; double-click fits. */
export function ImageCanvas() {
  const cube = useStore((s) => s.cube)!;
  const image = useMemo(() => renderRgbImage(cube), [cube]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ zoom: 1, ox: 0, oy: 0 });
  const drag = useRef<{ sx: number; sy: number; start: View; moved: boolean } | null>(null);
  const frame = useRef(0);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const { zoom, ox, oy } = view.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.drawImage(image, ox, oy, cube.width * zoom, cube.height * zoom);

    const sel = useStore.getState().selected;
    if (sel) {
      const cx = ox + (sel.x + 0.5) * zoom;
      const cy = oy + (sel.y + 0.5) * zoom;
      const r = Math.max(6, zoom * 0.8);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  };

  // Observers registered once must always call the latest draw().
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const requestDraw = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => drawRef.current());
  };

  const fit = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const { clientWidth: w, clientHeight: h } = wrap;
    const zoom = Math.min(w / cube.width, h / cube.height) * 0.96;
    view.current = { zoom, ox: (w - cube.width * zoom) / 2, oy: (h - cube.height * zoom) / 2 };
    requestDraw();
  };

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(wrap.clientWidth * dpr);
      canvas.height = Math.round(wrap.clientHeight * dpr);
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      fit();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const v = view.current;
      const zoom = Math.min(64, Math.max(0.05, v.zoom * Math.exp(-e.deltaY * 0.0015)));
      const k = zoom / v.zoom;
      view.current = { zoom, ox: cx - (cx - v.ox) * k, oy: cy - (cy - v.oy) * k };
      requestDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const unsub = useStore.subscribe((s, prev) => s.selected !== prev.selected && requestDraw());
    return () => {
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cube]);

  useEffect(requestDraw, [image]);

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    drag.current = { ...local(e), start: { ...view.current }, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { sx, sy } = local(e);
    if (Math.hypot(sx - d.sx, sy - d.sy) > 3) d.moved = true;
    if (d.moved) {
      view.current = { ...d.start, ox: d.start.ox + sx - d.sx, oy: d.start.oy + sy - d.sy };
      requestDraw();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || e.button !== 0) return;
    const { zoom, ox, oy } = view.current;
    const x = Math.floor((d.sx - ox) / zoom);
    const y = Math.floor((d.sy - oy) / zoom);
    if (x < 0 || y < 0 || x >= cube.width || y >= cube.height) return;
    const { selected, set } = useStore.getState();
    // Clicking the selected pixel again deselects it.
    set({ selected: selected?.x === x && selected?.y === y ? null : { x, y } });
  };

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={fit}
      />
      <div className="hint">Click a pixel (again or Esc to deselect) · drag to pan · scroll to zoom · double-click to fit</div>
    </div>
  );
}
