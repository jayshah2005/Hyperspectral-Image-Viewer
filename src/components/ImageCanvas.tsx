import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type ClickMode, type EditorState } from '../store';
import { renderRgbImage } from '../lib/display';
import { setSam2Rgb } from '../lib/sam2';
import { regionColor } from '../lib/colors';
import { brushRadius } from '../lib/mask';

interface View {
  zoom: number;
  ox: number;
  oy: number;
}

const ACTIVE_ALPHA = 150;
const OTHER_ALPHA = 72;
/** In the editor: how far everything but the highlight is darkened, and how strongly the highlight is tinted. */
const DIM_ALPHA = 150;
const FOCUS_TINT_ALPHA = 70;
/** How close, in screen pixels, a click must be to a dot to remove it. */
const DOT_HIT = 7;

const HINTS = {
  pixel: 'Hover to preview · click to keep (again or Esc to deselect) · Shift+click adds a pixel to a set · drag to pan · scroll to zoom',
  point: 'Click an object to outline it · Ctrl+click adds to the selected one · right-click leaves out · click a dot to remove it',
  box: 'Drag a box around an object to outline it · Space-drag to pan',
  select: 'Click a highlight to select it · drag to pan',
  brush: 'Paint to correct the selected highlight · A add · D erase · [ ] size · Space-drag to pan',
};

export interface Viewport {
  zoomBy: (factor: number) => void;
  reset: () => void;
}

interface Props {
  /** Editor mode: frame this highlight, dim everything else, and only paint. */
  focus?: EditorState;
  viewport?: React.MutableRefObject<Viewport | null>;
  onZoom?: (zoom: number) => void;
}

const EDITOR_HINT = 'Paint to correct · A add · D erase · [ ] size · scroll to zoom · Space-drag to pan';

/** RGB view with the highlights on top. What a click does depends on the tool. */
export function ImageCanvas({ focus, viewport, onZoom }: Props) {
  const cube = useStore((s) => s.cube)!;
  const tool = useStore((s) => s.tool);
  const notice = useStore((s) => s.notice);
  const samBusy = useStore((s) => s.samBusy);
  const image = useMemo(() => renderRgbImage(cube), [cube]);
  const overlay = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = cube.width;
    c.height = cube.height;
    return c;
  }, [cube]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ zoom: 1, ox: 0, oy: 0 });
  const drag = useRef<{ sx: number; sy: number; start: View; moved: boolean; pan: boolean; painting: boolean; boxing: boolean } | null>(null);
  const lastPaint = useRef<{ x: number; y: number } | null>(null);
  const boxEnd = useRef<{ sx: number; sy: number } | null>(null);
  const frame = useRef(0);
  const zoomShown = useRef(0);
  const space = useRef(false);
  const hoverPx = useRef<{ x: number; y: number } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  useEffect(() => {
    // The main view owns this: the editor closing must not take the picture away from SAM.
    if (focus) return;
    setSam2Rgb(image);
    return () => setSam2Rgb(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  /** Repaint the tint of a part of the image, or all of it. */
  const paintOverlay = (rect: { x0: number; y0: number; x1: number; y1: number } | null) => {
    const { labels, activeRegion } = useStore.getState();
    if (!labels) return;
    const { width, height } = cube;
    const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
    const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
    const x1 = rect ? Math.min(width, Math.ceil(rect.x1) + 1) : width;
    const y1 = rect ? Math.min(height, Math.ceil(rect.y1) + 1) : height;
    if (x1 <= x0 || y1 <= y0) return;
    const ctx = overlay.getContext('2d')!;
    const img = ctx.createImageData(x1 - x0, y1 - y0);
    const d = img.data;
    let o = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++, o += 4) {
        const p = y * width + x;
        const id = labels[p];
        if (focus) {
          if (id === focus.id) {
            const [r, g, b] = regionColor(id - 1);
            // A solid edge shows exactly which pixels are in, however far you zoom.
            const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1 || labels[p - 1] !== id || labels[p + 1] !== id || labels[p - width] !== id || labels[p + width] !== id;
            d[o] = r;
            d[o + 1] = g;
            d[o + 2] = b;
            d[o + 3] = edge ? 255 : FOCUS_TINT_ALPHA;
          } else if (id) {
            // Other highlights stay visible but faint: the brush can't paint over them.
            const [r, g, b] = regionColor(id - 1);
            d[o] = r >> 2;
            d[o + 1] = g >> 2;
            d[o + 2] = b >> 2;
            d[o + 3] = DIM_ALPHA + 30;
          } else {
            d[o + 3] = DIM_ALPHA;
          }
          continue;
        }
        if (!id) continue;
        const [r, g, b] = regionColor(id - 1);
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = id === activeRegion ? ACTIVE_ALPHA : OTHER_ALPHA;
      }
    }
    ctx.putImageData(img, x0, y0);
  };

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
    ctx.drawImage(overlay, ox, oy, cube.width * zoom, cube.height * zoom);

    const st = useStore.getState();
    const sel = st.selected;
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

    if (st.tool === 'point' || st.tool === 'box' || st.tool === 'select') {
      for (const region of st.regions) {
        const active = region.id === st.activeRegion;
        if (region.box && active) {
          const [x0, y0, x1, y1] = region.box;
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#ffffff';
          ctx.strokeRect(ox + x0 * zoom, oy + y0 * zoom, (x1 - x0) * zoom, (y1 - y0) * zoom);
          ctx.setLineDash([]);
        }
        for (const q of region.points) {
          ctx.beginPath();
          ctx.arc(ox + (q.x + 0.5) * zoom, oy + (q.y + 0.5) * zoom, active ? 5 : 4, 0, Math.PI * 2);
          ctx.fillStyle = q.label === 1 ? '#4eb8d9' : '#e24b4b';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
        }
      }
    }

    const d = drag.current;
    if (d?.boxing && boxEnd.current) {
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(d.sx, d.sy, boxEnd.current.sx - d.sx, boxEnd.current.sy - d.sy);
      ctx.setLineDash([]);
    }

    const hp = hoverPx.current;
    if (st.tool === 'brush' && hp) {
      const r = brushRadius(st.brushSize) * zoom;
      const erase = st.brushMode === 'erase';
      ctx.beginPath();
      ctx.arc(ox + (hp.x + 0.5) * zoom, oy + (hp.y + 0.5) * zoom, Math.max(1, r), 0, Math.PI * 2);
      ctx.fillStyle = erase ? 'rgba(255,70,70,0.18)' : 'rgba(78,184,217,0.18)';
      ctx.fill();
      ctx.strokeStyle = erase ? 'rgba(255,70,70,0.95)' : 'rgba(78,184,217,0.95)';
      ctx.lineWidth = 1.5;
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

  const setView = (v: View) => {
    view.current = v;
    if (v.zoom !== zoomShown.current) {
      zoomShown.current = v.zoom;
      onZoom?.(v.zoom);
    }
    requestDraw();
  };

  const fit = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const { clientWidth: w, clientHeight: h } = wrap;
    const r = focus?.rect ?? { x0: 0, y0: 0, w: cube.width, h: cube.height };
    const zoom = Math.min(w / r.w, h / r.h) * 0.96;
    setView({ zoom, ox: (w - r.w * zoom) / 2 - r.x0 * zoom, oy: (h - r.h * zoom) / 2 - r.y0 * zoom });
  };

  /** Zoom keeping the canvas point (cx, cy) fixed. */
  const zoomAround = (cx: number, cy: number, factor: number) => {
    const v = view.current;
    const zoom = Math.min(64, Math.max(0.05, v.zoom * factor));
    const k = zoom / v.zoom;
    setView({ zoom, ox: cx - (cx - v.ox) * k, oy: cy - (cy - v.oy) * k });
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
    paintOverlay(null);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      zoomAround(cx, cy, Math.exp(-e.deltaY * 0.0015));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    if (viewport) {
      viewport.current = {
        zoomBy: (factor) => zoomAround(wrap.clientWidth / 2, wrap.clientHeight / 2, factor),
        reset: fit,
      };
    }
    const unsub = useStore.subscribe((s, prev) => {
      // The main view is covered while the editor is open; it catches up when the editor closes.
      if (!focus && s.editor) return;
      if (s.maskRev !== prev.maskRev || s.activeRegion !== prev.activeRegion) {
        // Only a brush stroke says what changed; a new selection recolours everything.
        paintOverlay(s.activeRegion === prev.activeRegion ? s.maskDirty : null);
        requestDraw();
      } else if (s.selected !== prev.selected || s.tool !== prev.tool || s.brushMode !== prev.brushMode || s.brushSize !== prev.brushSize || s.regions !== prev.regions) {
        requestDraw();
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      space.current = e.type === 'keydown';
      setSpaceHeld(space.current);
      if (e.type === 'keydown') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      unsub();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cube]);

  useEffect(requestDraw, [image]); // eslint-disable-line react-hooks/exhaustive-deps

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  /** Image coordinates of a canvas point: exact, and as a pixel. Null outside the image. */
  const pixelAt = (sx: number, sy: number) => {
    const { zoom, ox, oy } = view.current;
    const x = (sx - ox) / zoom;
    const y = (sy - oy) / zoom;
    if (x < 0 || y < 0 || x >= cube.width || y >= cube.height) return null;
    return { x, y, ix: Math.floor(x), iy: Math.floor(y) };
  };

  const setHovered = (p: { ix: number; iy: number } | null) => {
    const next = p ? { x: p.ix, y: p.iy } : null;
    hoverPx.current = next;
    const { hovered, set, tool: t } = useStore.getState();
    if (t === 'brush') requestDraw();
    if (focus) return; // the graph is covered up, so don't make it follow the mouse
    if (next?.x !== hovered?.x || next?.y !== hovered?.y) set({ hovered: next });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // give the keyboard shortcuts back
    canvasRef.current!.setPointerCapture(e.pointerId);
    const { sx, sy } = local(e);
    const s = useStore.getState();
    const left = e.button === 0 && !space.current;
    const painting = s.tool === 'brush' && left && s.beginStroke();
    const boxing = s.tool === 'box' && left;
    drag.current = { sx, sy, start: { ...view.current }, moved: false, pan: !painting && !boxing, painting, boxing };
    if (painting) {
      const p = pixelAt(sx, sy);
      if (p) {
        lastPaint.current = { x: p.x, y: p.y };
        s.paintStroke(p.x, p.y, p.x, p.y);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { sx, sy } = local(e);
    const p = pixelAt(sx, sy);
    const d = drag.current;
    if (!d?.painting && !d?.boxing) setHovered(p);
    else if (d.painting) {
      hoverPx.current = p ? { x: p.ix, y: p.iy } : null;
      requestDraw();
    }
    if (!d) return;
    if (Math.hypot(sx - d.sx, sy - d.sy) > 3) d.moved = true;
    if (d.pan) {
      if (d.moved) {
        view.current = { ...d.start, ox: d.start.ox + sx - d.sx, oy: d.start.oy + sy - d.sy };
        requestDraw();
      }
    } else if (d.boxing) {
      boxEnd.current = { sx, sy };
      requestDraw();
    } else if (d.painting && p) {
      const last = lastPaint.current ?? { x: p.x, y: p.y };
      useStore.getState().paintStroke(last.x, last.y, p.x, p.y);
      lastPaint.current = { x: p.x, y: p.y };
    }
  };

  /** A click on a prompt dot, in any highlight, removes that prompt. */
  const dotAt = (sx: number, sy: number) => {
    const { zoom, ox, oy } = view.current;
    for (const region of useStore.getState().regions) {
      const index = region.points.findIndex((q) => Math.hypot(ox + (q.x + 0.5) * zoom - sx, oy + (q.y + 0.5) * zoom - sy) <= DOT_HIT);
      if (index >= 0) return { regionId: region.id, index };
    }
    return null;
  };

  const finishBox = (d: NonNullable<typeof drag.current>, sx: number, sy: number) => {
    boxEnd.current = null;
    requestDraw();
    const { zoom, ox, oy } = view.current;
    const clampX = (v: number) => Math.max(0, Math.min(cube.width, (v - ox) / zoom));
    const clampY = (v: number) => Math.max(0, Math.min(cube.height, (v - oy) / zoom));
    const x0 = Math.min(clampX(d.sx), clampX(sx));
    const x1 = Math.max(clampX(d.sx), clampX(sx));
    const y0 = Math.min(clampY(d.sy), clampY(sy));
    const y1 = Math.max(clampY(d.sy), clampY(sy));
    if (x1 - x0 >= 3 && y1 - y0 >= 3) void useStore.getState().highlightBox([x0, y0, x1, y1]);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    lastPaint.current = null;
    if (!d) return;
    const s = useStore.getState();
    if (d.painting) {
      s.endStroke();
      return;
    }
    const { sx, sy } = local(e);
    if (d.boxing) {
      finishBox(d, sx, sy);
      return;
    }
    if (d.moved || (e.button !== 0 && e.button !== 2)) return;
    const p = pixelAt(d.sx, d.sy);
    if (!p) return;
    const { ix: x, iy: y } = p;
    if (s.tool === 'point') {
      const dot = e.button === 0 && dotAt(d.sx, d.sy);
      if (dot) {
        void s.removePoint(dot.regionId, dot.index);
        return;
      }
      const mode: ClickMode = e.button === 2 || e.shiftKey ? 'exclude' : e.ctrlKey || e.metaKey ? 'add' : 'new';
      void s.highlightAt(x, y, mode);
    } else if (s.tool === 'select') {
      if (e.button === 0) s.set({ activeRegion: s.labels?.[y * cube.width + x] ?? 0, selected: null });
    } else if (s.tool === 'pixel' && e.button === 0) {
      if (e.shiftKey) s.togglePixel(x, y);
      else s.set({ selected: s.selected?.x === x && s.selected?.y === y ? null : { x, y } });
    }
  };

  const cursor = tool === 'brush' && !spaceHeld ? 'none' : tool === 'point' || tool === 'box' ? (samBusy ? 'progress' : 'copy') : tool === 'select' ? 'pointer' : 'crosshair';

  return (
    <div className="canvas-wrap" ref={wrapRef} aria-busy={samBusy > 0}>
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHovered(null)}
        onDoubleClick={() => tool === 'pixel' && fit()}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className={notice ? 'hint notice' : 'hint'}>{notice ?? (focus ? EDITOR_HINT : HINTS[tool])}</div>
    </div>
  );
}
